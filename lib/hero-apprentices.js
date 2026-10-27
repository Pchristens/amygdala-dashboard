import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { isleTagged } from './heroclass.js';
const bounded = (s, n) => typeof s === 'string' && s.length <= n && !s.includes('\0');
export function parseAgentMeta(input) {
  let m; try { m = typeof input === 'string' ? JSON.parse(input) : input; } catch { return null; }
  if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
  const out = {}; // Only these fields may leave the parser.
  for (const k of ['model', 'agentType', 'finished']) if (Object.hasOwn(m, k)) {
    if (k === 'finished' ? typeof m[k] !== 'boolean' : !bounded(m[k], 160)) return null;
    out[k] = m[k];
  }
  return out;
}
export const scanAllowed = (w, confirmed) => !!w && confirmed.includes(w.id) && w.zone === 'village' && !w.private && !w.isleTagged && !w.quarantined && !w.sealed && !isleTagged(w);
export const agentRunning = (meta, mtime, now) => meta && meta.finished !== true && Number.isFinite(mtime) && mtime <= now && now - mtime < 600000;
const family = m => {
  m = String(m || '').toLowerCase();
  return m.match(/(?:^|-)(fable|sonnet|haiku|opus|astra|sol|terra|luna|codex|flash|argon)(?:-|$)/)?.[1] || m;
};
export function apprenticeResident(model, heroModel, residents) {
  const match = m => { const v = String(m || '').toLowerCase(); return v && (residents.find(r => String(r.primaryModel ?? r.model).toLowerCase() === v) || residents.find(r => family(r.primaryModel ?? r.model) === family(v) || (family(v) === 'codex' && r.agent === 'codex'))); };
  const r = match(model) || match(heroModel);
  return r && r.zone === 'village' && !r.private && !r.sealed && !r.quarantined && !r.isleTagged ? r.name : null;
}
export class HeroScanner {
  constructor(io = fs) { this.io = io; this.cache = new Map(); }
  due(w, confirmed, now = Date.now()) { return scanAllowed(w, confirmed) && (!this.cache.has(w.id) || now - this.cache.get(w.id).at >= 15000); }
  scan(w, confirmed, children = [], now = Date.now()) {
    if (!scanAllowed(w, confirmed)) { this.cache.delete(w?.id); return []; }
    const old = this.cache.get(w.id); if (old && now - old.at < 15000) return old.agents;
    const agents = [], key = id => crypto.createHash('sha256').update(`${w.id}:${id}`).digest('hex');
    if (w.tool === 'claude' && w.transcriptPath && w.host === 'local') {
      const dir = path.join(path.dirname(w.transcriptPath), path.basename(w.transcriptPath, '.jsonl'), 'subagents');
      try {
        for (const name of this.io.readdirSync(dir).filter(n => /^agent-[\w-]+\.meta\.json$/.test(n)).slice(0, 96)) {
          if (agents.length >= 12) break;
          try {
            const metaPath = path.join(dir, name), stat = this.io.statSync(metaPath), log = this.io.statSync(metaPath.replace(/\.meta\.json$/, '.jsonl'));
            if (stat.size > 16384 || !stat.isFile() || !agentRunning({}, log.mtimeMs, now)) continue;
            const meta = parseAgentMeta(this.io.readFileSync(metaPath, 'utf8'));
            if (agentRunning(meta, log.mtimeMs, now)) agents.push({ key: key(name), model: meta.model || w.model || '', agentType: meta.agentType || '' });
          } catch {}
        }
      } catch {}
    }
    for (const c of children) if (agents.length < 12 && !agents.some(a => a.key === key(`child:${c.id}`)) && c.parentId === w.sessionId && c.zone !== 'isle' && !c.isleTagged && c.status === 'running' && !c.private && !c.quarantined && !c.sealed && !isleTagged(c)) agents.push({ key: key(`child:${c.id}`), model: c.model || c.tool || w.model || '', agentType: c.agentType || '' });
    this.cache.set(w.id, { at: now, agents }); return agents;
  }
}
export function heroApprentices(w, reports, residents, previous = [], now = Date.now()) {
  if (!scanAllowed(w, [w.id]) || w.stale) return [];
  return reports.slice(0, 12).map(a => ({ key: a.key, resident: apprenticeResident(a.model, w.model, residents), agentType: a.agentType, since: previous.find(p => p.key === a.key)?.since ?? now }));
}
