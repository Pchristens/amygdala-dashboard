import { spawnConpty } from './conpty.js';
import { createInterface } from 'node:readline';
import { stripVTControlCharacters } from 'node:util';
// Fleet usage probes — every pool that feeds the village's oil, read without spending model quota:
//   Claude      `claude -p /usage` (session, weekly all-models, weekly Fable); answered by the CLI itself
//   Antigravity `agy -p=/usage` (tab-separated pools: Gemini, Claude+GPT, Argon; % remaining, ISO reset)
//   Codex       newest `rate_limits` record in Codex session logs (no usage command exists)
//   Grok        the interactive UI's /usage panel, read from a hidden tmux pane (headless mode doesn't expose it)
//   Kimi        the same for Kimi Code's /usage plan box (5h and monthly), from a throwaway home with no MCP servers
// Methods follow a fleet_usage.py helper script. Output shape matches agent-deck's `usage --json`.
import { buildPath } from './bin.js';
import { execFile } from './bin.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { kimiBin, kimiPaths, prepareKimi, cleanupKimi } from './kimi.js';

const HOME = os.homedir();
const PATH = buildPath({ unix: ['/usr/local/bin', '/usr/bin', '/bin'] });
const sh = (cmd, args, timeout = 150000, cwd = HOME) => new Promise(res =>
  execFile(cmd, args, { timeout, cwd, env: { ...process.env, PATH }, maxBuffer: 4 << 20 }, (e, out) => res(String(out || ''))));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MONTHS = 'jan feb mar apr may jun jul aug sep oct nov dec'.split(' ');

// "Oct 27 at 3am" / "October 29, 21:11" → epoch ms (this year; next year if that is long past)
function when(text) {
  const m = String(text).match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})(?:,|\s+at)?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!m) return null;
  const mon = MONTHS.indexOf(m[1].toLowerCase()); if (mon < 0) return null;
  let h = +m[3] % (m[5] ? 12 : 24); if (m[5]?.toLowerCase() === 'pm') h += 12;
  const now = new Date(), d = new Date(now.getFullYear(), mon, +m[2], h, +(m[4] || 0));
  if (d - now < -180 * 864e5) d.setFullYear(d.getFullYear() + 1);
  return d.getTime();
}
const win = (kind, label, used, resetsAt) => ({ kind, label, used_percentage: Math.round(used), resets_at: resetsAt ? Math.round(resetsAt / 1000) : null,
  stale: !!(resetsAt && resetsAt < Date.now()) });

export async function probeClaude() {
  const out = await sh('claude', ['-p', '/usage', '--model', 'haiku']);
  const windows = [];
  for (const [re, kind, label] of [[/Current session: (\d+)% used · resets (.+)/, 'five_hour', '5h'], [/Current week \(all models\): (\d+)% used · resets (.+)/, 'seven_day', '7d'],
    [/Current week \(Fable\): (\d+)% used · resets (.+)/, 'seven_day_fable', '7d Fable']]) {
    const m = out.match(re); if (m) windows.push(win(kind, label, +m[1], when(m[2])));
  }
  return windows.length ? { id: 'claude', label: 'Claude', windows, source: 'claude /usage' } : null;
}

export async function probeAntigravity() {
  const out = await sh('agy', ['--model', 'claude-sonnet-5-5-low', '--print-timeout', '2m', '--output-format', 'text', '-p=/usage']);
  const windows = [];
  for (const line of out.split('\n')) {
    if (!/limit/i.test(line)) continue;
    const [pool, window, pct, reset] = line.split('\t');
    const rem = parseFloat(pct); if (!Number.isFinite(rem)) continue;
    const t = Date.parse(reset); const label = `${pool.trim()} · ${window.replace(/ ?Limit ?Remaining/i, '').trim()}`;
    windows.push({ ...win(/five/i.test(window) ? 'five_hour' : 'seven_day', label, 100 - rem, Number.isFinite(t) ? t : null), pool: pool.trim() });
  }
  return windows.length ? { id: 'antigravity', label: 'Antigravity', windows, source: 'agy /usage' } : null;
}

export async function probeCodex() {
  const dirs = [path.join(HOME, '.codex/sessions')];
  let newest = null;
  const walk = d => { let es = []; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.jsonl')) { const t = fs.statSync(p).mtimeMs; if (!newest || t > newest.t) newest = { p, t }; } } };
  dirs.forEach(walk);
  if (!newest) return null;
  // Probed every minute now, so only an unchanged log is skipped and only its tail is read: a busy hero's log runs to megabytes.
  if (codexSeen?.p === newest.p && codexSeen.t === newest.t) return codexSeen.out;
  let rl = null;
  const find = (o, k) => { if (o && typeof o === 'object') { if (k in o) return o[k]; for (const v of Object.values(o)) { const r = find(v, k); if (r != null) return r; } } return null; };
  const scan = text => { for (const line of text.split('\n')) if (line.includes('"rate_limits"')) { try { const r = find(JSON.parse(line), 'rate_limits'); if (r?.primary) rl = r; } catch {} } };
  scan(tail(newest.p, 1 << 20)); if (!rl) scan(fs.readFileSync(newest.p, 'utf8')); // one huge last event can push every record out of the tail
  codexSeen = { p: newest.p, t: newest.t, out: null };
  if (!rl) return null;
  const ms = s => (s > 1e12 ? s : s * 1000);
  const windows = [['primary', 'five_hour', '5h'], ['secondary', 'seven_day', '7d']].filter(([k]) => rl[k])
    .map(([k, kind, label]) => win(kind, label, rl[k].used_percent, ms(rl[k].resets_at)));
  return (codexSeen.out = { id: 'codex', label: 'Codex', plan: rl.plan_type, windows, observedAt: newest.t, source: 'codex session log' });
}
let codexSeen = null;
const tail = (p, n) => { const fd = fs.openSync(p, 'r'); try { const size = fs.fstatSync(fd).size, len = Math.min(size, n), b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, size - len); return b.toString('utf8'); } finally { fs.closeSync(fd); } };

// Grok only shows its weekly limit in the interactive UI: open it on a private tmux socket, read /usage, quit.
let grokBusy = false;
export async function probeGrok(cwd) {
  if (process.platform === 'win32') return probeGrokConpty(cwd);
  if (grokBusy) return null; grokBusy = true;
  const T = (...a) => sh('tmux', ['-L', 'hf-grok-usage', ...a], 15000, cwd);
  try {
    await T('kill-server');
    await T('new-session', '-d', '-s', 'g', '-x', '160', '-y', '50', 'grok');
    await sleep(10000);
    await T('send-keys', '-t', 'g', '/usage'); await sleep(1500);
    await T('send-keys', '-t', 'g', 'Enter'); await sleep(8000);
    const screen = await T('capture-pane', '-t', 'g', '-p'); probeGrok.lastScreen = screen;
    await T('send-keys', '-t', 'g', 'Escape'); await sleep(500);
    await T('send-keys', '-t', 'g', 'C-q'); await sleep(800);
    return parseGrokUsage(screen);
  } finally { await T('kill-server'); grokBusy = false; }
}

export function parseGrokUsage(raw) {
  const screen = stripVTControlCharacters(raw).replace(/\r/g, '\n');
  const pct = screen.match(/Weekly limit[^\n]*\n[\s\S]*?(\d{1,3})%/), reset = screen.match(/Resets:\s*([^\n│]+)/);
  return pct && +pct[1] <= 100 ? { id: 'grok', label: 'Grok', windows: [win('seven_day', 'SuperGrok weekly', +pct[1], when(reset?.[1]))], source: 'grok /usage (interactive)' } : null;
}
export async function probeGrokConpty(cwd, start = spawnConpty, wait = sleep) {
  if (grokBusy) return null; grokBusy = true;
  let child, timer, screen = '';
  try {
    child = await start('grok', [], { cwd });
    timer = setTimeout(() => child.kill(), 30000); timer.unref?.();
    child.on('error', () => {}); child.stdin.on('error', () => {});
    createInterface({ input: child.stdout }).on('line', line => { try { const m = JSON.parse(line); if (m.t === 'o') screen = (screen + Buffer.from(m.d, 'base64').toString()).slice(-262144); } catch {} });
    const send = text => { if (child.stdin.writable) child.stdin.write(JSON.stringify({ t: 'i', d: Buffer.from(text).toString('base64') }) + '\n'); };
    await wait(10000); send('/usage'); await wait(1500); send('\r'); await wait(8000);
    const result = parseGrokUsage(screen); send('\x1b'); await wait(500); send('\x11'); return result;
  } finally { clearTimeout(timer); child?.kill(); grokBusy = false; }
}

// Kimi Code (v0.94) shows its plan limits only in the interactive UI. It opens in a fixed probe folder (trusted on the
// first run) with a throwaway home, so none of the human's MCP servers start; /usage costs no model quota.
let kimiBusy = false;
const KIMI_PROBE = path.join(os.tmpdir(), 'amygdala-kimi-usage');
const kimiTrust = screen => /Trust this folder/i.test(stripVTControlCharacters(screen));
export async function probeKimi(dir = KIMI_PROBE, home = HOME) {
  if (kimiBusy) return null; kimiBusy = true;
  try {
    fs.mkdirSync(dir, { recursive: true }); prepareKimi(dir, { home });
    const env = { ...process.env, PATH, ...kimiPaths(dir).env };
    if (process.platform === 'win32') return await probeKimiConpty(dir, env);
    const T = (...a) => new Promise(res => execFile('tmux', ['-L', 'hf-kimi-usage', ...a], { timeout: 15000, cwd: dir, env }, (e, out) => res(String(out || ''))));
    try {
      await T('kill-server');
      await T('new-session', '-d', '-s', 'k', '-x', '160', '-y', '50', kimiBin(home));
      await sleep(8000);
      if (kimiTrust(await T('capture-pane', '-t', 'k', '-p'))) { await T('send-keys', '-t', 'k', 'Enter'); await sleep(5000); }
      await T('send-keys', '-t', 'k', '/usage'); await sleep(1500);
      await T('send-keys', '-t', 'k', 'Enter'); await sleep(6000);
      return parseKimiUsage(await T('capture-pane', '-t', 'k', '-p'));
    } finally { await T('kill-server'); }
  } finally { cleanupKimi(dir); kimiBusy = false; }
}
export async function probeKimiConpty(dir, env, start = spawnConpty, wait = sleep, bin = kimiBin()) {
  let child, timer, screen = '';
  try {
    child = await start(bin, [], { cwd: dir, env });
    timer = setTimeout(() => child.kill(), 40000); timer.unref?.();
    child.on('error', () => {}); child.stdin.on('error', () => {});
    createInterface({ input: child.stdout }).on('line', line => { try { const m = JSON.parse(line); if (m.t === 'o') screen = (screen + Buffer.from(m.d, 'base64').toString()).slice(-262144); } catch {} });
    const send = text => { if (child.stdin.writable) child.stdin.write(JSON.stringify({ t: 'i', d: Buffer.from(text).toString('base64') }) + '\n'); };
    await wait(8000); if (kimiTrust(screen)) { send('\r'); await wait(5000); }
    send('/usage'); await wait(1500); send('\r'); await wait(6000);
    return parseKimiUsage(screen);
  } finally { clearTimeout(timer); child?.kill(); }
}
// "5h limit  ████░░  18% used  resets in 3h 46m" / "Monthly limit … 1% used  resets in 30d 2h 58m"
export function parseKimiUsage(raw, now = Date.now()) {
  const screen = stripVTControlCharacters(raw).replace(/\r/g, '\n'), windows = [];
  const after = t => { const d = +(t.match(/(\d+)\s*d/)?.[1] || 0), h = +(t.match(/(\d+)\s*h/)?.[1] || 0), m = +(t.match(/(\d+)\s*m(?!o)/)?.[1] || 0); return d + h + m ? now + ((d * 24 + h) * 60 + m) * 60000 : null; };
  for (const [re, kind, label] of [[/5h limit[^\n]*?(\d{1,3})% used(?:[^\n]*?resets in ([^\n│]+))?/i, 'five_hour', 'Kimi 5h'], [/Monthly limit[^\n]*?(\d{1,3})% used(?:[^\n]*?resets in ([^\n│]+))?/i, 'monthly', 'Kimi monthly']]) {
    const m = screen.match(re); if (m && +m[1] <= 100) windows.push(win(kind, label, +m[1], m[2] ? after(m[2]) : null));
  }
  return windows.length ? { id: 'kimi', label: 'Kimi', windows, source: 'kimi /usage (interactive)' } : null;
}
