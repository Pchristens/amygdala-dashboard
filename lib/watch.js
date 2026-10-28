// Code-only event detection; the Watch decides whether the steward needs a report.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { publicBell } from './notify.js';
const MINUTE = 60000;
const STEWARD_DOWN = 'steward-down:steward';
// Node refusals the bell may repeat; anything else becomes a generic line (no paths or transcript text cross).
const SAFE_WAKE = /^(?:Please update Amygdala on [A-Za-z][A-Za-z0-9 _-]{1,39}\.|Already running elsewhere\.|That machine is offline or has no agent-deck\.)$/;
export class Watch {
  constructor(world, conductor, dataDir, { start = true } = {}) {
    this.w = world; this.c = conductor;
    this.file = path.join(dataDir, 'steward-bell.jsonl');
    world.s.watch ??= { seen: {}, pending: [] };
    world.s.bells ??= [];
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
    if (r && [...(this.c.running?.values() || []), ...(this.c.turn ? [this.c.turn] : [])].some(t => t.name === r.name) && this.w.actsAs(r.name, 'watch')) { this.notified = true; return; }
    this.notified = this.c.duty('watch', 'village', 'watch:pending', this.state.pending.map(e => `${e.key}: ${e.key.startsWith('reset_window:') ? 'reset_window: use look for current candidates and allowance.' : e.summary}`).join('\n'));
  }
  scan(now = Date.now()) {
    this.w.steward?.scan(now);
    this.stewardScan(now);
    for (const p of this.w.s.petitions || []) if (p.status === 'pending' && now - p.askedAt > 10 * MINUTE) this.raise('petition-pending', p.id, 'village', `${p.visitor} has a pending petition (${Math.floor((now - p.askedAt) / MINUTE)} minutes old).`, now);
    const active = new Set();
    for (const h of this.w.workers) {
      if (h.sealed || h.status !== 'waiting' || this.w.petitionHero?.(h)) continue;
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
  // The human names the Steward's session (v0.41): a village, non-private Claude node hero, never guessed from a title.
  setStewardHero(workerId) {
    if (workerId === null) { this.w.s.stewardHero = null; this.stewardDown = null; this.w.changed(); return { stewardHero: null }; }
    const h = typeof workerId === 'string' && this.w.workers.find(w => w.id === workerId);
    if (!h || !h.node || !h.sessionId || h.bridge || h.zone !== 'village' || !this.w.nodes?.allowed(h.id) || this.w.petitionHero?.(h)) throw new Error('Choose a village node hero that is not private.');
    if (h.tool !== 'claude') throw new Error('The Steward must be a Claude session.');
    this.w.s.stewardHero = { workerId: h.id, node: h.node, sessionId: h.sessionId }; this.stewardDown = null; this.w.changed();
    return { stewardHero: this.w.s.stewardHero };
  }
  // Down means error or stopped (or missing) for two minutes while its node reports; an offline node is out of reach.
  stewardScan(now = Date.now()) {
    const sh = this.w.s.stewardHero;
    if (!sh || !this.w.nodes?.passes().some(p => p.id === sh.node && p.online && p.deckAvailable)) { this.stewardDown = null; return; }
    const h = this.w.workers.find(w => w.id === sh.workerId);
    if (h && !this.w.nodes.allowed(h.id)) { this.stewardDown = null; return; } // gone private: say nothing of it
    if (h && (h.archived || !['error', 'stopped'].includes(h.status))) {
      this.stewardDown = null; delete this.state.seen[STEWARD_DOWN];
      if (this.state.pending.some(e => e.key === STEWARD_DOWN)) { this.state.pending = this.state.pending.filter(e => e.key !== STEWARD_DOWN); this.w.changed(); }
      return;
    }
    this.stewardDown ??= now;
    if (now - this.stewardDown >= 2 * MINUTE) this.raise('steward-down', 'steward', 'village', "The Steward's session is down.", now);
  }
  // Only the acting Watch, in its watch duty turn, with steward-down pending; one try per fifteen minutes, six a day.
  wakeSteward(name, now = Date.now()) {
    if (!this.w.actsAs(name, 'watch') || this.w.contextTurn(name)?.job?.dutyKey !== 'watch:pending') throw new Error('Only the Watch may wake the Steward, during its watch turn.');
    if (!this.state.pending.some(e => e.key === STEWARD_DOWN)) throw new Error('The Steward is not down.');
    const sh = this.w.s.stewardHero; if (!sh) throw new Error('The human has not named the Steward\'s session.');
    const day = ts => new Date(ts).toISOString().slice(0, 10), wakes = (this.w.s.stewardWakes || []).filter(ts => now - ts < 2 * 86400000);
    if (wakes.length && now - wakes.at(-1) < 15 * MINUTE) throw new Error('The Steward was woken less than fifteen minutes ago.');
    if (wakes.filter(ts => day(ts) === day(now)).length >= 6) throw new Error('The Steward has been woken six times today.');
    this.w.s.stewardWakes = [...wakes, now]; this.w.changed();
    const fail = e => this.stewardBell(name, e);
    let early = null;
    try { this.w.nodes.startable(sh.workerId); } catch (e) { early = e; }
    if (early) { fail(early); return `The Steward could not be woken (${SAFE_WAKE.test(early.message) ? early.message : 'refused'}); the bell has rung for the human.`; }
    this.w.nodes.request(sh.node, 'start', { sessionId: sh.sessionId }, sh.workerId).then(() => this.w.addFeed(name, `${name} woke the Steward`), fail);
    return 'The wake is on its way to the Steward\'s machine. If it fails, the bell rings for the human by itself.';
  }
  stewardBell(name, e) {
    const summary = `The Steward's session is down and could not be woken.${SAFE_WAKE.test(e?.message) ? ' ' + e.message : ''}`;
    const bell = publicBell({ id: (this.w.s.bellSeq || 0) + 1, ts: Date.now(), kind: 'steward-wake', severity: 'urgent', summary, by: name, isle: false });
    this.w.s.bellSeq = bell.id; (this.w.s.bells ??= []).push(bell); this.w.s.bells = this.w.s.bells.slice(-50); this.w.changed();
  }
  turnEnded(t, outcome) {
    if (!['error', 'failed', 'aborted'].includes(outcome)) return;
    this.raise('turn-failed', `${t.name}:${t.started}`, t.zone, `${t.name}'s resident turn ended: ${outcome}.`);
    this.notify();
  }
  completed(name) {
    if (!this.w.actsAs(name, 'watch')) return;
    // Events arriving during this turn remain pending for the next one.
    this.w.steward?.decline(this.state.pending.filter(e => e.ts <= (this.w.contextTurn(name)?.startedAt ?? Date.now())).map(e => e.key));
    this.state.pending = this.state.pending.filter(e => e.ts > (this.w.contextTurn(name)?.startedAt ?? Date.now()));
    this.w.changed();
    this.notified = false;
  }
  ring(name, a) {
    if (!this.w.actsAs(name, 'watch') || !this.w.contextTurn(name)) throw new Error('Only the Watch may ring during its turn.');
    if (!['info', 'attention', 'urgent'].includes(a.severity) || typeof a.summary !== 'string' || !a.summary.trim() || a.summary.length > 200 || !Array.isArray(a.event_keys) || !a.event_keys.every(k => typeof k === 'string' && this.state.pending.some(e => e.key === k))) throw new Error('Provide severity, a report of at most 200 characters, and pending event_keys.');
    const extra = this.w.steward?.ring(a.event_keys, a.pick);
    const today = new Date().toISOString().slice(0, 10);
    const rings = fs.existsSync(this.file) ? fs.readFileSync(this.file, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
    if (rings.filter(r => new Date(r.ts).toISOString().slice(0, 10) === today).length >= 6) throw new Error('The bell has rung six times today.');
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const isle = a.event_keys.some(k => k.startsWith('isle:'));
    const bell = publicBell({ id: (this.w.s.bellSeq || 0) + 1, ts: Date.now(), severity: a.severity, summary: a.summary, by: name, isle, ...(!isle && extra) });
    fs.appendFileSync(this.file, JSON.stringify({ ...bell, ...(isle ? {} : { event_keys: a.event_keys }) }) + '\n', { mode: 0o600 });
    this.w.steward?.belled(extra);
    this.w.s.bellSeq = bell.id; this.w.s.bells.push(bell); this.w.s.bells = this.w.s.bells.slice(-50); this.w.changed();
    return 'The bell rang; your report is with the steward.';
  }
}
