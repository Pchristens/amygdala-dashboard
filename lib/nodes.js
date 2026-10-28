import { validGhostBox, acceptGhosts } from './isle-ghosts.js';
import { validAuditHit } from './audit.js';
import { bellBatch } from './notify.js';
import { PassThrough, Writable } from 'node:stream';
import { EventEmitter } from 'node:events';
// Node credentials persist hashed; live reports and capabilities never persist.
import crypto from 'node:crypto';
import { IMAGE_TYPES, IMAGE_B64_MAX } from './pastes.js';
// An un-updated node answers a job kind it does not know with its catch-all failure text.
export const LEGACY_FAILURE = 'Local node job failed; check folder and agent-deck.';
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const text = (s, n) => typeof s === 'string' && s.length <= n && !s.includes('\0');
const idOk = s => text(s, 160) && /^[\w.:-]+$/.test(s);
export function validateReport(b) {
  if (!b || Object.keys(b).some(k => !['hostname', 'os', 'deckAvailable', 'sessions', 'results', 'usage', 'bellAck', 'apprentices', 'auditHits', 'isleGhosts'].includes(k)) || !text(b.hostname, 80) || !['macos', 'windows', 'linux', null].includes(b.os) || typeof b.deckAvailable !== 'boolean' || !Array.isArray(b.sessions) || b.sessions.length > 500 || !Array.isArray(b.results) || b.results.length > 40) throw new Error('Invalid node report.');
  if (b.isleGhosts != null) {
    if (!Array.isArray(b.isleGhosts) || b.isleGhosts.length > 500 || JSON.stringify(b.isleGhosts).length > 2 * 1024 * 1024 || new Set(b.isleGhosts.map(x => x?.heroId)).size !== b.isleGhosts.length) throw new Error('Invalid isle ghosts.');
    for (const g of b.isleGhosts) if (!g || Object.keys(g).sort().join() !== 'boxes,heroId' || !idOk(g.heroId) || !Array.isArray(g.boxes) || g.boxes.length > 12 || !g.boxes.every(validGhostBox)) throw new Error('Invalid isle ghosts.');
  }
  if (b.auditHits != null && (!Array.isArray(b.auditHits) || b.auditHits.length > 500 || !b.auditHits.every(validAuditHit))) throw new Error('Invalid audit hits.');
  if (b.apprentices != null) {
    if (!Array.isArray(b.apprentices) || b.apprentices.length > 500 || new Set(b.apprentices.map(a => a?.heroId)).size !== b.apprentices.length) throw new Error('Invalid apprentices.');
    for (const a of b.apprentices) {
      if (!a || Object.keys(a).some(k => !['heroId', 'subagents'].includes(k)) || !idOk(a.heroId) || !Array.isArray(a.subagents) || a.subagents.length > 12) throw new Error('Invalid apprentices.');
      for (const x of a.subagents) if (!x || Object.keys(x).some(k => !['key', 'model', 'agentType'].includes(k)) || !/^[a-f0-9]{64}$/.test(x.key) || !text(x.model, 160) || !text(x.agentType, 160)) throw new Error('Invalid apprentice.');
    }
  }
  if (b.bellAck != null && (!Number.isSafeInteger(b.bellAck) || b.bellAck < 0)) throw new Error('Invalid bell acknowledgement.');
  if (new Set(b.sessions.map(s => s?.id)).size !== b.sessions.length) throw new Error('Duplicate node sessions.');
  for (const s of b.sessions) {
    if ((s.archived !== undefined && typeof s.archived !== 'boolean') || (s.lastActivityAt !== undefined && s.lastActivityAt !== null && (!Number.isSafeInteger(s.lastActivityAt) || s.lastActivityAt < 0)) || (s.model != null && !text(s.model, 160)) || ['private', 'quarantined', 'sealed'].some(k => s[k] != null && typeof s[k] !== 'boolean') || !idOk(s.id) || !['running', 'waiting', 'idle', 'stopped', 'error'].includes(s.status) || !['claude', 'codex', 'grok', 'antigravity', 'gemini', 'other'].includes(s.tool) || !['title', 'project', 'path', 'group'].every(k => text(s[k], k === 'path' ? 2048 : 160)) || (s.isleTagged != null && typeof s.isleTagged !== 'boolean') || Object.keys(s).some(k => !['id', 'status', 'tool', 'title', 'project', 'path', 'group', 'isleTagged', 'signals', 'model', 'archived', 'lastActivityAt', 'private', 'quarantined', 'sealed'].includes(k))) throw new Error('Invalid node session.');
    if (s.signals != null && (typeof s.signals !== 'object' || Object.keys(s.signals).some(k => !['site', 'confidence', 'reason'].includes(k)) || !['library', 'forge', 'quarry', 'temple'].includes(s.signals.site) || !Number.isFinite(s.signals.confidence) || s.signals.confidence < 0 || s.signals.confidence > 1 || !text(s.signals.reason, 100))) throw new Error('Invalid classification.');
  }
  for (const r of b.results) if (!r || Object.keys(r).some(k => !['id', 'ok', 'output', 'error'].includes(k)) || !idOk(r.id) || typeof r.ok !== 'boolean' || !text(r.output, 24000) || !text(r.error, 240)) throw new Error('Invalid job result.');
  if (b.usage != null) {
    const u = b.usage;
    if (!['claude', 'grok'].includes(u.id) || !Array.isArray(u.windows) || u.windows.length > 12 || JSON.stringify(u).length > 8192) throw new Error('Invalid usage.');
    for (const w of u.windows) if (!w || !text(w.kind, 60) || (w.label != null && !text(w.label, 100)) || (w.used_percentage != null && (!Number.isFinite(w.used_percentage) || w.used_percentage < 0 || w.used_percentage > 100)) || (w.resets_at != null && (!Number.isFinite(w.resets_at) || w.resets_at < 0)) || (w.stale != null && typeof w.stale !== 'boolean')) throw new Error('Invalid usage window.');
    // Discard provider extras; only the allowance fields used by the server cross into state.
    b = { ...b, usage: { id: u.id, windows: u.windows.map(({ kind, label, used_percentage, resets_at, stale }) => ({ kind, label, used_percentage, resets_at, stale })) } };
  }
  return b;
}
export class Nodes {
  constructor(world) { this.w = world; world.s.nodePasses ??= []; this.live = new Map(); this.jobs = new Map(); this.terms = new Map(); }
  issue(name, hours = 168) {
    if (!text(name, 40) || !/^[A-Za-z][A-Za-z0-9 _-]{1,39}$/.test(name) || !Number.isFinite(+hours) || +hours < 1 || +hours > 2160) throw new Error('Choose a node name and 1–2160 hours.');
    const token = 'hfn_' + crypto.randomBytes(24).toString('base64url'), p = { id: this.w.id('np'), name, tokenHash: sha(token), createdAt: Date.now(), expiresAt: Date.now() + +hours * 3600000, revoked: false, notify: true, bellCursor: this.w.s.bellSeq || 0, bellAck: this.w.s.bellSeq || 0 };
    this.w.s.nodePasses.push(p); this.w.changed(); return { pass: this.passes().find(x => x.id === p.id), token };
  }
  auth(token) { if (typeof token !== 'string' || token.length > 100) return null; return this.w.s.nodePasses.find(p => !p.revoked && p.expiresAt > Date.now() && p.tokenHash === sha(token)) || null; }
  revoke(id) { const p = this.w.s.nodePasses.find(p => p.id === id); if (!p) throw new Error('No such node pass.'); p.revoked = true; this.live.delete(id); for (const j of this.jobs.values()) if (j.node === id) j.finish(new Error('Node revoked.')); for (const t of this.terms.values()) if (t.node === id) t.child.kill(); this.w.refreshWorkers(); this.w.changed(); }
  setNotify(id, on) { const p = this.w.s.nodePasses.find(p => p.id === id && !p.revoked); if (!p || typeof on !== 'boolean') throw new Error('Expected a node and on boolean.'); p.notify = on; this.w.changed(); }
  passes() { return this.w.s.nodePasses.filter(p => !p.revoked && p.expiresAt > Date.now()).map(({ tokenHash, ...p }) => ({ ...p, notify: p.notify !== false, os: this.live.get(p.id)?.os ?? null, online: Date.now() - (this.live.get(p.id)?.at || 0) < 13000, deckAvailable: this.live.get(p.id)?.deckAvailable || false })); }
  workers() { return this.passes().flatMap(p => (this.live.get(p.id)?.sessions || []).map(s => ({ ...s, id: `node:${p.id}:${s.id}`, sessionId: s.id, node: p.id, host: p.name, os: p.os, updatedAt: this.live.get(p.id).at, stale: !p.online }))); }
  isleSessions(p) { return (this.live.get(p.id)?.sessions || []).filter(s => s.zone === 'isle' || s.isleTagged || s.quarantined || s.sealed || this.w.sites.privateWorker({ ...s, private: false, host: p.name })).map(s => s.id); }
  allowed(workerId) { const w = this.w.workers.find(w => w.id === workerId); return w && w.zone === 'village' && !w.isleTagged && !w.quarantined && !w.sealed && !w.private && !this.w.sites.privateWorker(w); }
  openTerm(workerId) {
    const w = this.w.workers.find(w => w.id === workerId);
    if (!this.allowed(workerId) || !this.passes().some(p => p.id === w.node && p.online && p.deckAvailable)) throw new Error('Node hero is private or offline.');
    const id = this.w.id('nt'), child = new EventEmitter(), queue = [];
    child.stdout = new PassThrough();
    let queuedBytes = 0, waiting;
    child.acceptInput = line => {
      const bytes = Buffer.byteLength(line);
      if (queuedBytes + bytes > (256 << 10)) { const e = new Error('Node terminal is busy.'); e.status = 429; throw e; }
      queue.push(line); queuedBytes += bytes;
    };
    child.stdin = new Writable({ highWaterMark: 256 << 10, write: (chunk, enc, done) => {
      try { child.acceptInput(String(chunk)); done(); } catch (e) { if (e.status === 429) waiting = { line: String(chunk), done }; else done(e); }
    } });
    child.takeInput = () => {
      const input = queue.splice(0); queuedBytes = 0;
      if (waiting) { const next = waiting; waiting = null; child.acceptInput(next.line); next.done(); }
      return input;
    };
    child.kill = () => { if (!this.terms.delete(id)) return; child.stdout.end(); child.emit('close'); };
    this.terms.set(id, { id, node: w.node, workerId, sessionId: w.sessionId, child, queue, sent: false });
    return child;
  }
  termPoll(pass, b) {
    if (!this.w.s.nodePasses.some(p => p === pass && !p.revoked && p.expiresAt > Date.now())) throw new Error('Invalid node pass.');
    if (!b || !Array.isArray(b.output) || b.output.length > 32) throw new Error('Invalid terminal poll.');
    for (const t of this.terms.values()) if (t.node === pass.id && !this.allowed(t.workerId)) t.child.kill();
    for (const o of b.output) {
      const t = this.terms.get(o.id);
      if (!t || t.node !== pass.id || !t.sent || !this.allowed(t.workerId)) throw new Error('Unrequested terminal.');
      if (o.exit === true) { t.child.kill(); continue; }
      if (typeof o.d !== 'string' || o.d.length > 90000 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(o.d)) throw new Error('Invalid terminal output.');
      t.child.stdout.write(JSON.stringify({ t: 'o', d: o.d }) + '\n');
    }
    const terms = [];
    for (const t of this.terms.values()) if (t.node === pass.id && this.allowed(t.workerId)) { terms.push({ id: t.id, sessionId: t.sessionId, open: !t.sent, input: t.child.takeInput() }); t.sent = true; }
    return { terms };
  }
  request(node, kind, payload = {}, workerId = null) {
    if (!this.passes().some(p => p.id === node && p.online && p.deckAvailable)) return Promise.reject(new Error('That machine is offline or has no agent-deck.'));
    if (payload.stewardWindow) { try { this.w.steward.guard(payload.stewardWindow); } catch (e) { return Promise.reject(e); } }
    if (!['commission', 'send', 'tail', 'stop', 'revive', 'forget', 'image', 'start'].includes(kind) || (kind !== 'commission' && !this.allowed(workerId))) return Promise.reject(new Error('That hero is private or gone.'));
    if (kind !== 'commission') { const w = this.w.workers.find(w => w.id === workerId); if (w.node !== node || payload.sessionId !== w.sessionId) return Promise.reject(new Error('Wrong node session.')); }
    if (kind === 'start') { try { this.startable(workerId); } catch (e) { return Promise.reject(e); } if (Object.keys(payload).join() !== 'sessionId') return Promise.reject(new Error('Invalid start.')); }
    if (['revive', 'forget'].includes(kind)) { const w = this.w.workers.find(w => w.id === workerId); if (typeof w.archived !== 'boolean' || w.lastActivityAt === undefined) return Promise.reject(new Error(`Please update Amygdala on ${w.host}.`)); if (!w.archived && w.status !== 'stopped') return Promise.reject(new Error('Hero is still active.')); }
    if (kind === 'tail' && (!Number.isInteger(payload.maxChars) || payload.maxChars < 1 || payload.maxChars > 20000)) return Promise.reject(new Error('Invalid tail bound.'));
    if (kind === 'image' && (Object.keys(payload).sort().join() !== 'd,sessionId,type' || !Object.hasOwn(IMAGE_TYPES, payload.type) || typeof payload.d !== 'string' || payload.d.length > IMAGE_B64_MAX)) return Promise.reject(new Error('Invalid image.'));
    if (this.jobs.size >= 100) return Promise.reject(new Error('Node queue is full.'));
    return new Promise((resolve, reject) => {
      const id = this.w.id('nj'), timer = setTimeout(() => finish(new Error('Node job timed out.')), kind === 'image' ? 60000 : 13 * 60000);
      const finish = (error, output) => { clearTimeout(timer); this.jobs.delete(id); error ? reject(error) : resolve(output); };
      this.jobs.set(id, { id, node, kind, payload, workerId, finish, sent: false });
    });
  }
  // The Watch's wake (v0.41): only the human-named Steward, errored or stopped, on an online node.
  startable(workerId) {
    const sh = this.w.s.stewardHero, w = this.w.workers.find(w => w.id === workerId);
    if (!sh || sh.workerId !== workerId) throw new Error('Only the Steward may be started this way.');
    if (!this.passes().some(p => p.id === sh.node && p.online && p.deckAvailable)) throw new Error('That machine is offline or has no agent-deck.');
    if (!w || !this.allowed(workerId) || w.node !== sh.node || w.sessionId !== sh.sessionId) throw new Error('That hero is private or gone.');
    if (w.archived || !['error', 'stopped'].includes(w.status)) throw new Error('Hero is still active.');
    return w;
  }
  stewardSession(p) { const sh = this.w.s.stewardHero; return sh?.node === p.id && this.allowed(sh.workerId) ? sh.sessionId : null; }
  async tail(w, maxChars = 2500) { const out = await this.request(w.node, 'tail', { sessionId: w.sessionId, maxChars }, w.id); return this.allowed(w.id) ? out : null; }
  report(p, body) {
    const confirmed = new Set(this.w.workers.filter(w => w.node === p.id && this.allowed(w.id)).map(w => w.sessionId));
    const confirmedIsle = new Set(this.isleSessions(p));
    const b = validateReport(body), old = this.live.get(p.id);
    if (old && Date.now() - old.at < 1000) throw new Error('Report rate exceeded.');
    if (b.bellAck != null && b.bellAck <= (p.bellCursor || 0)) p.bellAck = Math.max(p.bellAck || 0, b.bellAck);
    const bells = p.notify === false ? [] : bellBatch(this.w.s.bells || [], p.bellCursor || 0, Date.now(), Date.now() - (p.lastReport || p.createdAt) > 6 * 3600000);
    if (bells.length) p.bellCursor = bells.at(-1).id;
    if (p.notify === false) p.bellCursor = this.w.s.bellSeq || 0;
    p.lastReport = Date.now();
    this.live.set(p.id, { at: Date.now(), os: b.os, deckAvailable: b.deckAvailable, sessions: b.sessions.map(s => ({ ...s, signals: this.allowed(`node:${p.id}:${s.id}`) ? s.signals : undefined })) });
    this.w.refreshWorkers();
    const isle = this.isleSessions(p);
    this.live.get(p.id).apprentices = (b.apprentices || []).filter(a => this.allowed(`node:${p.id}:${a.heroId}`));
    for (const g of b.isleGhosts || []) if (confirmedIsle.has(g.heroId) && isle.includes(g.heroId)) acceptGhosts(this.w, `node:${p.id}:${g.heroId}`, g.boxes, Date.now(), true);
    for (const hit of b.auditHits || []) { const hero = this.w.workers.find(w => w.id === `node:${p.id}:${hit.heroId}`); if (hero && confirmed.has(hit.heroId) && this.allowed(hero.id)) this.w.watchtower?.accept(hero, [hit]); }
    for (const r of b.results) { const j = this.jobs.get(r.id); if (!j || j.node !== p.id || !j.sent) continue; if (j.workerId && !this.allowed(j.workerId) && !(j.kind === 'forget' && confirmed.has(j.payload.sessionId) && !b.sessions.some(s => s.id === j.payload.sessionId))) j.finish(new Error('Hero is private or gone.')); else j.finish(r.ok ? null : new Error(j.kind === 'start' && r.error === LEGACY_FAILURE ? `Please update Amygdala on ${p.name}.` : r.error || 'Node job failed.'), r.output); }
    if (b.usage) this.w.usage.mergeDeck(b.usage);
    // At most one image (up to ~11 MB of base64) rides each report response; the rest wait for the next.
    const jobs = []; let image = false;
    for (const j of this.jobs.values()) if (j.node === p.id && !j.sent && jobs.length < 20 && !(j.kind === 'image' && image)) { if (j.kind === 'image') image = true; if (j.payload.stewardWindow) { try { this.w.steward.guard(j.payload.stewardWindow); } catch { j.finish(new Error('Reset window closed.')); continue; } } if (j.workerId && !this.allowed(j.workerId)) { j.finish(new Error('Hero is private or gone.')); continue; } if (j.kind === 'start' && this.w.s.stewardHero?.workerId !== j.workerId) { j.finish(new Error('Only the Steward may be started this way.')); continue; } j.sent = true; const { stewardWindow, ...payload } = j.payload; jobs.push({ id: j.id, kind: j.kind, ...payload }); }
    this.w.changed();
    return { jobs, bells, isle, islePublicKey: this.w.seal?.meta?.ghostPublicKey || null, isleHeroPrefix: `node:${p.id}:`, audit: { enabled: this.w.s.auditSettings?.enabled ?? true, optOut: this.w.workers.filter(w => w.node === p.id && this.w.s.auditSettings?.optOut.includes(w.id)).map(w => w.sessionId) }, village: this.w.workers.filter(w => w.node === p.id && this.allowed(w.id)).map(w => w.sessionId), steward: this.stewardSession(p) };
  }
}
