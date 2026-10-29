// Weekly cost per turn (v0.54): a turn's share of its provider's weekly allowance, from readings either side of it,
// counted only when nothing else could have spent that pool. Synthetic readings and heroes; no CLI or probe runs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Usage, gatingWeekly } from '../lib/usage.js';
import { World } from '../lib/world.js';
import { Conductor } from '../lib/conductor.js';
Usage.prototype.pollDeck = () => {}; Usage.prototype.probe = () => {};
const M = 60000;
const fresh = (models = {}, zones = {}) => {
  const u = Object.create(Usage.prototype);
  let seq = 0;
  u.w = { s: { turnWeekly: {}, usage: [], usageDaily: [], exhibits: [], built: [], findings: [] }, id: p => p + ++seq, changed() {}, zoneOf: n => zones[n] ?? 'village', cfg: n => ({ model: models[n] }), conductor: {} };
  Object.assign(u, { limits: { observedAt: null, providers: [] }, pending: [], activity: [], heroBusy: {}, heroSeenAt: null });
  return u;
};
const claude = (at, pct, fable) => ({ id: 'claude', label: 'Claude', observedAt: at, windows: [{ kind: 'five_hour', label: '5h', used_percentage: 5, resets_at: null },
  { kind: 'seven_day', label: '7d', used_percentage: pct, resets_at: 2e9 }, ...(fable != null ? [{ kind: 'seven_day_fable', label: '7d Fable', used_percentage: fable, resets_at: 2e9 }] : [])] });
const entry = (u, name) => Object.values(u.w.s.turnWeekly).find(e => e.resident === name);
// One turn: a reading 2 min before it starts, 8 min long, a reading 2 min after it ends.
function turn(u, { name = 'Ada', agent = 'claude', model = 'claude-opus', zone = 'village', id = 't1', T0 = Date.now() - 25 * M, provider = claude, before = 40, after = 42, heroes = [], during } = {}) {
  u.setProvider(provider(T0, before));
  u.turnBegan({ id, resident: name, agent, model, zone, started: T0 + 2 * M });
  during?.(T0);
  u.noteHeroes(heroes);
  u.record({ resident: name, agent, model, zone, kind: 'life', startedAt: T0 + 2 * M, endedAt: T0 + 10 * M, outcome: 'ok', text: '', turnId: id });
  u.setProvider(provider(T0 + 12 * M, after));
  return T0;
}

// A clean sample: the weekly rose 2 points across the turn.
let u = fresh({ Ada: 'claude-opus' });
turn(u);
assert.deepEqual([entry(u, 'Ada').n, entry(u, 'Ada').sumDelta, entry(u, 'Ada').discarded], [1, 2, 0]);
assert.equal(u.pending.length, 0);
turn(u, { id: 't2', before: 42, after: 43, T0: Date.now() - 12 * M }); // after the first, not overlapping it
let v = u.view('village').weeklyPerTurn.Ada;
assert.deepEqual([v.model, v.perTurnPct, v.samples, v.discarded], ['claude-opus', 1.5, 2, 0]); assert.match(v.window, /Claude 7d/);
assert.deepEqual(entry(u, 'Ada').recent, [2, 1]);

// A Claude hero active in between → discarded; a Codex hero running → still clean.
u = fresh();
turn(u, { heroes: [{ tool: 'claude', status: 'idle', lastActivityAt: Date.now() - 18 * M }] });
assert.deepEqual([entry(u, 'Ada').n, entry(u, 'Ada').discarded, entry(u, 'Ada').reasons.hero], [0, 1, 1]);
u = fresh();
turn(u, { heroes: [{ tool: 'codex', status: 'running' }, { tool: 'claude', status: 'idle', lastActivityAt: Date.now() - 3 * 3600000 }, { tool: 'other', status: 'stopped', archived: true }] });
assert.deepEqual([entry(u, 'Ada').n, entry(u, 'Ada').discarded], [1, 0]);
// Unknown tool running, a stale hero, or no hero sync at all → not clean.
for (const heroes of [[{ tool: 'other', status: 'running' }], [{ tool: 'claude', status: 'idle', stale: true }]]) { u = fresh(); turn(u, { heroes }); assert.equal(entry(u, 'Ada').reasons.hero, 1); }
u = fresh(); u.noteHeroes = () => {}; turn(u); assert.equal(entry(u, 'Ada').reasons.hero, 1);

// Another resident's turn on the same pool overlapping → discarded; a running isolated run → discarded.
u = fresh();
turn(u, { during: T0 => u.record({ resident: 'Bo', agent: 'claude', model: 'claude-opus', zone: 'village', kind: 'guidance', startedAt: T0 + 4 * M, endedAt: T0 + 6 * M, outcome: 'ok', text: '' }) });
assert.equal(entry(u, 'Ada').reasons.overlap, 1);
u = fresh();
turn(u, { during: T0 => u.turnBegan({ id: 'x', resident: 'Cy', agent: 'codex', model: 'gpt-5', zone: 'village', started: T0 + 3 * M }) }); // different pool: fine
assert.equal(entry(u, 'Ada').n, 1);
u = fresh(); u.w.conductor.isolatedRuns = 1; turn(u); assert.equal(entry(u, 'Ada').reasons.isolated, 1);

// The week reset in between (the reading fell) → discarded.
u = fresh(); turn(u, { before: 80, after: 3 });
assert.deepEqual([entry(u, 'Ada').n, entry(u, 'Ada').reasons.reset], [0, 1]);

// A stale or missing reading before the turn → no sample at all.
u = fresh();
u.setProvider(claude(Date.now() - 60 * M, 40)); u.turnBegan({ id: 's', resident: 'Ada', agent: 'claude', model: 'claude-opus', zone: 'village', started: Date.now() - 30 * M });
assert.equal(u.pending.length, 0);
u = fresh(); u.turnBegan({ id: 's', resident: 'Ada', agent: 'claude', model: 'claude-opus', zone: 'village', started: Date.now() }); assert.equal(u.pending.length, 0);
// No reading after → dropped once its window passes, counted as missing.
u = fresh(); u.setProvider(claude(Date.now() - 40 * M, 40)); u.turnBegan({ id: 'n', resident: 'Ada', agent: 'claude', model: 'claude-opus', zone: 'village', started: Date.now() - 38 * M });
u.noteHeroes([]); u.record({ resident: 'Ada', agent: 'claude', model: 'claude-opus', zone: 'village', kind: 'life', startedAt: Date.now() - 38 * M, endedAt: Date.now() - 30 * M, outcome: 'ok', text: '', turnId: 'n' });
assert.deepEqual([u.pending.length, entry(u, 'Ada').reasons.noReading], [0, 1]);

// An isle resident is never measured or named; its turn still keeps others' samples honest.
u = fresh({}, { Ira: 'isle' });
turn(u, { name: 'Ira', zone: 'isle' });
assert.deepEqual(u.w.s.turnWeekly, {}); assert.equal(u.pending.length, 0); assert.deepEqual(u.view('village').weeklyPerTurn, {});
assert(!JSON.stringify(u.activity).includes('Ira'));
u = fresh({}, { Ira: 'isle' });
turn(u, { during: T0 => u.turnBegan({ id: 'i', resident: 'Ira', agent: 'claude', model: 'claude-opus', zone: 'isle', started: T0 + 3 * M }) });
assert.equal(entry(u, 'Ada').reasons.overlap, 1);
assert.equal(u.view('isle').weeklyPerTurn, undefined);

// Fable models read the Fable weekly when there is one, else the all-models weekly.
const fable = (at, pct) => claude(at, 50, pct);
u = fresh(); turn(u, { model: 'claude-fable-5', provider: fable, before: 10, after: 13 });
assert.equal(entry(u, 'Ada').sumDelta, 3); assert.match(entry(u, 'Ada').window, /Fable/);
assert.equal(gatingWeekly(u.limits.providers[0], 'claude-opus').kind, 'seven_day');
u = fresh(); u.setProvider(claude(Date.now(), 40)); assert.equal(gatingWeekly(u.limits.providers[0], 'claude-fable-5').kind, 'seven_day');
// agent-deck's quick reading carries the Fable weekly over with the time it was really read.
const earlier = Date.now() - 30 * M;
u.setProvider(claude(earlier, 40, 9)); u.mergeDeck({ id: 'claude', windows: [{ kind: 'seven_day', label: '7d', used_percentage: 41, observedAt: 1 }] });
const ws = u.limits.providers[0].windows;
assert.equal(ws.find(w => w.kind === 'seven_day_fable').observedAt, earlier);
assert(ws.find(w => w.kind === 'seven_day').observedAt >= earlier + 30 * M); // a supplied window time is never trusted

// Antigravity: Argon reads its own pool; other Gemini models the Gemini Models pool; Claude/GPT through agy their own.
const agy = (at, pct) => ({ id: 'antigravity', label: 'Antigravity', observedAt: at, windows: [
  { kind: 'seven_day', label: 'Gemini Models · Weekly', pool: 'Gemini Models', used_percentage: 20, resets_at: 2e9 },
  { kind: 'seven_day', label: 'Gemini 4 Argon · Weekly', pool: 'Gemini 4 Argon', used_percentage: pct, resets_at: 2e9 },
  { kind: 'seven_day', label: 'Claude and GPT · Weekly', pool: 'Claude and GPT', used_percentage: 70, resets_at: 2e9 },
  { kind: 'five_hour', label: 'Gemini 4 Argon · Five Hour', pool: 'Gemini 4 Argon', used_percentage: 90, resets_at: 2e9 }] });
const stamped = p => ({ ...p, windows: p.windows.map(w => ({ ...w, observedAt: p.observedAt })) });
u = fresh(); turn(u, { agent: 'antigravity', model: 'gemini-4-argon', provider: agy, before: 30, after: 34 });
assert.equal(entry(u, 'Ada').sumDelta, 4); assert.match(entry(u, 'Ada').window, /Argon · Weekly/);
assert.equal(gatingWeekly(stamped(agy(1, 1)), 'gemini-3-flash').pool, 'Gemini Models');
assert.equal(gatingWeekly(stamped(agy(1, 1)), 'claude-sonnet-5-5').pool, 'Claude and GPT');
// Codex: the seven-day window.
assert.equal(gatingWeekly({ id: 'codex', windows: [{ kind: 'five_hour', used_percentage: 1, observedAt: 1 }, { kind: 'seven_day', used_percentage: 2, observedAt: 1 }] }, 'gpt-5').kind, 'seven_day');

// Wired through the conductor and the world: a stubbed turn opens and closes a sample; hero syncs feed the check.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amygdala-weekly-'));
let w;
try {
  w = new World(dir, [{ name: 'Ada', agent: 'claude', model: 'claude-opus' }], path.join(dir, 'roster.json'));
  const c = Object.assign(Object.create(Conductor.prototype), { world: w, running: new Map(), queue: [], pendingDuties: [], rr: 0, lastEnd: Date.now(), homes: path.join(dir, 'homes'), logs: path.join(dir, 'logs'),
    runner: () => Promise.resolve({ text: '' }) });
  fs.mkdirSync(c.logs); w.conductor = c;
  w.usage.setProvider(claude(Date.now() - M, 40));
  w.setWorkers([{ id: 'local:h1', title: 'synthetic', tool: 'codex', status: 'running', host: 'local', project: 'p', path: '' }]);
  c.run(w.cfg('Ada'), ['test']);
  assert.equal(w.usage.pending.length, 1); assert.equal(w.usage.pending[0].resident, 'Ada');
  await new Promise(r => setTimeout(r, 20));
  assert.equal(w.usage.pending[0].endedAt != null, true); assert.equal(w.usage.heroBusy.openai > 0, true);
  w.usage.setProvider(claude(Date.now() + 2 * M, 41)); // a reading after the turn (synthetic clock)
  assert.equal(w.usage.view('village').weeklyPerTurn.Ada.samples, 1);
  assert.equal(w.snapshot({ human: true }).usage.village.weeklyPerTurn.Ada.perTurnPct, 1);
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
console.log('turn weekly: clean samples, hero/turn/isolated overlap, resets, stale readings, isle, Fable and Argon windows passed');
process.exit(0);
