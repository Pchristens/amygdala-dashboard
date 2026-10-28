import assert from 'node:assert/strict';
import { Nodes, validateReport, RESULT_MAX } from '../lib/nodes.js';
import { Sites } from '../lib/sites.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Usage } from '../lib/usage.js';
import { World } from '../lib/world.js';
import { reportSessions, executeJob } from './amygdala-node.mjs';
let seq = 0;
const world = { s: {}, workers: [], id: () => `test-${++seq}`, changed() {}, refreshWorkers() { this.workers = this.nodes.workers().map(w => ({ ...w, zone: w.isleTagged || w.quarantined ? 'isle' : 'village' })); }, usage: { mergeDeck() {} } };
world.sites = new Sites(world); world.nodes = new Nodes(world);
const n = world.nodes, issued = n.issue('Test Mac', 24), p = n.auth(issued.token);
assert(p); assert(!JSON.stringify(n.passes()).includes('tokenHash')); assert(!n.auth('bad'));
const sessions = reportSessions([{ id: 's1', title: 'Build', path: '/tmp/project', status: 'running', tool: 'codex', transcript_path: '/never/read/this' }]);
assert(!JSON.stringify(sessions).includes('transcriptPath')); assert(!JSON.stringify(sessions).includes('/never/read'));
const body = { hostname: 'test', os: 'macos', deckAvailable: true, sessions, results: [] };
assert.throws(() => validateReport({ ...body, os: 'bad' })); assert.throws(() => validateReport({ ...body, sessions: [{ ...sessions[0], transcriptPath: 'bad' }] }));
n.report(p, body); const w = world.workers[0]; assert.equal(w.id, `node:${p.id}:s1`); assert.equal(w.os, 'macos');
n.live.get(p.id).at -= 14000; assert(n.workers()[0].stale); n.live.get(p.id).at -= 1000;
n.report(p, body);
const commission = world.sites.commission({ node: p.id, site: 'forge', path: '/node/project', tool: 'codex', prompt: 'Build example' });
n.live.get(p.id).at -= 2000; const jobs = n.report(p, body).jobs; assert.equal(jobs[0].kind, 'commission');
n.live.get(p.id).at -= 2000; n.report(p, { ...body, results: [{ id: jobs[0].id, ok: true, output: '{"id":"new-session"}', error: '' }] });
await commission; assert.equal(world.s.siteOf[`node:${p.id}:new-session`], 'forge');
for (const flag of ['isleTagged', 'quarantined', 'sealed']) { world.workers[0][flag] = true; await assert.rejects(n.tail(world.workers[0])); delete world.workers[0][flag]; }
world.workers[0].zone = 'isle'; await assert.rejects(n.tail(world.workers[0])); world.workers[0].zone = 'village';
let reads = 0; const job = { id: 'j', kind: 'tail', sessionId: 's1', maxChars: 100 };
await assert.rejects(executeJob(job, [], [{ id: 's1' }], ['s1'], null, () => { reads++; })); assert.equal(reads, 0);
await assert.rejects(executeJob(job, [job], [{ id: 's1', group: 'isle' }], ['s1'], null, () => { reads++; })); assert.equal(reads, 0);
assert.equal(await executeJob(job, [job], [{ id: 's1', transcript_path: '/local-only' }], ['s1'], null, (file, bound) => { assert.equal(file, '/local-only'); assert.equal(bound, 100); return 'village output'; }), 'village output');
assert.throws(() => n.report(p, body), /rate exceeded/);
assert.throws(() => validateReport({ ...body, results: [{ id: 'bad', ok: true, output: 'x'.repeat(RESULT_MAX + 1), error: '' }] }));
Usage.prototype.pollDeck = () => {}; Usage.prototype.probe = () => {};
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amygdala-nodes-'));
let real;
try {
  real = new World(dir, [], path.join(dir, 'residents.json'));
  real.nodes.issue('Test Machine', 24);
  assert.equal(real.snapshot({ human: true }).nodes.length, 1);
  assert(!('nodes' in real.snapshot()));
  assert(!JSON.stringify(real.snapshot({ human: true }).nodes).includes('tokenHash'));
} finally { if (real) { clearTimeout(real.saveTimer); clearInterval(real.seal.timer); } fs.rmSync(dir, { recursive: true, force: true }); }
const pending = n.tail(world.workers[0], 100);
n.live.get(p.id).at -= 2000; const tailJobs = n.report(p, body).jobs;
assert.equal(tailJobs[0].kind, 'tail');
world.workers[0].quarantined = true;
// Keep the synthetic hero quarantined across the fixture's merge.
world.sites.privateWorker = w => !!w.quarantined;
const refresh = world.refreshWorkers; world.refreshWorkers = () => {};
n.live.get(p.id).at -= 2000; n.report(p, { ...body, results: [{ id: tailJobs[0].id, ok: true, output: 'discarded', error: '' }] });
await assert.rejects(pending); world.refreshWorkers = refresh;

n.revoke(p.id); assert(!n.auth(issued.token)); assert.equal(n.workers().length, 0);
console.log('nodes: passes, validation, merge, stale, routing and privacy passed');
