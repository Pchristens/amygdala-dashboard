import { bin, deckAvailable, commissionReason, hostOs } from './bin.js';
// Syncs the human's real coding sessions from agent-deck (local + SSH remotes) into the world as workers.
import { execFile } from './bin.js';
import path from 'node:path';

const BIN = 'agent-deck';
const TOOLS = { claude: 'claude', codex: 'codex', grok: 'grok', antigravity: 'antigravity', agy: 'antigravity', gemini: 'gemini' };

function run(args) {
  return new Promise(resolve => execFile(BIN, args, { timeout: 15000, maxBuffer: 8 << 20 }, (err, out) => {
    if (err) return resolve(null);
    try { resolve(JSON.parse(out)); } catch { resolve(null); }
  }));
}

function normStatus(s) {
  s = String(s || '').toLowerCase();
  if (['running', 'busy', 'working', 'active'].includes(s)) return 'running';
  if (['waiting', 'needs_input', 'attention', 'permission'].includes(s)) return 'waiting';
  if (['idle', 'ready', 'done'].includes(s)) return 'idle';
  if (['error', 'failed', 'crashed'].includes(s)) return 'error';
  return 'stopped';
}

function toWorker(s, host) {
  const p = s.path || s.ssh_remote_path || s.project_path || '';
  return {
    id: `${host}:${s.id}`,
    title: s.title || path.basename(p) || s.id,
    tool: TOOLS[String(s.tool || '').toLowerCase()] || 'other',
    status: normStatus(s.status),
    project: path.basename(p) || s.group || 'misc',
    path: p, host, os: host === 'local' ? hostOs() : null,
    transcriptPath: s.transcript_path || '',
    group: s.group || '',
    updatedAt: Date.now(),
  };
}

export function startDeckSync(world, intervalMs = 4000) {
  let remote = [], busy = false, n = 0;
  async function poll() {
    if (!deckAvailable()) { world.setWorkers(world.bridge?.workers() ?? []); return; }
    if (busy) return; busy = true;
    try {
      const local = await run(['list', '--json']);
      if (n++ % 5 === 0) {
        const r = await run(['remote', 'sessions', '--json']);
        const sessions = r?.sessions || (Array.isArray(r) ? r : []);
        const failed = new Set((r?.errors || []).map(e => e.name));
        // Keep the last known sessions of an unreachable remote, flagged stale.
        const kept = remote.filter(w => failed.has(w.host)).map(w => ({ ...w, stale: true }));
        remote = [...sessions.map(s => toWorker(s, s.remote_name || s.remote || s.host || 'remote')), ...kept];
      }
      if (local) {
        const workers = [...local.filter(s => !s.archived).map(s => toWorker(s, s.ssh_host || 'local')), ...remote];
        world.setWorkers([...workers, ...(world.bridge?.workers() ?? [])]);
      } else world.markWorkersStale();
    } finally { busy = false; }
  }
  poll();
  setInterval(poll, intervalMs);
}
