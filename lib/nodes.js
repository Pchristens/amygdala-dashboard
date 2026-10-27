// Node credentials persist hashed; live reports and capabilities never persist.
import crypto from 'node:crypto';
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const text = (s, n) => typeof s === 'string' && s.length <= n && !s.includes('\0');
const idOk = s => text(s, 160) && /^[\w.:-]+$/.test(s);
export function validateReport(b) {
  if (!b || Object.keys(b).some(k => !['hostname', 'os', 'deckAvailable', 'sessions', 'results', 'usage'].includes(k)) || !text(b.hostname, 80) || !['macos', 'windows', 'linux', null].includes(b.os) || typeof b.deckAvailable !== 'boolean' || !Array.isArray(b.sessions) || b.sessions.length > 500 || !Array.isArray(b.results) || b.results.length > 40) throw new Error('Invalid node report.');
  if (new Set(b.sessions.map(s => s?.id)).size !== b.sessions.length) throw new Error('Duplicate node sessions.');
  for (const s of b.sessions) {
    if (!idOk(s.id) || !['running', 'waiting', 'idle', 'stopped', 'error'].includes(s.status) || !['claude', 'codex', 'grok', 'antigravity', 'gemini', 'other'].includes(s.tool) || !['title', 'project', 'path', 'group'].every(k => text(s[k], k === 'path' ? 2048 : 160)) || (s.isleTagged != null && typeof s.isleTagged !== 'boolean') || Object.keys(s).some(k => !['id', 'status', 'tool', 'title', 'project', 'path', 'group', 'isleTagged', 'signals'].includes(k))) throw new Error('Invalid node session.');
    if (s.signals != null && (typeof s.signals !== 'object' || Object.keys(s.signals).some(k => !['site', 'confidence', 'reason'].includes(k)) || !['library', 'forge', 'quarry', 'temple'].includes(s.signals.site) || !Number.isFinite(s.signals.confidence) || s.signals.confidence < 0 || s.signals.confidence > 1 || !text(s.signals.reason, 100))) throw new Error('Invalid classification.');
  }
  for (const r of b.results) if (!r || Object.keys(r).some(k => !['id', 'ok', 'output', 'error'].includes(k)) || !idOk(r.id) || typeof r.ok !== 'boolean' || !text(r.output, 24000) || !text(r.error, 240)) throw new Error('Invalid job result.');
  if (b.usage != null) {
    const u = b.usage;
    if (u.id !== 'claude' || !Array.isArray(u.windows) || u.windows.length > 12 || JSON.stringify(u).length > 8192) throw new Error('Invalid usage.');
    for (const w of u.windows) if (!w || !text(w.kind, 60) || (w.label != null && !text(w.label, 100)) || (w.used_percentage != null && (!Number.isFinite(w.used_percentage) || w.used_percentage < 0 || w.used_percentage > 100)) || (w.resets_at != null && (!Number.isFinite(w.resets_at) || w.resets_at < 0)) || (w.stale != null && typeof w.stale !== 'boolean')) throw new Error('Invalid usage window.');
    // Discard provider extras; only the allowance fields used by the server cross into state.
    b = { ...b, usage: { id: 'claude', windows: u.windows.map(({ kind, label, used_percentage, resets_at, stale }) => ({ kind, label, used_percentage, resets_at, stale })) } };
  }
  return b;
}
export class Nodes {
  constructor(world) { this.w = world; world.s.nodePasses ??= []; this.live = new Map(); this.jobs = new Map(); }
  issue(name, hours = 168) {
    if (!text(name, 40) || !/^[A-Za-z][A-Za-z0-9 _-]{1,39}$/.test(name) || !Number.isFinite(+hours) || +hours < 1 || +hours > 2160) throw new Error('Choose a node name and 1–2160 hours.');
    const token = 'hfn_' + crypto.randomBytes(24).toString('base64url'), p = { id: this.w.id('np'), name, tokenHash: sha(token), createdAt: Date.now(), expiresAt: Date.now() + +hours * 3600000, revoked: false };
    this.w.s.nodePasses.push(p); this.w.changed(); return { pass: this.passes().find(x => x.id === p.id), token };
  }
  auth(token) { if (typeof token !== 'string' || token.length > 100) return null; return this.w.s.nodePasses.find(p => !p.revoked && p.expiresAt > Date.now() && p.tokenHash === sha(token)) || null; }
  revoke(id) { const p = this.w.s.nodePasses.find(p => p.id === id); if (!p) throw new Error('No such node pass.'); p.revoked = true; this.live.delete(id); for (const j of this.jobs.values()) if (j.node === id) j.finish(new Error('Node revoked.')); this.w.refreshWorkers(); this.w.changed(); }
  passes() { return this.w.s.nodePasses.filter(p => !p.revoked && p.expiresAt > Date.now()).map(({ tokenHash, ...p }) => ({ ...p, os: this.live.get(p.id)?.os ?? null, online: Date.now() - (this.live.get(p.id)?.at || 0) < 13000, deckAvailable: this.live.get(p.id)?.deckAvailable || false })); }
  workers() { return this.passes().flatMap(p => (this.live.get(p.id)?.sessions || []).map(s => ({ ...s, id: `node:${p.id}:${s.id}`, sessionId: s.id, node: p.id, host: p.name, os: p.os, updatedAt: this.live.get(p.id).at, stale: !p.online }))); }
  allowed(workerId) { const w = this.w.workers.find(w => w.id === workerId); return w && w.zone === 'village' && !this.w.sites.privateWorker(w); }
  request(node, kind, payload = {}, workerId = null) {
    if (!this.passes().some(p => p.id === node && p.online && p.deckAvailable)) return Promise.reject(new Error('That machine is offline or has no agent-deck.'));
    if (!['commission', 'send', 'tail', 'stop'].includes(kind) || (kind !== 'commission' && !this.allowed(workerId))) return Promise.reject(new Error('That hero is private or gone.'));
    if (kind !== 'commission') { const w = this.w.workers.find(w => w.id === workerId); if (w.node !== node || payload.sessionId !== w.sessionId) return Promise.reject(new Error('Wrong node session.')); }
    if (kind === 'tail' && (!Number.isInteger(payload.maxChars) || payload.maxChars < 1 || payload.maxChars > 20000)) return Promise.reject(new Error('Invalid tail bound.'));
    if (this.jobs.size >= 100) return Promise.reject(new Error('Node queue is full.'));
    return new Promise((resolve, reject) => {
      const id = this.w.id('nj'), timer = setTimeout(() => finish(new Error('Node job timed out.')), 13 * 60000);
      const finish = (error, output) => { clearTimeout(timer); this.jobs.delete(id); error ? reject(error) : resolve(output); };
      this.jobs.set(id, { id, node, kind, payload, workerId, finish, sent: false });
    });
  }
  async tail(w, maxChars = 2500) { const out = await this.request(w.node, 'tail', { sessionId: w.sessionId, maxChars }, w.id); return this.allowed(w.id) ? out : null; }
  report(p, body) {
    const b = validateReport(body), old = this.live.get(p.id);
    if (old && Date.now() - old.at < 1000) throw new Error('Report rate exceeded.');
    this.live.set(p.id, { at: Date.now(), os: b.os, deckAvailable: b.deckAvailable, sessions: b.sessions.map(s => ({ ...s, signals: this.allowed(`node:${p.id}:${s.id}`) ? s.signals : undefined })) });
    this.w.refreshWorkers();
    for (const r of b.results) { const j = this.jobs.get(r.id); if (!j || j.node !== p.id || !j.sent) continue; if (j.workerId && !this.allowed(j.workerId)) j.finish(new Error('Hero is private or gone.')); else j.finish(r.ok ? null : new Error(r.error || 'Node job failed.'), r.output); }
    if (b.usage) this.w.usage.mergeDeck(b.usage);
    const jobs = [];
    for (const j of this.jobs.values()) if (j.node === p.id && !j.sent && jobs.length < 20) { if (j.workerId && !this.allowed(j.workerId)) { j.finish(new Error('Hero is private or gone.')); continue; } j.sent = true; jobs.push({ id: j.id, kind: j.kind, ...j.payload }); }
    this.w.changed();
    return { jobs, village: this.w.workers.filter(w => w.node === p.id && this.allowed(w.id)).map(w => w.sessionId) };
  }
}
