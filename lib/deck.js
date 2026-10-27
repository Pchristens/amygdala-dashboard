import { bin, deckAvailable, commissionReason, hostOs } from './bin.js';
// Syncs the human's real coding sessions from agent-deck (local + SSH remotes) into the world as workers.
import { execFile } from './bin.js';
import path from 'node:path';
import { HeroScanner } from './hero-apprentices.js';
const heroScanner = new HeroScanner();

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

export function toWorker(s, host) {
  const p = s.path || s.ssh_remote_path || s.project_path || '';
  return {
    id: `${host}:${s.id}`,
    title: s.title || path.basename(p) || s.id,
    tool: TOOLS[String(s.tool || '').toLowerCase()] || 'other',
    status: normStatus(s.status),
    project: path.basename(p) || s.group || 'misc',
    path: p, host, os: host === 'local' ? hostOs() : null,
    transcriptPath: s.transcript_path || '', codexSessionId: s.codex_session_id || '', codexHome: s.resolved_codex_home || '', model: typeof s.model === 'string' ? s.model.slice(0, 160) : '', sessionId: s.id, parentId: s.parent_id || s.parent_session_id || null, zone: s.zone, isleTagged: !!s.isleTagged, private: !!s.private, quarantined: !!s.quarantined, sealed: !!s.sealed,
    group: s.group || '',
    updatedAt: Date.now(),
  };
}

export function startDeckSync(world, intervalMs = 4000) {
  let remote = [], busy = false, n = 0;
  async function poll() {
    if (!deckAvailable()) { world.refreshWorkers(); return; }
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
        world.setWorkers([...workers, ...(world.bridge?.workers() ?? []), ...(world.nodes?.workers() ?? [])]);
        const confirmed = world.workers.filter(w => w.zone === 'village' && !world.sites.privateWorker(w)).map(w => w.id);
        world.heroAgents = new Map();
        for (const w of world.workers.filter(w => !w.node && w.host === 'local')) {
          let children = workers;
          if (heroScanner.due(w, confirmed)) { const out = await run(['session', 'children', w.sessionId, '--json']); children = [...workers, ...(Array.isArray(out) ? out : out?.children || out?.sessions || []).map(s => ({ ...toWorker(s, 'local'), parentId: w.sessionId }))]; }
          const current = world.workers.find(h => h.id === w.id);
          world.heroAgents.set(w.id, heroScanner.scan(current, confirmed, children));
        }
      } else { world.refreshWorkers(); world.markWorkersStale(); }
    } finally { busy = false; }
  }
  poll();
  setInterval(poll, intervalMs);
}
