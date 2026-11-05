// Hero alerts (v0.91): off by default; a watched village hero rings the bell when it goes idle after work, needs
// permission, errors or stops; never isle, private or petition heroes. Synthetic heroes only; no CLIs, no model calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { World } from '../lib/world.js';
import { Usage } from '../lib/usage.js';
import { Watch } from '../lib/watch.js';
Usage.prototype.pollDeck = () => {}; Usage.prototype.probe = () => {};
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amygdala-alerts-'));
let w;
try {
  w = new World(dir, [], path.join(dir, 'residents.json'));
  w.watch = new Watch(w, null, dir, { start: false });
  const hero = { id: 'local:a', sessionId: 'a', title: 'Builder', project: 'p', host: 'local', zone: 'village', tool: 'claude', status: 'running' };
  const other = { ...hero, id: 'local:b', sessionId: 'b', title: 'Other' };
  const alerts = () => w.s.bells.filter(b => b.kind === 'hero-alert');
  const step = (a, b = { ...other, status: 'running' }) => { w.watch.alertAt?.clear(); w.setWorkers([a, b]); };

  // Off by default: the hero finishes and nothing rings.
  step({ ...hero }); step({ ...hero, status: 'idle' });
  assert.equal(alerts().length, 0); assert.deepEqual(w.snapshot({ human: true }).heroAlerts, []);

  // On: idle after work, permission, error and stopped each ring once, naming the hero.
  assert.deepEqual(w.watch.setHeroAlert('local:a', true).heroAlerts, ['local:a']);
  assert.deepEqual(w.snapshot({ human: true }).heroAlerts, ['local:a']); assert.equal(w.snapshot({ human: false }).heroAlerts, undefined);
  step({ ...hero }); step({ ...hero, status: 'idle' });
  assert.equal(alerts().length, 1); assert.equal(alerts().at(-1).text, '🔔 Builder is idle and waiting for you'); assert.equal(alerts().at(-1).severity, 'info');
  step({ ...hero, status: 'idle' }); assert.equal(alerts().length, 1, 'no repeat while it stays idle');
  step({ ...hero, status: 'waiting' }); assert.equal(alerts().length, 1, 'idle to plain waiting is not new');
  step({ ...hero, status: 'waiting', needsPermission: true }); assert.match(alerts().at(-1).text, /Builder needs your permission/); assert.equal(alerts().at(-1).severity, 'attention');
  step({ ...hero }); step({ ...hero, status: 'error' }); assert.match(alerts().at(-1).text, /Builder hit an error/);
  step({ ...hero, status: 'stopped' }); assert.match(alerts().at(-1).text, /Builder has stopped/);
  assert.equal(alerts().length, 4);
  // The other hero was never switched on.
  step({ ...hero }, { ...other, status: 'idle' }); assert.equal(alerts().length, 4);

  // A flapping poll rings at most once a minute.
  w.setWorkers([{ ...hero }, other]); w.setWorkers([{ ...hero, status: 'idle' }, other]); w.setWorkers([{ ...hero }, other]); w.setWorkers([{ ...hero, status: 'idle' }, other]);
  assert.equal(alerts().length, 5);

  // Stale (node offline) and newly seen heroes stay quiet.
  step({ ...hero }); step({ ...hero, status: 'idle', stale: true }); assert.equal(alerts().length, 5);

  // Isle, private and sealed heroes can't be switched on, and a watched hero that moves to the isle goes quiet and
  // drops out of the snapshot.
  for (const v of [{ zone: 'isle' }, { private: true }, { sealed: true }, { isleTagged: true }, { quarantined: true }]) {
    w.setWorkers([{ ...hero }, { ...other, ...v }]);
    assert.throws(() => w.watch.setHeroAlert('local:b', true), /village hero/);
  }
  assert.throws(() => w.watch.setHeroAlert('local:none', true), /village hero/);
  step({ ...hero }); step({ ...hero, zone: 'isle', status: 'idle' });
  assert.equal(alerts().length, 5); assert.deepEqual(w.snapshot({ human: true }).heroAlerts, []);

  // Off again: quiet, and it persists in the world state.
  step({ ...hero }); assert.deepEqual(w.watch.setHeroAlert('local:a', false).heroAlerts, []);
  step({ ...hero, status: 'idle' }); assert.equal(alerts().length, 5); assert.deepEqual(w.s.heroAlerts, {});
  // The Steward's bell wait passes over hero alerts and still returns the next other bell.
  const { Steward } = await import('../lib/steward.js');
  const st = Object.assign(Object.create(Steward.prototype), { w });
  w.s.stewardBellCursor = 0; assert.equal(await st.wait(0), null);
  w.s.bells.push({ id: ++w.s.bellSeq, ts: Date.now(), kind: 'hero-milestone', severity: 'info', text: 'milestone', isle: false });
  assert.equal((await st.wait(0)).text, 'milestone');
  console.log('hero alerts ok');
} finally { w?.destroy?.(); fs.rmSync(dir, { recursive: true, force: true }); }
