import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Tales } from '../lib/tales.js';
import { World } from '../lib/world.js';
import { Usage } from '../lib/usage.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amygdala-tales-'));
let world;
const originalTimeout = globalThis.setTimeout;
try {
  let timers = 0, wakes = 0, accounts = 0, fallback;
  globalThis.setTimeout = fn => { fallback = fn; timers++; return { unref() {} }; };
  const w = { s: { findings: [], residents: { Bard: { enabled: true } } }, workers: [{ id: 'hero', title: 'Synthetic', project: 'test', host: 'remote', tool: 'test', zone: 'village' }], config: [{ name: 'Bard' }], seal: { locked: true }, id: () => 'tl' + wakes, hasRole: () => true, zoneOf: () => 'village', actsAs: () => true, addFeed() {}, changed() {}, nodes: { allowed: () => true, request: async () => '{}', tail: async () => '' } };
  const tales = new Tales(w, dir); tales.writeChronicle = () => {}; tales.listeners = [() => wakes++]; tales.ownAccount = () => accounts++;
  function reset(ms = 120000) { w.s.tales = []; w.s.heroWatch.hero = { firstSeen: Date.now() - ms, ranMs: ms, told: false }; w.s.findings = []; timers = wakes = accounts = 0; }
  reset(); let t = await tales.complete('hero'); assert.equal(t.owed, false); assert.deepEqual(t.epic, []); assert.equal(w.s.tales.length, 1); assert.equal(wakes, 0); assert.equal(timers, 0); assert.deepEqual(tales.pendingFor('Bard'), []);
  await tales.request('hero'); assert.equal(t.owed, true); assert.deepEqual(t.epic, ['asked by the human']); assert.equal(w.s.tales.length, 1); assert.equal(wakes, 1); await assert.rejects(tales.request('hero'), /already/);
  reset(7200000); t = await tales.complete('hero'); assert(t.owed); assert.match(t.epic[0], /h of work/); assert.equal(wakes, 1); assert.equal(timers, 1); fallback(); assert.equal(accounts, 1);
  reset(); w.s.findings = [{ status: 'fixed', project: 'test', fixedAt: Date.now(), severity: 'high', claim: 'synthetic' }]; t = await tales.complete('hero'); assert(t.owed); assert.match(t.epic[0], /findings/);
  reset(); w.workers[0].node = 'synthetic'; await tales.endLabour('hero'); assert.equal(w.s.tales[0].owed, false); assert.equal(timers, 0); assert.equal(accounts, 0); assert.equal(wakes, 0); delete w.workers[0].node;
  reset(); t = await tales.complete('hero'); Tales.prototype.ownAccount.call(tales, t); assert.equal(t.tale, null);
  t.owed = true; Tales.prototype.ownAccount.call(tales, t); assert(t.tale?.own); await assert.rejects(tales.request('hero'), /already/);
  reset(); w.config = []; await tales.request('hero'); assert.equal(accounts, 1); assert.equal(w.s.tales.length, 1); w.config = [{ name: 'Bard' }];
  reset(); await Promise.all([tales.complete('hero'), tales.complete('hero')]); assert.equal(w.s.tales.length, 1);
  // Synthetic local git responses exercise commit collection without external processes.
  reset(); w.workers[0].host = 'local'; w.rawWorkers = [{ id: 'hero', path: dir }]; w.s.heroWatch.hero.baseline = 'baseline';
  tales.git = async (_, args) => args[0] === 'rev-parse' ? 'head' : args[0] === 'log' ? Array.from({ length: 10 }, (_, i) => `abc${i} synthetic`).join('\n') : '';
  w.config = []; t = await tales.complete('hero'); assert.equal(t.commits.length, 10); assert(t.owed); assert.deepEqual(t.epic, ['10 commits']);
  globalThis.setTimeout = originalTimeout;
  for (const bad of [{ minHours: -1 }, { minHours: 49 }, { minHours: NaN }, { minFixed: 1001 }, { minCommits: '10' }, { minFixed: 0.5 }, { minHours: null }]) assert.throws(() => tales.settings(bad), /Invalid/);
  assert.deepEqual(tales.settings({ minHours: 0, minFixed: 1000, minCommits: 0 }), { minHours: 0, minFixed: 1000, minCommits: 0 });
  Usage.prototype.pollDeck = () => {}; Usage.prototype.probe = () => {};
  world = new World(dir, [], path.join(dir, 'residents.json'));
  assert.deepEqual(world.snapshot({ human: true }).taleSettings, { minHours: 2, minFixed: 1, minCommits: 10 }); assert(!('taleSettings' in world.snapshot()));
  world.tales.settings({ minHours: 48 }); assert.equal(world.s.taleSettings.minHours, 48);
  const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8'); assert(server.includes("'POST /api/tales/settings': b => world.tales.settings(b)"));
  console.log('tales: facts, epic rules, requests, end labour, fallback gates, settings and visibility passed');
} finally {
  globalThis.setTimeout = originalTimeout;
  if (world) { clearTimeout(world.saveTimer); clearInterval(world.seal.timer); }
  fs.rmSync(dir, { recursive: true, force: true });
}
