import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { parseAgentMeta, apprenticeResident, agentRunning } from './hero-apprentices.js';
import { redact, auditRecords, matchAudit, auditText } from './audit.js';
const hash = s => crypto.createHash('sha256').update(s).digest('hex');
const clean = (s, n) => redact(String(s || '')).slice(0, n);
export const ghostBinding = id => hash(id);
export function ghostKeys() { const k = crypto.generateKeyPairSync('x25519'); return { publicKey: k.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'), privateKey: k.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64') }; }
const pub = k => crypto.createPublicKey({ key: Buffer.from(k, 'base64'), type: 'spki', format: 'der' });
const priv = k => crypto.createPrivateKey({ key: Buffer.from(k, 'base64'), type: 'pkcs8', format: 'der' });
const aad = (kind, binding, slot) => Buffer.from(JSON.stringify(['amygdala-box-v1', kind, binding, slot]));
const derive = (privateKey, publicKey, info) => crypto.hkdfSync('sha256', crypto.diffieHellman({ privateKey, publicKey }), Buffer.alloc(0), info, 32);
export function sealBox(publicKey, kind, heroId, record) {
  const ephemeral = crypto.generateKeyPairSync('x25519'), binding = ghostBinding(heroId), slot = hash(heroId + ':' + String(record.key || '')), info = aad(kind, binding, slot), iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', derive(ephemeral.privateKey, pub(publicKey), info), iv); c.setAAD(info);
  const ct = Buffer.concat([c.update(JSON.stringify(record)), c.final()]);
  return { v: 1, binding, slot, ephemeral: ephemeral.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'), payload: Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64') };
}
export function validGhostBox(b) { return !!b && Object.keys(b).sort().join() === 'binding,ephemeral,payload,slot,v' && b.v === 1 && /^[a-f0-9]{64}$/.test(b.binding) && /^[a-f0-9]{64}$/.test(b.slot) && typeof b.ephemeral === 'string' && b.ephemeral.length === 60 && typeof b.payload === 'string' && b.payload.length >= 40 && b.payload.length <= 192000 && [b.ephemeral, b.payload].every(s => /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(s)); }
export function openBox(privateKey, kind, heroId, box) {
  if (!validGhostBox(box) || heroId != null && ghostBinding(heroId) !== box.binding) throw new Error('Invalid isle box.');
  const info = aad(kind, box.binding, box.slot), bytes = Buffer.from(box.payload, 'base64'), d = crypto.createDecipheriv('aes-256-gcm', derive(priv(privateKey), pub(box.ephemeral), info), bytes.subarray(0, 12)); d.setAAD(info); d.setAuthTag(bytes.subarray(12, 28));
  return JSON.parse(Buffer.concat([d.update(bytes.subarray(28)), d.final()]).toString('utf8'));
}
export class IsleScanner {
  constructor(io = fs) { this.io = io; this.files = new Map(); this.cacheKey = crypto.randomBytes(32); }
  pack(value) { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', this.cacheKey, iv); const ct = Buffer.concat([c.update(JSON.stringify(value)), c.final()]); return Buffer.concat([iv, c.getAuthTag(), ct]); }
  unpack(value) { const d = crypto.createDecipheriv('aes-256-gcm', this.cacheKey, value.subarray(0, 12)); d.setAuthTag(value.subarray(12, 28)); return JSON.parse(Buffer.concat([d.update(value.subarray(28)), d.final()]).toString()); }
  retain(ids) { for (const [k, v] of this.files) if (!ids.includes(v.hero)) this.files.delete(k); }
  scan(w, confirmed, publicKey, now = Date.now(), boxHeroId = w?.id) {
    if (!publicKey || !w || !confirmed.includes(w.id) || w.zone !== 'isle' || w.stale || w.host !== 'local' || w.tool !== 'claude' || !w.transcriptPath) { this.retain([...new Set([...this.files.values()].map(v => v.hero))].filter(id => id !== w?.id)); return []; }
    const boxes = [], dir = path.join(path.dirname(w.transcriptPath), path.basename(w.transcriptPath, '.jsonl'), 'subagents');
    let examined = 0;
    try { for (const name of this.io.readdirSync(dir).filter(n => /^agent-[\w-]+\.meta\.json$/.test(n)).slice(0, 96)) {
      if (examined >= 12) break;
      try {
        const file = path.join(dir, name.replace(/\.meta\.json$/, '.jsonl')), ms = this.io.statSync(path.join(dir, name)), st = this.io.statSync(file); if (!ms.isFile() || ms.size > 16384 || !st.isFile()) continue;
        const meta = parseAgentMeta(this.io.readFileSync(path.join(dir, name), 'utf8')); if (!meta) continue;
        const key = hash(w.id + ':' + name), index = w.id + ':' + file; let c = this.files.get(index);
        if (meta.finished && c?.completed) continue;
        if (!c && !agentRunning(meta, Math.floor(st.mtimeMs), now)) continue;
        if (!c || c.ino !== st.ino || st.size < c.offset) { c = { hero: w.id, ino: st.ino, offset: st.size, decoder: new StringDecoder('utf8'), tail: '', first: false, record: { key, model: clean(meta.model || w.model, 160), agentType: clean(meta.agentType, 160), startedAt: now, finished: !!meta.finished, prompt: '', actions: [], hits: [] } }; this.files.set(index, c); }
        examined++;
        if (c.packed) { const v = this.unpack(c.packed); c.record = v.record; c.tail = v.tail; }
        const r = c.record; r.finished = !!meta.finished;
        if (st.size > c.offset) {
          const length = Math.min(st.size - c.offset, 1 << 20), b = Buffer.alloc(length), fd = this.io.openSync(file, 'r'); let n; try { n = this.io.readSync(fd, b, 0, length, c.offset); } finally { this.io.closeSync(fd); } c.offset += n;
          const lines = (c.tail + c.decoder.write(b.subarray(0, n))).split('\n'); c.tail = lines.pop(); if (c.tail.length > 1 << 20) c.tail = '';
          for (const line of lines) { let e; try { e = JSON.parse(line); } catch { continue; }
            for (const a of auditRecords(e, 'claude')) {
              if (a.prompt) { if (c.first) continue; c.first = true; r.prompt = clean(a.input, 4000); }
              else r.actions.push({ tool: clean(a.tool, 160), summary: clean(a.input?.command || a.input?.cmd || a.input?.file_path || a.input?.path || (typeof a.input === 'string' ? a.input : ''), 200), ts: Number.isFinite(Date.parse(e.timestamp)) ? Date.parse(e.timestamp) : now });
              for (const hit of matchAudit(a.tool, a.input, w.path, { prompt: a.prompt })) r.hits.push({ rule: hit.id, severity: hit.severity, excerpt: clean(auditText(a.tool, a.input, a.prompt), 300), ts: now });
            }
          }
          r.actions = r.actions.slice(-50); r.hits = r.hits.slice(-30);
        }
        const signature = hash(JSON.stringify(r));
        if (c.sent !== signature || c.publicKey !== publicKey) { boxes.push(sealBox(publicKey, 'isle-ghost', boxHeroId, { heroId: boxHeroId, ...r })); c.sent = signature; c.publicKey = publicKey; }
        c.completed = r.finished; c.packed = this.pack({ record: r, tail: c.tail }); delete c.record; delete c.tail;
      } catch { const c = this.files.get(w.id + ':' + path.join(dir, name.replace(/\.meta\.json$/, '.jsonl'))); if (c) { delete c.record; delete c.tail; if (!c.packed) this.files.delete(w.id + ':' + path.join(dir, name.replace(/\.meta\.json$/, '.jsonl'))); } }
    } } catch {}
    while (this.files.size > 1200) this.files.delete(this.files.keys().next().value);
    return boxes;
  }
}
export function acceptGhosts(w, heroId, boxes, now = Date.now(), confirmed = false) {
  if (!w.seal?.meta?.ghostPublicKey || !confirmed && !w.workers.some(h => h.id === heroId && h.zone === 'isle' && !h.stale)) return;
  w.s.isleGhostInbox ??= [];
  for (const box of boxes.filter(validGhostBox)) {
    if (box.binding !== ghostBinding(heroId)) continue;
    w.s.isleGhostInbox = w.s.isleGhostInbox.filter(b => b.binding !== box.binding || b.slot !== box.slot);
    w.s.isleGhostInbox.push(box);
  }
  w.s.isleGhostInbox = w.s.isleGhostInbox.slice(-200);
  if (boxes.length) w.changed?.();
}
export function ringIsle(w, now = Date.now()) {
  if (w.s.isleGhostBellAt != null && now - w.s.isleGhostBellAt < 3600000) return;
  w.s.isleGhostBellAt = now; const id = (w.s.bellSeq || 0) + 1; w.s.bellSeq = id; (w.s.bells ??= []).push({ id, ts: now, severity: 'urgent', isle: true, text: '🔔 A bell rang on the Far Isle' }); w.s.bells = w.s.bells.slice(-50);
  if (w.save) { clearTimeout(w.saveTimer); w.saveTimer = setTimeout(() => w.save(), 400); }
}
// Opened plaintext lives only in this cache while unlocked; the lock hook drops it.
function opened(w, box) {
  if (!w.ghostCache) { w.ghostCache = new Map(); (w.lockHooks ??= []).push(() => w.ghostCache.clear()); }
  let r = w.ghostCache.get(box.payload);
  if (!r) { r = openBox(w.s.ghostPrivateKey, 'isle-ghost', null, box); w.ghostCache.set(box.payload, r); }
  return r;
}
export function ghostSnapshot(w, human) {
  if (!human || !w.seal?.key || !w.s.ghostPrivateKey) return [];
  const records = new Map(), residents = w.config.map(c => ({ ...c, ...w.s.residents[c.name] })).filter(r => r.zone === 'isle'), live = new Set((w.s.isleGhostInbox || []).map(b => b.payload));
  if (w.ghostCache) for (const k of w.ghostCache.keys()) if (!live.has(k)) w.ghostCache.delete(k);
  for (const box of w.s.isleGhostInbox || []) try {
    const r = opened(w, box), hero = w.workers.find(h => h.id === r.heroId && h.zone === 'isle' && !h.sealed); if (!hero || box.binding !== ghostBinding(hero.id) || !/^[a-f0-9]{64}$/.test(r.key) || box.slot !== hash(hero.id + ':' + r.key)) continue;
    const crit = Math.max(0, ...(r.hits || []).filter(h => h.severity === 'critical').map(h => Number(h.ts) || 0));
    if (crit > (w.isleCriticalSeen || 0)) { w.isleCriticalSeen = crit; ringIsle(w); }
    const actions = (Array.isArray(r.actions) ? r.actions : []).slice(-50).map(a => ({ tool: clean(a.tool, 160), summary: clean(a.summary, 200), ts: Number.isSafeInteger(a.ts) ? a.ts : 0 }));
    records.set(hero.id + ':' + r.key, { heroId: hero.id, key: r.key, resident: apprenticeResident(r.model, hero.model, residents, 'isle'), model: clean(r.model, 160), agentType: clean(r.agentType, 160), startedAt: Number.isSafeInteger(r.startedAt) ? r.startedAt : 0, finished: r.finished === true, prompt: clean(r.prompt, 4000), actions });
  } catch {}
  return [...records.values()].slice(-200);
}

