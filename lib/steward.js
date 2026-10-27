import { publicBell } from './notify.js';
const HOUR = 3600000;
export const STEWARD_DEFAULTS = { enabled: true, festivalEnabled: true, idleHours: 2, sevenDayHours: 12, sevenDaySpare: 15, fiveHourHours: 1.5, fiveHourSpare: 30 };
export class Steward {
  constructor(w) { this.w = w; w.s.steward = { ...STEWARD_DEFAULTS, ...w.s.steward }; w.s.resetWindows ??= []; w.s.humanInputAt ??= Date.now(); w.s.heroRunningAt ??= Date.now(); this.idleSince = new Map(); }
  settings(b) {
    const next = { ...this.w.s.steward };
    for (const [k, v] of Object.entries(b)) { if (!Object.hasOwn(STEWARD_DEFAULTS, k) || (typeof STEWARD_DEFAULTS[k] === 'boolean' ? typeof v !== 'boolean' : !Number.isFinite(v) || v < 0 || v > (k.endsWith('Spare') ? 90 : 168))) throw new Error('Invalid Steward setting.'); next[k] = v; }
    this.w.s.steward = next; this.maintain(); this.w.changed(); return next;
  }
  activity(now = Date.now()) { this.w.s.humanInputAt = now; if (this.w.s.resetWindows.some(r => r.status !== 'closed')) { this.maintain(now); this.w.changed(); } }
  idle(now) { return !this.w.workers.some(h => h.status === 'running') && now - Math.max(this.w.s.humanInputAt, this.w.s.heroRunningAt) >= this.w.s.steward.idleHours * HOUR; }
  budget(now = Date.now()) {
    const p = this.w.usage.snapshot().limits?.providers?.find(p => p.id === 'claude');
    if (!p || p.stale || !p.observedAt || now - p.observedAt > HOUR) return [];
    return (p.windows || []).filter(v => ['seven_day', 'five_hour'].includes(v.kind) && !v.stale && Number.isFinite(v.used_percentage) && Number.isFinite(v.resets_at) && v.resets_at * 1000 > now).map(v => ({ window: v.kind, resets_at: v.resets_at, spare: 90 - v.used_percentage, hoursLeft: (v.resets_at * 1000 - now) / HOUR, stopAt: 90 }));
  }
  pressureBlocked() { return (this.w.usage.snapshot().limits?.providers?.find(p => p.id === 'claude')?.windows || []).some(v => !v.stale && v.used_percentage >= 95); }
  allowed(h) { return h?.zone === 'village' && !h.private && !h.isleTagged && !h.quarantined && !h.sealed && !this.w.sites.privateWorker(h); }
  candidates(now) {
    return this.w.workers.filter(h => this.allowed(h) && !/[\\/]/.test(h.id)).slice(0, 8).map(h => ({ id: h.id, title: this.safe(h.title), project: this.safe(h.project), host: this.safe(h.node || h.host), tool: h.tool, status: h.status, idleMinutes: Math.floor((now - (this.idleSince.get(h.id) ?? now)) / 60000) }));
  }
  safe(s, max = 160) { return String(s || '').replace(/(?:[A-Za-z]:[\\/]|[~\\/])\S*/g, '[path]').slice(0, max); }
  reachable(id) { const h = this.w.workers.find(h => h.id === id); return this.allowed(h) && !h.stale && !!h.node && this.w.nodes.passes().some(p => p.id === h.node && p.online && p.deckAvailable); }
  scan(now = Date.now()) {
    const w = this.w;
    if (w.workers.some(h => h.status === 'running')) w.s.heroRunningAt = now;
    const ids = new Set(); for (const h of w.workers) if (this.allowed(h)) { ids.add(h.id); if (h.status === 'running' || !this.idleSince.has(h.id)) this.idleSince.set(h.id, now); }
    for (const id of this.idleSince.keys()) if (!ids.has(id)) this.idleSince.delete(id);
    this.maintain(now);
    if (this.lastScan != null && now - this.lastScan < 10 * 60000) return; this.lastScan = now;
    if (!w.s.steward.enabled || !this.idle(now) || this.pressureBlocked()) return;
    for (const b of this.budget(now)) {
      const weekly = b.window === 'seven_day', s = w.s.steward, key = `reset_window:${b.window}:${b.resets_at}`;
      if (b.hoursLeft > (weekly ? s.sevenDayHours : s.fiveHourHours) || b.spare < (weekly ? s.sevenDaySpare : s.fiveHourSpare) || w.s.resetWindows.some(r => r.key === key)) continue;
      const candidates = this.candidates(now), r = { key, ts: now, budget: b, candidates, status: 'pending', orders: [] }; w.s.resetWindows.push(r); w.s.resetWindows = w.s.resetWindows.slice(-50);
      w.watch.state.pending.push({ key, ts: now, summary: `reset_window ${JSON.stringify({ budget: b, candidates })}` });
      w.changed();
      if (!candidates.some(h => this.reachable(h.id))) this.festival(r, now);
    }
  }
  festival(r, now) { if (r.status === 'closed' || r.status === 'claimed' || !this.w.s.steward.festivalEnabled || !this.w.s.steward.enabled || !this.idle(now)) return; if (r.status !== 'festival') { const already = this.w.s.resetWindows.some(w => w.status === 'festival'); r.status = 'festival'; this.w.watch.state.pending = this.w.watch.state.pending.filter(e => e.key !== r.key); if (!already) this.w.addFeed(null, 'The spare lamps are lit: a little festival begins on the Green. Come talk and tend the tree.'); } }
  refreshCandidates() {
    const allowed = id => this.allowed(this.w.workers.find(h => h.id === id));
    for (const r of this.w.s.resetWindows) {
      r.candidates = r.candidates.filter(h => allowed(h.id));
      const e = this.w.watch.state.pending.find(e => e.key === r.key); if (e) e.summary = `reset_window ${JSON.stringify({ budget: r.budget, candidates: r.candidates })}`;
    }
    for (const b of this.w.s.bells) if (b.kind === 'reset_window') b.candidates = b.candidates.filter(h => allowed(h.id));
  }
  maintain(now = Date.now()) {
    this.refreshCandidates();
    const budgets = this.budget(now);
    for (const r of this.w.s.resetWindows) {
      if (r.status === 'closed') continue;
      const b = budgets.find(b => b.window === r.budget.window && b.resets_at === r.budget.resets_at);
      if (!this.w.s.steward.enabled || this.pressureBlocked() || !b || r.status === 'claimed' && budgets.some(v => v.spare <= 0) || b.spare <= (r.status === 'festival' ? 5 : 0) || r.status !== 'claimed' && !this.idle(now) || r.status === 'festival' && !this.w.s.steward.festivalEnabled) { this.close(r, now); continue; }
      if (['pending', 'belled', 'declined'].includes(r.status) && (r.status === 'declined' || now - (r.belledAt || r.ts) >= 30 * 60000 || !r.candidates.some(h => this.reachable(h.id)))) this.festival(r, now);
    }
  }
  close(r, now) {
    const festival = r.status === 'festival'; r.status = 'closed'; r.closedAt = now;
    for (const id of r.orders) { const o = this.w.s.orders.find(o => o.id === id); if (o && ['queued', 'working'].includes(o.status)) this.w.orders.cancel(id); }
    for (const t of this.w.conductor?.running?.values() || []) if (r.orders.includes(t.orderId)) this.w.conductor.abort('reset window closed', t);
    if (festival && !this.w.s.resetWindows.some(w => w.status === 'festival')) this.w.addFeed(null, 'The festival lamps grow quiet; the village returns to its ordinary rhythm.');
    this.w.watch.state.pending = this.w.watch.state.pending.filter(e => e.key !== r.key);
    while (this.w.s.posts.length >= 300) { const i = this.w.s.posts.findIndex(p => !p.pinned); if (i < 0) break; this.w.s.posts.splice(i, 1); }
    const outcomes = r.orders.map(id => { const o = this.w.s.orders.find(o => o.id === id); return `${id}: ${o?.status || 'gone'}`; }).join(', ') || 'none';
    this.w.s.posts.push({ id: this.w.id('p'), author: 'Steward', authorKind: 'system', zone: 'village', channel: 'commons', text: `The reset window closed. Pick: ${this.safe(r.pick === 'direct' ? 'Steward directly' : r.candidates.find(h => h.id === r.pick && this.allowed(this.w.workers.find(w => w.id === h.id)))?.title || (this.w.s.residents[r.pick]?.zone === 'village' ? r.pick : 'none or unavailable'))}. Orders and outcomes: ${outcomes}.${r.summary ? ' ' + this.safe(r.summary, 1000) : ''}`, ts: now, replyTo: null }); this.w.changed();
  }
  activeFestival(now = Date.now()) { this.maintain(now); return this.w.s.resetWindows.some(r => r.status === 'festival'); }
  ring(keys, pick) {
    const r = this.w.s.resetWindows.find(r => keys.includes(r.key) && r.status === 'pending'); if (!r) return null;
    if (keys.some(k => k.startsWith('isle:'))) throw new Error('Keep reset reports separate from isle events.');
    if (!r.candidates.some(h => h.id === pick) || !this.reachable(pick)) throw new Error('Choose a reachable reset candidate.');
    const b = this.budget().find(b => b.window === r.budget.window && b.resets_at === r.budget.resets_at); if (!b || b.spare <= 0 || !this.idle(Date.now())) throw new Error('Reset window closed.');
    return { kind: 'reset_window', budget: b, candidates: this.candidates(Date.now()), windowKey: r.key, pick };
  }
  belled(extra) { if (!extra) return; const r = this.w.s.resetWindows.find(r => r.key === extra.windowKey); r.status = 'belled'; r.belledAt = Date.now(); r.pick = extra.pick; }
  decline(keys, now = Date.now()) { for (const r of this.w.s.resetWindows) if (keys.includes(r.key) && r.status === 'pending') { r.status = 'declined'; this.festival(r, now); } }
  claim({ key, pick = 'direct' }) {
    this.maintain(); const r = this.w.s.resetWindows.find(r => r.key === key && r.status === 'belled'); if (!r) throw new Error('No available reset window.');
    if (pick !== 'direct' && !r.candidates.some(h => h.id === pick) && !this.w.s.residents[pick]) throw new Error('Unknown pick.');
    if (pick !== 'direct') { if (this.w.s.residents[pick]) this.w.orders.eligible(pick); else if (!this.reachable(pick)) throw new Error('Hero is private or unreachable.'); }
    r.status = 'claimed'; r.pick = pick; this.w.changed(); return r;
  }
  guard(key) { this.maintain(); const r = this.w.s.resetWindows.find(r => r.key === key && r.status === 'claimed'); if (!r) throw new Error('Claim an open reset window first.'); return r; }
  summary({ key, summary }) { const r = this.guard(key); if (typeof summary !== 'string' || summary.length > 1000) throw new Error('Summary must be at most 1000 characters.'); r.summary = summary; this.w.changed(); return { ok: true }; }
  wait(timeout = 3000, signal, after = this.w.s.stewardBellCursor || 0) {
    const next = () => this.w.s.bells.find(b => b.id > Math.max(after, this.w.s.stewardBellCursor || 0));
    const take = () => { const b = next(); if (!b) return null; this.w.s.stewardBellCursor = b.id; this.w.changed(); return publicBell(b); };
    if (next() || signal?.aborted) return Promise.resolve(take());
    return new Promise(resolve => { let timer; const done = () => { clearTimeout(timer); off(); signal?.removeEventListener('abort', done); resolve(take()); }; const off = this.w.onChange(() => { if (next()) done(); }); timer = setTimeout(done, Math.max(0, Math.min(3000, Number.isFinite(Number(timeout)) ? Number(timeout) : 3000)) * 1000); signal?.addEventListener('abort', done, { once: true }); });
  }
}
export async function stewardGet(steward, pathname, params, signal) {
  if (pathname === '/api/steward/budget') return { status: 200, body: { windows: steward.budget() } };
  const bell = await steward.wait(params.get('timeout') ?? 3000, signal); return { status: bell ? 200 : 204, body: bell };
}
