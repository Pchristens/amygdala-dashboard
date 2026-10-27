// Code-only event detection; the Watch decides whether the steward needs a report.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const MINUTE = 60000;
export class Watch {
  constructor(world, conductor, dataDir, { start = true } = {}) {
    this.w = world; this.c = conductor;
    this.file = path.join(dataDir, 'steward-bell.jsonl');
    world.s.watch ??= { seen: {}, pending: [] };
    this.waiting = new Map();
    this.notified = false;
    if (start) this.timer = setInterval(() => this.scan(), MINUTE);
    this.timer?.unref?.();
  }
  get state() { return this.w.s.watch; }
  resident() { return this.w.dutyHolder('watch', 'village'); }
  raise(kind, id, zone, text, now = Date.now()) {
    // Isle identifiers are opaque, too: no titles, paths, errors or names cross the water.
    const key = zone === 'isle' ? `isle:${kind}:${crypto.createHash('sha256').update(String(id)).digest('hex').slice(0, 16)}` : `${kind}:${id}`;
    if (now - (this.state.seen[key] ?? -Infinity) < 2 * 3600000) return;
    this.state.seen[key] = now;
    const event = { key, ts: now, summary: zone === 'isle' ? `isle: ${kind}` : text };
    const existing = this.state.pending.find(e => e.key === key);
    if (existing) Object.assign(existing, event); else this.state.pending.push(event);
    this.w.changed();
  }
  notify() {
    const r = this.resident();
    if (!this.state.pending.length || this.notified) return;
    if (r && this.c.turn?.name === r.name && this.w.actsAs(r.name, 'watch')) { this.notified = true; return; }
    this.notified = this.c.duty('watch', 'village', 'watch:pending', this.state.pending.map(e => `${e.key}: ${e.summary}`).join('\n'));
  }
  scan(now = Date.now()) {
    for (const p of this.w.s.petitions || []) if (p.status === 'pending' && now - p.askedAt > 10 * MINUTE) this.raise('petition-pending', p.id, 'village', `${p.visitor} has a pending petition (${Math.floor((now - p.askedAt) / MINUTE)} minutes old).`, now);
    const active = new Set();
    for (const h of this.w.workers) {
      if (h.sealed || h.status !== 'waiting') continue;
      active.add(h.id);
      if (!this.waiting.has(h.id)) this.waiting.set(h.id, h.waitingSince ?? now);
      if (now - this.waiting.get(h.id) > 10 * MINUTE) this.raise('hero-waiting', h.id, h.zone, `${h.title || h.id} has waited for the human for over ten minutes.`, now);
    }
    for (const id of this.waiting.keys()) if (!active.has(id)) this.waiting.delete(id);
    for (const p of this.w.usage.snapshot().limits?.providers || []) {
      if (p.stale || !p.observedAt || now - p.observedAt > 60 * MINUTE) continue;
      for (const v of p.windows || []) if (!v.stale && v.used_percentage >= 80 && (!v.resets_at || Number(v.resets_at) * 1000 > now)) this.raise('provider-pressure', `${p.id}:${v.kind}`, 'village', `${p.label || p.id} ${v.label || v.kind}: ${v.used_percentage}% used.`, now);
    }
    for (const f of this.w.s.findings) {
      if (f.status === 'omen' && now - f.omenAt > 30 * MINUTE) this.raise('omen-pending', f.id, f.zone, `Omen ${f.id} has awaited judgment for over thirty minutes.`, now);
      if (f.delivery?.state === 'failed') this.raise('delivery-failed', f.id, f.zone, `Finding ${f.id} delivery failed.`, now);
    }
    for (const [key, ts] of Object.entries(this.state.seen)) if (now - ts >= 2 * 3600000) delete this.state.seen[key];
    this.notify();
  }
  turnEnded(t, outcome) {
    if (!['error', 'failed', 'aborted'].includes(outcome)) return;
    this.raise('turn-failed', `${t.name}:${t.started}`, t.zone, `${t.name}'s resident turn ended: ${outcome}.`);
    this.notify();
  }
  completed(name) {
    if (!this.w.actsAs(name, 'watch')) return;
    // Events arriving during this turn remain pending for the next one.
    this.state.pending = this.state.pending.filter(e => e.ts > (this.w.activeTurn?.startedAt ?? Date.now()));
    this.w.changed();
    this.notified = false;
  }
  ring(name, a) {
    if (!this.w.actsAs(name, 'watch') || this.w.activeTurn?.resident !== name) throw new Error('Only the Watch may ring during its turn.');
    if (!['info', 'attention', 'urgent'].includes(a.severity) || typeof a.summary !== 'string' || !a.summary.trim() || a.summary.length > 200 || !Array.isArray(a.event_keys) || !a.event_keys.every(k => typeof k === 'string' && this.state.pending.some(e => e.key === k))) throw new Error('Provide severity, a report of at most 200 characters, and pending event_keys.');
    const today = new Date().toISOString().slice(0, 10);
    const rings = fs.existsSync(this.file) ? fs.readFileSync(this.file, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
    if (rings.filter(r => new Date(r.ts).toISOString().slice(0, 10) === today).length >= 6) throw new Error('The bell has rung six times today.');
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.appendFileSync(this.file, JSON.stringify({ ts: Date.now(), severity: a.severity, summary: a.summary, event_keys: a.event_keys, by: name }) + '\n', { mode: 0o600 });
    return 'The bell rang; your report is with the steward.';
  }
}
