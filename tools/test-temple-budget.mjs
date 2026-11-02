import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { World } from '../lib/world.js';
import { Usage } from '../lib/usage.js';
import { Conductor } from '../lib/conductor.js';
Usage.prototype.pollDeck = () => {}; Usage.prototype.probe = () => {};
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amygdala-temple-budget-'));
let w;
try {
  w = new World(dir, [{ name: 'Alpha', agent: 'codex', rank: 'low' }, { name: 'Beta', agent: 'codex' }], path.join(dir, 'residents.json'));
  const c = Object.assign(Object.create(Conductor.prototype), { world: w, queue: [], pendingDuties: [], rr: 0, lastEnd: Date.now(), turn: { busy: true } });
  w.conductor = c;
  let ran;
  // Stub the turn runner: scheduling is real, no CLI or resident is launched.
  c.run = () => { ran = c.current; c.turn = { busy: true }; };
  w.s.paused = false; w.s.activeHours = { start: 0, end: 24 }; w.governance.pump = () => {};
  const tick = () => { ran = null; c.turn = null; c.tick(); };
  const reset = () => { c.queue = []; c.turn = { busy: true }; ran = null; };
  assert.equal(w.s.templeTurnBudget, 24);
  w.workers = [{ id: 'node:test:hero', node: 'test', zone: 'village', tool: 'codex', project: 'test', title: 'Test work', host: 'test' }];
  w.temple.nodeSnapshot = async () => ({ head: '', kind: 'working changes', diff: '+test', d: { kept: '+test', hash: 'a'.repeat(64), allFiles: ['x.js'], files: ['x.js'], truncated: false } });
  w.governance.consider = async () => {};
  await w.temple.offer('node:test:hero', 'Test offering'); tick();
  assert(ran.temple); assert.equal(w.templeTurnsToday(), 1); assert.equal(w.autoTurnsToday(), 0);
  for (const job of [{ temple: true }, {}, ...['priest', 'smith', 'watch', 'examiner'].map(role => ({ duty: { role, key: 'test' } }))]) {
    reset();
    const turn = w.beginTurn('Alpha', 'test', { job });
    w.turnContext.run(turn, () => c.onPost({ author: 'Alpha', authorKind: 'resident', text: '@Beta hello', zone: 'village', id: 'p1' }));
    w.endTurn('Alpha', turn.id);
    assert.equal(c.queue[0].temple, !!job.temple || !!job.duty);
  }
  for (const first of [true, false]) {
    reset(); const used = w.autoTurnsToday(); c.wake('Alpha', 'first', { human: false, temple: first }); c.wake('Alpha', 'second', { human: false, temple: !first }); tick();
    assert.equal(ran.temple, false); assert.equal(w.autoTurnsToday(), used + 1);
  }
  reset(); w.setBudget(0); c.wake('Alpha', 'review', { human: false, temple: true }); tick(); assert(ran.temple, 'Temple continues after routine budget is spent');
  reset(); c.wake('Alpha', 'routine', { human: false }); tick(); assert.equal(ran, null); assert.equal(c.queue.length, 1);
  for (const gate of ['pause', 'hours', 'budget', 'pressure', 'disabled', 'hibernate']) {
    reset(); w.s.paused = gate === 'pause'; w.s.residents.Alpha.enabled = gate !== 'disabled';
    const window = w.turnWindowLeft, hibernate = w.isHibernating, pressure = c.pressureBlocked;
    if (gate === 'hours') w.turnWindowLeft = () => null;
    if (gate === 'hibernate') w.isHibernating = () => true;
    if (gate === 'pressure') c.pressureBlocked = () => true;
    w.setTempleBudget(gate === 'budget' ? 0 : 24);
    c.wake('Alpha', 'review', { human: false, temple: true }); tick();
    assert.equal(ran, null, gate); assert.equal(c.queue.length, 1, gate);
    w.turnWindowLeft = window; w.isHibernating = hibernate; c.pressureBlocked = pressure;
  }
  reset(); w.s.paused = false; w.s.residents.Alpha.enabled = true; w.setTempleBudget(24);
  w.s.templeTurns = { date: new Date().toDateString(), count: 24 };
  c.wake('Alpha', 'review after reset', { human: false, temple: true }); tick(); assert.equal(ran, null); assert.equal(c.queue.length, 1);
  w.s.templeTurns.date = 'old'; assert.equal(w.templeTurnsToday(), 0); tick(); assert(ran); assert.equal(c.queue.length, 0); assert.equal(w.templeTurnsToday(), 1);
  for (const [input, expected] of [[-1, 0], [1001, 1000], [3.7, 4], ['12', 12]]) { w.setTempleBudget(input); assert.equal(w.s.templeTurnBudget, expected); }
  const budget = w.snapshot({ human: true }).budget; assert.equal(budget.templeTurnBudget, 12); assert.equal(budget.templeUsedToday, 1);
  assert.match(fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8'), /if \(b.templeTurnBudget !== undefined\) world.setTempleBudget\(b.templeTurnBudget\)/);
  reset(); const before = [w.autoTurnsToday(), w.templeTurnsToday()];
  c.wake('Alpha', 'human review', { temple: true }); tick(); assert(ran.human); assert.deepEqual([w.autoTurnsToday(), w.templeTurnsToday()], before);
  reset(); c.dispatchDuties = () => c.queue.push({ name: 'Alpha', human: false, duty: { role: 'smith' } }); tick();
  assert(ran.duty); assert.deepEqual([w.autoTurnsToday(), w.templeTurnsToday()], before); c.dispatchDuties = Conductor.prototype.dispatchDuties;
  // The examiner's duty is Temple review work: it spends the Temple allowance, not the routine one.
  reset(); const get = w.governance.get, wanted = w.governance.examinationWanted; w.governance.get = () => ({ gov: { examination: {} } }); w.governance.examinationWanted = () => true; c.dispatchDuties = () => c.queue.push({ name: 'Alpha', human: false, duty: { role: 'examiner', examinationId: 'of1' } }); tick();
  assert(ran.duty); assert.deepEqual([w.autoTurnsToday(), w.templeTurnsToday()], [before[0], before[1] + 1]); c.dispatchDuties = Conductor.prototype.dispatchDuties; w.governance.get = get; w.governance.examinationWanted = wanted;
  reset(); w.setBudget(1000); c.lastEnd = Date.now(); c.hasNews = () => true; tick(); assert.equal(ran, null, 'routine turns still wait for their pacing gap');
  reset(); c.tick = () => {}; c.run = Conductor.prototype.run; c.homes = path.join(dir, 'homes'); c.running = new Map();
  c.runner = async () => ({ text: '' }); c.current = { temple: true, human: false };
  c.run(w.cfg('Alpha'), ['Temple reply']);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(w.s.usage.at(-1).kind, 'temple');
  assert.equal(w.usage.view('village').byKind.temple.turns, 1);
  w.save(); const saved = JSON.parse(fs.readFileSync(w.file, 'utf8')); assert.equal(saved.templeTurnBudget, 12); assert.equal(saved.templeTurns.count, 2); // the review turn and the examination
  console.log('PASS: Temple allowance, propagation, merged reasons, pacing, gates, reset, clamp and snapshot');
} finally { if (w) { w.conductor.tick = () => {}; clearTimeout(w.saveTimer); clearInterval(w.seal.timer); } fs.rmSync(dir, { recursive: true, force: true }); }
