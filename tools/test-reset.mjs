import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Steward, stewardGet } from '../lib/steward.js';
import { Watch } from '../lib/watch.js';
import { Orders } from '../lib/orders.js';
import { Conductor } from '../lib/conductor.js';
import { stewardWait } from './amygdala-steward.mjs';
const H = 3600000, now = Date.now(), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amygdala-reset-'));
function fixture(kind = 'seven_day', hours = 12, used = 75) {
  const listeners = new Set(), provider = { id: 'claude', observedAt: now, windows: [{ kind, resets_at: (now + hours * H) / 1000, used_percentage: used }] };
  let seq = 0;
  const w = { s: { residents: {}, posts: [], feed: [], orders: [], humanInputAt: now - 3 * H, heroRunningAt: now - 3 * H }, workers: [{ id: 'hero', zone: 'village', title: 'A task', project: 'Garden', host: 'Node', node: 'n1', sessionId: 's1', tool: 'claude', status: 'idle' }],
    sites: { privateWorker: h => !!h.private }, nodes: { passes: () => [{ id: 'n1', online: true, deckAvailable: true }] }, usage: { snapshot: () => ({ limits: { providers: [provider] } }) },
    id: prefix => prefix + ++seq, changed() { for (const l of [...listeners]) l(); }, onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }, addFeed(a, text) { this.s.feed.push({ text }); this.changed(); }, actsAs: () => true, contextTurn: () => ({ startedAt: now }), activeTurns: [] };
  const c = { duty: () => true }; w.watch = new Watch(w, c, dir, { start: false }); w.steward = new Steward(w); w.orders = new Orders(w);
  return { w, s: w.steward, provider, listeners };
}
try {
  for (const [kind, hours, used, trigger] of [['seven_day', 12, 75, true], ['seven_day', 12.01, 75, false], ['seven_day', 12, 75.01, false], ['five_hour', 1.5, 60, true], ['five_hour', 1.51, 60, false], ['five_hour', 1.5, 60.01, false]]) {
    const { w, s } = fixture(kind, hours, used); s.scan(now); assert.equal(w.s.resetWindows.length, +trigger); s.scan(now); assert.equal(w.s.resetWindows.length, +trigger); if (trigger) { s.scan(now + 10 * 60000); assert.equal(w.s.resetWindows.length, 1); }
  }
  {
    const { w, s, provider } = fixture(); s.scan(now); w.steward = new Steward(w); w.steward.scan(now); assert.equal(w.s.resetWindows.length, 1);
    provider.windows[0].resets_at += 1; w.steward.scan(now + 10 * 60000); assert.equal(w.s.resetWindows.length, 2);
    assert.equal(w.s.resetWindows[0].status, 'closed');
  }
  for (const field of ['humanInputAt', 'heroRunningAt']) { const { w, s } = fixture(); w.s[field] = now - 1.99 * H; s.scan(now); assert.equal(w.s.resetWindows.length, 0); }
  { const { w, s } = fixture(); w.workers[0].status = 'running'; s.scan(now); assert.equal(w.s.resetWindows.length, 0); assert.equal(w.s.heroRunningAt, now); }
  { const { w, s } = fixture(); s.settings({ enabled: false }); s.scan(now); assert.equal(w.s.resetWindows.length, 0); assert.throws(() => s.settings({ sevenDaySpare: -1 })); assert.throws(() => s.settings({ enabled: 'yes' })); }
  { const { w, s, provider } = fixture(); provider.stale = true; s.scan(now); assert.equal(w.s.resetWindows.length, 0); provider.stale = false; provider.observedAt = now - 2 * H; s.scan(now + 10 * 60000); assert.equal(w.s.resetWindows.length, 0); }
  {
    const { w, s } = fixture();
    for (const flag of ['private', 'isleTagged', 'quarantined', 'sealed']) w.workers.push({ ...w.workers[0], id: flag, title: 'SECRET', [flag]: true });
    w.workers.push({ ...w.workers[0], id: 'isle', zone: 'isle', title: 'SECRET' }); w.workers[0].title = 'Task /hidden/project'; w.workers[0].path = '/hidden/project';
    const candidates = s.candidates(now); assert.equal(candidates.length, 1); assert(!JSON.stringify(candidates).includes('/hidden')); assert(!JSON.stringify(candidates).includes('SECRET')); assert(!('path' in candidates[0]));
    s.scan(now); assert.equal(w.s.resetWindows[0].status, 'pending'); s.decline([w.s.resetWindows[0].key], now); assert(s.activeFestival(now)); assert.match(w.s.feed.at(-1).text, /festival/);
  }
  for (const why of ['offline', 'unclaimed', 'declined']) {
    const { w, s, provider } = fixture(); if (why === 'offline') w.nodes.passes = () => [];
    s.scan(now); const r = w.s.resetWindows[0];
    if (why === 'unclaimed') { r.status = 'belled'; r.belledAt = now; s.maintain(now + 29 * 60000); assert.equal(r.status, 'belled'); s.maintain(now + 30 * 60000); }
    if (why === 'declined') s.decline([r.key], now);
    assert.equal(r.status, 'festival'); provider.windows[0].used_percentage = 84.9; assert(s.activeFestival(now)); provider.windows[0].used_percentage = 85; assert(!s.activeFestival(now)); assert.equal(r.status, 'closed'); assert.match(w.s.posts.at(-1).text, /Orders and outcomes/);
  }
  for (const why of ['reset', 'human', 'running', 'disabled', 'festivalDisabled', 'stale', 'pressure']) {
    const { w, s, provider } = fixture(); s.scan(now); s.decline([w.s.resetWindows[0].key], now);
    if (why === 'reset') provider.windows[0].resets_at += 7 * 24 * 3600;
    if (why === 'human') s.activity(now);
    if (why === 'running') w.workers[0].status = 'running';
    if (why === 'disabled') s.settings({ enabled: false });
    if (why === 'festivalDisabled') s.settings({ festivalEnabled: false });
    if (why === 'stale') provider.stale = true;
    if (why === 'pressure') provider.windows.push({ kind: 'seven_day_fable', used_percentage: 95 });
    assert(!s.activeFestival(now), why);
  }
  { const { w, s } = fixture(); s.settings({ festivalEnabled: false }); w.nodes.passes = () => []; s.scan(now); assert(!s.activeFestival(now)); }
  {
    const { w, s, provider } = fixture(); s.scan(now); const r = w.s.resetWindows[0];
    w.watch.ring('Watch', { severity: 'attention', summary: 'Continue the useful task.', event_keys: [r.key], pick: 'hero' });
    const bell = w.s.bells.at(-1); assert.equal(bell.kind, 'reset_window'); assert.equal(bell.budget.stopAt, 90); assert.equal(bell.candidates.length, 1);
    s.claim({ key: r.key, pick: 'hero' }); assert.equal(r.status, 'claimed');
    let sent = 0; w.nodes.request = async () => { sent++; };
    const o = await w.orders.create({ to: 'hero', from: 'steward', windowKey: r.key }); assert.equal(sent, 1); assert.equal(o.status, 'answered'); assert.equal(o.from, 'steward');
    w.workers[0].private = true; s.refreshCandidates(); assert.equal(bell.candidates.length, 0); assert(!w.watch.state.pending.some(e => e.summary.includes('A task'))); await assert.rejects(w.orders.create({ to: 'hero', from: 'steward', windowKey: r.key })); assert.equal(sent, 1);
    provider.windows[0].used_percentage = 90; assert.throws(() => s.guard(r.key)); assert.equal(r.status, 'closed');
  }
  // Exercise the scheduler without constructing a conductor or starting any CLI.
  for (const festival of [false, true]) {
    let runs = 0; const w = { s: { orders: [], residents: { Moss: { enabled: true, zone: 'village' } }, dailyTurnBudget: 100, tickSeconds: 180 }, config: [{ name: 'Moss' }], activeTurns: [], seal: { locked: false }, zoneOf: () => 'village', isHibernating: () => false, hasRole: () => false, autoTurnsToday: () => 0, countAutoTurn() {}, cfg: () => ({ name: 'Moss' }), steward: { activeFestival: () => festival } };
    const c = Object.assign(Object.create(Conductor.prototype), { world: w, running: new Map(), queue: [], pendingDuties: [], rr: 0, lastEnd: Date.now() - 100000, dispatchDuties() {}, pressureBlocked: () => false, hasNews: () => true, run(r, reasons) { runs++; if (festival) assert.match(reasons[0], /tree/); } });
    c.schedule(); assert.equal(runs, +festival); c.lastEnd = Date.now(); c.schedule(); assert.equal(runs, +festival); c.pressureBlocked = () => true; c.lastEnd = 0; c.schedule(); assert.equal(runs, +festival);
  }
  {
    const { w, s, listeners } = fixture();
    assert.equal(await s.wait(0), null); assert.equal(listeners.size, 0);
    const pending = s.wait(1); w.s.bells.push({ id: 1, ts: now, summary: 'A bell', severity: 'info', by: 'Watch' }); w.changed(); assert.equal((await pending).id, 1); assert.equal(listeners.size, 0);
    const controller = new AbortController(), cancelled = s.wait(10, controller.signal); controller.abort(); assert.equal(await cancelled, null); assert.equal(listeners.size, 0);
    const originalFetch = globalThis.fetch, base = 'http://steward.test';
    globalThis.fetch = async (url, options = {}) => {
      const u = new URL(url);
      if (u.pathname === '/') return new Response('<meta name="hf-token" content="test-token">');
      if (new Headers(options.headers).get('x-amygdala-token') !== 'test-token') return new Response(null, { status: 401 });
      const out = await stewardGet(s, u.pathname, u.searchParams); return new Response(out.status === 204 ? null : JSON.stringify(out.body), { status: out.status });
    };
    try {
      const budget = await (await fetch(base + '/api/steward/budget', { headers: { 'x-amygdala-token': 'test-token' } })).json(); assert.equal(budget.windows[0].spare, 15); assert.equal(budget.windows[0].stopAt, 90);
      assert.equal((await fetch(base + '/api/steward/wait?timeout=0')).status, 401);
      assert.equal(await stewardWait({ base, poll: globalThis.fetch, timeout: 0 }), 2);
      const wait = stewardWait({ base, poll: globalThis.fetch, timeout: 2, json: true }); setTimeout(() => { w.s.bells.push({ id: 2, ts: now, severity: 'info', summary: 'Test bell', by: 'Watch' }); w.changed(); }, 20); assert.equal(await wait, 0);
    } finally { globalThis.fetch = originalFetch; }
  }
  console.log('reset tests passed');
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
