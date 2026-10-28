import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { World, migrateHall } from '../lib/world.js';
import { mergeDeckLists } from '../lib/deck.js';
import { Usage } from '../lib/usage.js';
import { reportSessions, executeJob } from './amygdala-node.mjs';
import { validateReport } from '../lib/nodes.js';
// `list --all` records are stripped: live sessions keep their full plain-list record; only extra ids count as archived.
assert.deepEqual(mergeDeckLists([{ id: 'a', status: 'waiting', tmux_session: 't' }], [{ id: 'a' }, { id: 'b', title: 'old' }]), [{ id: 'a', status: 'waiting', tmux_session: 't' }, { id: 'b', title: 'old', archived: true, status: 'stopped' }]);
assert.deepEqual(mergeDeckLists({ sessions: [{ id: 'a' }] }, null), [{ id: 'a' }]);
Usage.prototype.pollDeck = () => {}; Usage.prototype.probe = () => {};
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amygdala-hall-'));
let world;
try {
  fs.writeFileSync(path.join(dir, 'world.json'), JSON.stringify({ human: { placeId: 'glasshouse', zone: 'village' }, placeLogs: { glasshouse: [{ placeId: 'glasshouse' }] } }));
  world = new World(dir, [], path.join(dir, 'residents.json'));
  assert.equal(world.s.human.placeId, 'hall'); assert.equal(world.s.placeLogs.hall[0].placeId, 'hall'); assert.equal(world.place('hall').kind, 'hall');
  assert.deepEqual(migrateHall({ sealed: 'glasshouse', sites: { glasshouse: 'glasshouse' } }), { sealed: 'glasshouse', sites: { hall: 'hall' } });
  const base = { id: 'local:s', sessionId: 's', title: 'Synthetic', tool: 'codex', host: 'local', project: 'example', path: '/tmp/example', model: 'test', status: 'stopped', archived: true, lastActivityAt: 100 };
  world.setWorkers([base, { ...base, id: 'live', status: 'running', archived: false }]);
  assert.deepEqual(world.snapshot({ human: true }).workers.map(w => w.id), ['live']); assert.equal(world.snapshot({ human: true }).hall.length, 1); assert(!('hall' in world.snapshot()));
  world.sites.assign(base.id, 'library'); const calls = [], runner = async args => { calls.push(args); return { err: null }; };
  await world.sites.heroAction(base.id, 'revive', runner); assert.deepEqual(calls.map(c => c[1]), ['unarchive', 'start']); assert.equal(world.s.siteOf[base.id], 'library');
  for (const flag of ['private', 'quarantined', 'sealed', 'isleTagged']) {
    world.workers.find(w => w.id === base.id)[flag] = true;
    assert.equal(world.snapshot({ human: true }).hall.length, 0); assert(!world.snapshot().workers.some(w => w.id === base.id));
    for (const action of ['revive', 'forget']) await assert.rejects(world.sites.heroAction(base.id, action, runner));
    delete world.workers.find(w => w.id === base.id)[flag];
  }
  world.workers[0].zone = 'isle'; await assert.rejects(world.sites.heroAction(base.id, 'revive', runner)); world.workers[0].zone = 'village';
  await world.sites.heroAction(base.id, 'forget', runner); assert.equal(calls.at(-1)[1], 'remove');
  const session = { id: 's', status: 'stopped', tool: 'codex', path: '/tmp/example', archived: true, last_activity_at: '2026-01-01T00:00:00Z' };
  const sessions = reportSessions([session]); assert.equal(sessions[0].archived, true); assert(Number.isSafeInteger(sessions[0].lastActivityAt));
  const body = { hostname: 'synthetic', os: 'linux', deckAvailable: true, sessions, results: [] };
  validateReport(body); for (const field of ['archived', 'lastActivityAt']) { const bad = structuredClone(body); bad.sessions[0][field] = 'bad'; assert.throws(() => validateReport(bad)); }
  const oldBody = structuredClone(body); delete oldBody.sessions[0].archived; delete oldBody.sessions[0].lastActivityAt; validateReport(oldBody);
  const node = world.nodes.issue('Synthetic Node', 24), pass = world.nodes.auth(node.token), n = world.nodes;
  n.report(pass, oldBody); let w = world.workers.find(w => w.node); await assert.rejects(world.sites.heroAction(w.id, 'revive'), /update Amygdala on Synthetic Node/);
  n.live.get(pass.id).at -= 2000; n.report(pass, body);
  for (const action of ['revive', 'forget']) {
    w = world.workers.find(w => w.node); const pending = world.sites.heroAction(w.id, action);
    n.live.get(pass.id).at -= 2000; const jobs = n.report(pass, body).jobs; assert.equal(jobs[0].kind, action); assert.equal(jobs[0].sessionId, 's');
    const commands = []; await executeJob(jobs[0], jobs, [session], ['s'], async (bin, args) => { assert.equal(bin, 'agent-deck'); commands.push(args[1]); return { stdout: '' }; });
    assert.deepEqual(commands, action === 'revive' ? ['unarchive', 'start'] : ['remove']);
    for (const flag of ['private', 'quarantined', 'sealed', 'isleTagged']) await assert.rejects(executeJob(jobs[0], jobs, [{ ...session, [flag]: true }], ['s'], runner));
    n.live.get(pass.id).at -= 2000; n.report(pass, { ...body, sessions: action === 'forget' ? [] : sessions, results: [{ id: jobs[0].id, ok: true, output: '', error: '' }] }); await pending;
  }
  console.log('hall: filtering, privacy, local/node lifecycle, old reports and migration passed');
} finally { if (world) { clearTimeout(world.saveTimer); clearInterval(world.seal.timer); } fs.rmSync(dir, { recursive: true, force: true }); }
