// A hand wake holds (v0.93): offerings waiting when the human wakes the High Priest, examined ones included, wake her
// again as each becomes rulable, until it is decided; without the hold she still waits for five or for 12 hours.
// Stub conductor; no models or runtime state.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { World } from '../lib/world.js';
import { Usage } from '../lib/usage.js';
import { Conductor } from '../lib/conductor.js';
Usage.prototype.pollDeck = () => {}; Usage.prototype.probe = () => {};
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amygdala-wake-hold-'));
const config = [{ name: 'Themis', rank: 'priest', agent: 'claude', model: 'claude-opus-5-5' }, { name: 'Quill', rank: 'low', agent: 'codex', model: 'gpt-6.1-sol' }];
let w;
try {
  w = new World(dir, config, path.join(dir, 'roster.json')); w.s.paused = false;
  const c = Object.assign(Object.create(Conductor.prototype), { world: w, queue: [], pendingDuties: [], running: new Map(), tick() {} }); w.conductor = c;
  const g = w.governance; g.transport = async () => '{}';
  const make = async () => {
    const o = { id: w.id('of'), zone: 'village', provider: 'anthropic', tool: 'claude', kind: 'commit', project: 'test', host: 'local', workerId: 'missing', headCommit: 'a'.repeat(40), status: 'open', title: 'test', commanded: {}, reviewers: [], anchored: [], files: ['x.js'], omittedPaths: [], createdAt: Date.now() };
    w.s.offerings.push(o); await g.consider(o); return o;
  };
  const priestWake = o => c.pendingDuties.some(d => d.resident === 'Themis' && d.offeringIds?.includes(o.id));
  const finish = o => g.finishExamination('Quill', { offering_id: o.id, summary: 'No defects found in the release.' });

  // Without a hand wake, a finished examination waits (one offering is under the five that wake her by themselves).
  const quiet = await make(); assert.equal(quiet.gov.examination.state, 'pending');
  finish(quiet); assert.equal(quiet.gov.examination.state, 'done'); assert(!priestWake(quiet));
  c.pendingDuties.length = 0;

  // A hand wake while Quill examines: nothing for her yet, but the hold names the offering…
  const held = await make();
  assert.deepEqual(g.wakePriest({}, 'human'), { resident: 'Themis', offerings: 1, examining: 1 });
  assert(priestWake(quiet), 'the rulable one wakes her at once');
  assert(!priestWake(held), 'the one under examination waits for its examiner');
  assert.deepEqual(w.s.governance.wakeHold.ids.sort(), [quiet.id, held.id].sort());
  // …so when Quill finishes, she is woken again for it, though she was woken minutes ago.
  c.pendingDuties.length = 0; held.gov.wokeAt = Date.now() - 1000; held.gov.examination.doneAt = 0;
  finish(held); assert(priestWake(held), 'a finished examination of a held offering wakes her');
  // A pump with nothing new is a retry, and retries keep their six-hour spacing.
  c.pendingDuties.length = 0; g.pump(); assert(!priestWake(held));

  // Decided offerings leave the hold; once all have, it is gone and the old rule is back.
  quiet.gov.state = 'accepted'; g.pump(); assert.deepEqual(w.s.governance.wakeHold.ids, [held.id]);
  held.gov.state = 'rejected'; g.pump(); assert.equal(w.s.governance.wakeHold, undefined);
  const later = await make(); finish(later); assert(!priestWake(later));

  // The usage gates still hold: a hibernating priest is not woken, and the wake refuses.
  w.isHibernating = n => n === 'Themis';
  assert.throws(() => g.wakePriest({}, 'human'), /cannot be woken now/);
  console.log('wake hold ok');
} finally { w?.destroy?.(); fs.rmSync(dir, { recursive: true, force: true }); }
