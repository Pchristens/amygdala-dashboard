// v0.57: agent CLIs a village hero launched from its shell (claude -p, codex exec, agy, grok, gemini) become its apprentices.
// Only the tool and the model flag leave this file: prompts sit in argv and may contain anything.
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile } from './bin.js';
import { scanAllowed } from './hero-apprentices.js';
const CLIS = { claude: 'claude', codex: 'codex', agy: 'agy', antigravity: 'agy', grok: 'grok', gemini: 'gemini' };
// Subcommands that are helpers, not agent runs (an MCP server, a login, a version check).
const HELPERS = new Set(['mcp', 'mcp-server', 'app-server', 'login', 'logout', 'auth', 'update', 'upgrade', 'doctor', 'config', 'completion', 'install', 'setup-token', 'migrate-installer', 'help', 'version', '--version', '-v', '-V', '--help', '-h']);
const MODEL = /^[a-z0-9][\w.:/@[\]-]{0,79}$/i, CAP = 12, TREE_MAX = 2000;
const base = t => String(t || '').split(/[\\/]/).pop().replace(/\.exe$/i, '').toLowerCase();
function cliOf(token, script = false) {
  const t = String(token || ''), b = base(t).replace(/\.[cm]?js$/, '');
  if (CLIS[b]) return CLIS[b];
  if (/[\\/]claude[\\/]versions[\\/]/.test(t)) return 'claude'; // the native installer's versioned binary
  if (script) return /@anthropic-ai[\\/]claude-code[\\/]/.test(t) ? 'claude' : /@openai[\\/]codex[\\/]/.test(t) ? 'codex' : /@google[\\/]gemini-cli[\\/]/.test(t) ? 'gemini' : null;
  return null;
}
// ps joins argv with spaces, so this is a best-effort split. The returned object is the only thing kept.
function cli(args) {
  const t = String(args || '').trim().split(/\s+/); let i = 0, tool = cliOf(t[0]);
  if (!tool && /^(node|nodejs|bun|deno)$/.test(base(t[0]))) { i = 1; while (i < t.length && (t[i].startsWith('-') || t[i] === 'run')) i++; tool = cliOf(t[i], true); }
  if (!tool || HELPERS.has(t[i + 1] || '')) return null;
  let model = '';
  for (let j = i + 1; j < t.length && !model; j++) { const a = t[j]; model = a === '--model' || a === '-m' ? t[j + 1] : a.startsWith('--model=') ? a.slice(8) : (a === '-c' || a === '--config') && /^model=/.test(t[j + 1] || '') ? t[j + 1].slice(6).replace(/^["']|["']$/g, '') : ''; }
  return { tool, model: MODEL.test(model || '') ? model : tool, wrapped: i > 0 };
}
export const agentCli = args => { const c = cli(args); return c && { tool: c.tool, model: c.model }; };
// `ps -o pid=,ppid=`: the tree alone, no argv.
export const parseTree = out => String(out || '').split('\n').map(l => l.trim().match(/^(\d+)\s+(\d+)$/)).filter(Boolean).map(m => ({ pid: +m[1], ppid: +m[2] }));
// `ps -o pid=,ppid=,lstart=,args=` with LC_ALL=C: lstart is "Wed Oct 28 09:01:02 2026" on Linux procps and macOS alike
// (the day may be space-padded). args goes straight through agentCli and is dropped.
export const parseRows = out => String(out || '').split('\n').map(l => l.match(/^\s*(\d+)\s+(\d+)\s+([A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.*)$/)).filter(Boolean).map(m => ({ pid: +m[1], ppid: +m[2], start: m[3].replace(/\s+/g, ' '), cli: cli(m[4]) }));
const kidsOf = rows => { const k = new Map(); for (const r of rows) { if (!k.has(r.ppid)) k.set(r.ppid, []); k.get(r.ppid).push(r); } return k; };
export function descendants(tree, roots, max = TREE_MAX) {
  const kids = kidsOf(tree), known = new Set(tree.map(r => r.pid)), seen = new Set(), queue = roots.filter(p => known.has(p));
  while (queue.length && seen.size < max) { const p = queue.shift(); if (seen.has(p)) continue; seen.add(p); for (const c of kids.get(p) || []) queue.push(c.pid); }
  return seen;
}
// The first agent CLI under a pane is the hero itself (a same-tool child of a node-launched one is its own wrapper, e.g.
// node codex.js → codex); an agent CLI below the hero is an apprentice, and anything it spawns in turn belongs to it.
export function shellAgents(rows, panes, host = os.hostname()) {
  const kids = kidsOf(rows), byPid = new Map(rows.map(r => [r.pid, r])), out = [];
  const walk = (pid, hero, depth) => {
    for (const c of kids.get(pid) || []) {
      if (depth > 64 || out.length >= CAP) return;
      if (!c.cli) walk(c.pid, hero, depth + 1);
      else if (!hero || hero.cli.wrapped && c.ppid === hero.pid && c.cli.tool === hero.cli.tool) walk(c.pid, c, depth + 1);
      else if (!out.some(a => a.pid === c.pid)) out.push({ pid: c.pid, key: crypto.createHash('sha256').update(`${host}:${c.pid}:${c.start}`).digest('hex'), model: c.cli.model, agentType: `shell:${c.cli.tool}` });
    }
  };
  for (const p of panes) { const root = byPid.get(p); if (root) root.cli ? walk(p, root, 0) : walk(p, null, 0); }
  return out.map(({ key, model, agentType }) => ({ key, model, agentType }));
}
const runFile = (file, args) => new Promise((resolve, reject) => execFile(file, args, { timeout: 10000, maxBuffer: 16 << 20, env: { ...process.env, LC_ALL: 'C' } }, (e, out) => e ? reject(e) : resolve(String(out))));
export const mergeAgents = (claude = [], shell = []) => [...claude, ...shell.filter(s => !claude.some(c => c.key === s.key))].slice(0, CAP);
export class ShellScanner {
  constructor(run = runFile, host = os.hostname(), platform = process.platform) { Object.assign(this, { run, host, platform, at: -Infinity, cache: new Map() }); }
  // heroes: [{ w, tmux }], w a toWorker record with its id; tmux the agent-deck tmux session name. Returns Map(w.id → agents).
  async scan(heroes, confirmed, now = Date.now()) {
    const allowed = heroes.filter(h => h?.w?.host === 'local' && scanAllowed(h.w, confirmed) && typeof h.tmux === 'string' && /^[^\0\n:.-][^\0\n:.]{0,199}$/.test(h.tmux)), out = new Map();
    if (!allowed.length || this.platform === 'win32') { this.cache.clear(); return out; }
    if (now - this.at < 15000) { for (const h of allowed) if (this.cache.has(h.w.id)) out.set(h.w.id, this.cache.get(h.w.id)); return out; }
    this.at = now; this.cache.clear();
    let tree, parent; try { tree = parseTree(await this.run('ps', ['-A', '-o', 'pid=,ppid='])); parent = new Map(tree.map(r => [r.pid, r.ppid])); } catch { return out; }
    // '=' makes tmux match the session name exactly, so a prefix can never reach another (isle) hero's session.
    const panes = new Map();
    for (const h of allowed) { try { panes.set(h.w.id, String(await this.run('tmux', ['list-panes', '-s', '-t', `=${h.tmux}`, '-F', '#{pane_pid}'])).split('\n').map(s => s.trim()).filter(s => /^\d+$/.test(s)).map(Number)); } catch {} }
    // Argv is read only for processes under allowed heroes' panes, never for the rest of the machine.
    const mine = new Map([...panes].map(([id, p]) => [id, descendants(tree, p)])), pids = new Set([...mine.values()].flatMap(s => [...s]));
    let rows = [];
    if (pids.size) try { rows = parseRows(await this.run('ps', ['-ww', '-o', 'pid=,ppid=,lstart=,args=', '-p', [...pids].slice(0, TREE_MAX).join(',')])).filter(r => pids.has(r.pid) && parent.get(r.pid) === r.ppid); } catch { return out; }
    for (const [id, set] of mine) { const agents = shellAgents(rows.filter(r => set.has(r.pid)), panes.get(id), this.host); this.cache.set(id, agents); out.set(id, agents); }
    return out;
  }
}
