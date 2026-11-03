// The Watchtower's permanent log (v0.89): every hit, verdict, bell, escalation and settings change, appended to
// data/audit-log.jsonl and hash-chained like the governance ledger, so the human can check months later exactly what was
// flagged and what was decided. Never truncated or rewritten; s.audits stays the trimmed working state. Village only.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';

const sha = s => crypto.createHash('sha256').update(s).digest('hex');
// Sorted keys, so the hash does not depend on the order fields were written in.
export const canon = v => Array.isArray(v) ? '[' + v.map(canon).join(',') + ']' : v && typeof v === 'object' ? '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}' : JSON.stringify(v);
// Its own guard, whatever the caller checked: isle, tagged, quarantined, sealed and private heroes never reach the file.
export const villageHero = h => !!h && h.zone === 'village' && !h.isleTagged && !h.quarantined && !h.sealed && !h.private;
const MAX_PAGE = 200;
const hero = h => ({ heroId: h.id, heroTitle: String(h.title || '').slice(0, 160), project: h.project ?? null, host: h.host ?? null });

export class AuditLog {
  constructor(dir, { redact = s => s } = {}) {
    this.file = path.join(dir, 'audit-log.jsonl'); this.redact = redact; this.seq = 0; this.last = ''; this.checked = null;
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}
    // Only the tail is read on start: the last full line carries the seq and hash the chain continues from.
    try {
      const size = fs.statSync(this.file).size, length = Math.min(size, 256 << 10), buf = Buffer.alloc(length), fd = fs.openSync(this.file, 'r');
      try { fs.readSync(fd, buf, 0, length, size - length); } finally { fs.closeSync(fd); }
      const text = buf.toString('utf8'), tail = text.split('\n').filter(Boolean).reverse(); this.torn = size > 0 && !text.endsWith('\n');
      for (const line of tail) { try { const e = JSON.parse(line); if (Number.isSafeInteger(e.seq) && typeof e.hash === 'string') { this.seq = e.seq; this.last = e.hash; break; } } catch {} }
    } catch {}
  }
  append(kind, fields) {
    const body = JSON.parse(JSON.stringify({ seq: this.seq + 1, ts: Date.now(), kind, ...fields, prev: this.last })), entry = { ...body, hash: sha(canon(body)) };
    // A crash mid-append leaves a torn last line: the next entry starts on its own line, so it isn't glued onto it.
    try { fs.appendFileSync(this.file, (this.torn ? '\n' : '') + JSON.stringify(entry) + '\n', { mode: 0o600 }); this.torn = false; } catch (e) { this.torn = true; console.error(`Watchtower log: ${e.message}`); return null; }
    this.seq = entry.seq; this.last = entry.hash; return entry;
  }
  hit(h, a, why) { if (!villageHero(h)) return null; return this.append('hit', { auditId: a.id, ...hero(h), heroTitle: this.redact(hero(h).heroTitle), rule: a.rule, severity: a.severity, at: a.ts, excerpt: a.excerpt, status: a.status, ...(a.status === 'covered' && { why }) }); }
  verdict(h, offeringId, auditIds, v, tier) { if (!villageHero(h) || !v) return null; return this.append('verdict', { offeringId, auditIds, heroId: h.id, tier, reviewer: v.reviewer, verdict: v.verdict, escalate: v.escalate, summary: v.summary }); }
  bell(h, b, auditIds, rule) { if (!villageHero(h)) return null; return this.append('bell', { bellId: b.id, heroId: h.id, severity: b.severity, rule, auditIds }); }
  escalation(h, offeringId, auditIds, pending) { if (!villageHero(h)) return null; return this.append('escalation', { offeringId, auditIds, heroId: h.id, state: pending ? 'pending' : 'resolved' }); }
  optout(h, who, optOut) { if (!villageHero(h)) return null; return this.append('optout', { who, heroId: h.id, heroTitle: this.redact(hero(h).heroTitle), optOut }); }
  settings(who, changes) { return Object.keys(changes).length ? this.append('settings', { who, changes }) : null; }
  // Line by line in chunks, so a log of many months is never held in memory whole.
  *lines() {
    let fd; try { fd = fs.openSync(this.file, 'r'); } catch { return; }
    try {
      const buf = Buffer.alloc(1 << 20), dec = new StringDecoder('utf8'); let rest = '', pos = 0, n;
      while ((n = fs.readSync(fd, buf, 0, buf.length, pos)) > 0) { pos += n; const parts = (rest + dec.write(buf.subarray(0, n))).split('\n'); rest = parts.pop(); yield* parts; }
      rest += dec.end(); if (rest) yield rest;
    } finally { fs.closeSync(fd); }
  }
  // The whole chain, cached until the file changes size or time.
  verify() {
    let st; try { st = fs.statSync(this.file); } catch { return true; }
    if (this.checked?.size === st.size && this.checked.mtime === st.mtimeMs) return this.checked.ok;
    let prev = '', seq = 0, ok = true, torn = false;
    for (const line of this.lines()) {
      // A torn line is passed over only when the chain picks up again after it: the next entry must link to the last good one, and a torn final line still fails.
      let e; try { e = JSON.parse(line); } catch { torn = true; continue; }
      torn = false;
      const { hash, ...body } = e || {};
      if (!e || e.seq !== seq + 1 || e.prev !== prev || sha(canon(body)) !== hash) { ok = false; break; }
      prev = hash; seq = e.seq;
    }
    if (torn) ok = false;
    this.checked = { size: st.size, mtime: st.mtimeMs, ok }; return ok;
  }
  // Newest first; each hit carries the verdicts, bells and escalations that name its audit id.
  query(q = {}) {
    const num = v => v == null || v === '' ? null : Number.isFinite(+v) ? +v : Number.isFinite(Date.parse(v)) ? Date.parse(v) : null;
    const limit = Math.min(MAX_PAGE, Math.max(1, Math.floor(num(q.limit) ?? 50))), before = num(q.before), since = num(q.since), until = num(q.until);
    const heroQ = String(q.hero || '').toLowerCase(), text = String(q.q || '').toLowerCase(), rule = q.rule ? String(q.rule) : '', severity = q.severity ? String(q.severity) : '';
    const joins = new Map(), rows = [], join = (id, key, e) => { let j = joins.get(id); if (!j) joins.set(id, j = { verdicts: [], bells: [], escalations: [] }); j[key].push(e); };
    for (const line of this.lines()) {
      let e; try { e = JSON.parse(line); } catch { continue; }
      if (!e || typeof e !== 'object') continue;
      const { prev, hash, ...shown } = e;
      if (['verdict', 'bell', 'escalation'].includes(e.kind)) { for (const id of e.auditIds || []) join(id, e.kind + 's', shown); continue; }
      if (before != null && e.seq >= before || since != null && e.ts < since || until != null && e.ts > until) continue;
      if ((rule || severity) && (e.kind !== 'hit' || rule && e.rule !== rule || severity && e.severity !== severity)) continue;
      if (heroQ && !(String(e.heroId || '').toLowerCase() === heroQ || String(e.heroTitle || '').toLowerCase().includes(heroQ))) continue;
      rows.push(shown);
    }
    const out = rows.reverse().filter(e => !text || JSON.stringify({ ...e, ...(e.kind === 'hit' && joins.get(e.auditId)) }).toLowerCase().includes(text));
    const page = out.slice(0, limit).map(e => e.kind === 'hit' ? { ...e, ...(joins.get(e.auditId) || { verdicts: [], bells: [], escalations: [] }) } : e);
    return { entries: page, next: out.length > limit ? page.at(-1).seq : null, verified: this.verify() };
  }
}
