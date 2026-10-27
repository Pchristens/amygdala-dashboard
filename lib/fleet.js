// Fleet usage probes — every pool that feeds the village's oil, read without spending model quota:
//   Claude      `claude -p /usage` (session, weekly all-models, weekly Fable); answered by the CLI itself
//   Antigravity `agy -p=/usage` (tab-separated pools: Gemini, Claude+GPT, Argon; % remaining, ISO reset)
//   Codex       newest `rate_limits` record in Codex session logs (no usage command exists)
//   Grok        the interactive UI's /usage panel, read from a hidden tmux pane (headless mode doesn't expose it)
// Methods follow a fleet_usage.py helper script. Output shape matches agent-deck's `usage --json`.
import { buildPath } from './bin.js';
import { execFile } from './bin.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

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
  let rl = null;
  const find = (o, k) => { if (o && typeof o === 'object') { if (k in o) return o[k]; for (const v of Object.values(o)) { const r = find(v, k); if (r != null) return r; } } return null; };
  for (const line of fs.readFileSync(newest.p, 'utf8').split('\n')) if (line.includes('"rate_limits"')) { try { const r = find(JSON.parse(line), 'rate_limits'); if (r?.primary) rl = r; } catch {} }
  if (!rl) return null;
  const ms = s => (s > 1e12 ? s : s * 1000);
  const windows = [['primary', 'five_hour', '5h'], ['secondary', 'seven_day', '7d']].filter(([k]) => rl[k])
    .map(([k, kind, label]) => win(kind, label, rl[k].used_percent, ms(rl[k].resets_at)));
  return { id: 'codex', label: 'Codex', plan: rl.plan_type, windows, observedAt: newest.t, source: 'codex session log' };
}

// Grok only shows its weekly limit in the interactive UI: open it on a private tmux socket, read /usage, quit.
let grokBusy = false;
export async function probeGrok(cwd) {
  if (process.platform === 'win32') return null;
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
    const pct = screen.match(/Weekly limit[^\n]*\n[\s\S]*?(\d{1,3})%/), reset = screen.match(/Resets:\s*([^\n│]+)/);
    return pct ? { id: 'grok', label: 'Grok', windows: [win('seven_day', 'SuperGrok weekly', +pct[1], when(reset?.[1]))], source: 'grok /usage (interactive)' } : null;
  } finally { await T('kill-server'); grokBusy = false; }
}
