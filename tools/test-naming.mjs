import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { World } from '../lib/world.js';
import { Usage } from '../lib/usage.js';
import { Watch } from '../lib/watch.js';
import { createMcpHandler } from '../lib/mcp.js';
// No external provider processes in this unit test.
Usage.prototype.pollDeck = () => {};
Usage.prototype.probe = () => {};
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amygdala-naming-'));
let w;
try {
  const config = [{ name: 'Juniper', role: 'watch', title: 'The Watch', agent: 'claude', model: 'haiku' }, { name: 'Iris', role: 'archivist', agent: 'claude' }];
  const file = path.join(dir, 'residents.json');
  fs.writeFileSync(file, JSON.stringify(config));
  w = new World(dir, config, file);
  // First run: the human is offered a ceremony; others never see the offer, and declining hides it.
  assert.equal(w.snapshot({ human: true }).namingOffer, true);
  assert.equal(w.snapshot().namingOffer, undefined);
  w.s.namingSkipped = true; assert.equal(w.snapshot({ human: true }).namingOffer, undefined); delete w.s.namingSkipped;
  const old = 'Juniper';
  w.s.posts.push({ author: old, text: 'Historical Juniper', channel: 'projects' });
  w.s.exhibits.push({ author: old }); w.s.objects.push({ author: old });
  w.s.commitments.push({ ownerId: old, collaborators: [old, 'Iris'], contributors: [old] });
  w.s.findings.push({ reviewer: old, seconds: [{ by: old }], disputes: [{ by: old }], verdict: { by: old } });
  w.s.offerings.push({ reviewers: [old], commanded: { [old]: 'review' } });
  w.s.tales.push({ bard: old }); w.s.counsel.push({ by: old }); w.s.feed.push({ actor: old });
  w.s.usage.push({ resident: old });
  w.s.trees.village.branches.test = { contributors: [old], keepsake: { by: old } };
  w.s.trees.village.tended[old] = '2026-10-27';
  w.conductor = { queue: [{ name: old }], current: { name: old }, turn: { name: old } };
  w.beginTurn(old, 'capability');
  w.requestNaming(old);
  assert.throws(() => w.chooseName(old, { name: 'Iris', reason: 'taken' }), /taken/);
  assert.throws(() => w.chooseName(old, { name: 'A--B', reason: 'bad' }), /letters/);
  w.s.heroPasses.push({ name: 'Thales' });
  assert.throws(() => w.chooseName(old, { name: 'thales', reason: 'taken' }), /taken/);
  assert.equal(w.chooseName(old, { name: 'Daphne', title: 'Keeper of the Path', reason: 'A new beginning' }), 'Daphne');
  assert.equal(w.s.residents.Juniper, undefined);
  assert.equal(w.turnFor('capability'), 'Daphne');
  assert.equal(w.conductor.turn.name, 'Daphne'); assert.equal(w.conductor.queue[0].name, 'Daphne');
  for (const field of ['posts', 'exhibits', 'objects']) assert.equal(w.s[field][0].author, 'Daphne');
  assert.equal(w.s.posts[0].text, 'Historical Juniper');
  assert.equal(w.s.commitments[0].ownerId, 'Daphne'); assert.deepEqual(w.s.commitments[0].collaborators, ['Daphne', 'Iris']);
  assert.equal(w.s.findings[0].reviewer, 'Daphne');
  for (const field of ['seconds', 'disputes']) assert.equal(w.s.findings[0][field][0].by, 'Daphne');
  assert.equal(w.s.findings[0].verdict.by, 'Daphne');
  assert.deepEqual(w.s.offerings[0].reviewers, ['Daphne']); assert.deepEqual(w.s.offerings[0].commanded, { Daphne: 'review' });
  assert.equal(w.s.tales[0].bard, 'Daphne'); assert.equal(w.s.counsel[0].by, 'Daphne');
  assert.equal(w.s.feed.find(f => f.actor === 'Daphne').actor, 'Daphne'); assert.equal(w.s.usage[0].resident, 'Daphne');
  assert.deepEqual(w.s.trees.village.branches.test.contributors, ['Daphne']);
  assert.equal(w.s.trees.village.branches.test.keepsake.by, 'Daphne');
  assert.deepEqual(w.s.trees.village.tended, { Daphne: '2026-10-27' });
  assert.equal(w.cfg('Daphne').title, 'Keeper of the Path'); assert.equal(w.cfg(old), undefined);
  assert.deepEqual(JSON.parse(fs.readFileSync(file))[0].formerNames, [old]);
  // Remove deliberately minimal fixtures before taking a full snapshot.
  w.s.offerings = []; w.s.findings = []; w.s.tales = []; w.s.commitments = []; w.s.usage = [];
  delete w.s.trees.village.branches.test;
  assert(w.snapshot().mentionAliases.Daphne.includes('watch'));
  assert.equal(w.snapshot().residents[0].role, 'watch');
  assert.match(createMcpHandler(w).lookFor('Daphne'), /Daphne/);
  const wakes = [];
  const watch = w.watch = new Watch(w, { duty: (...args) => { wakes.push(args); return true; } }, dir, { start: false });
  const now = Date.now();
  w.workers = [{ id: 'hero', status: 'waiting', needsPermission: true, waitingSince: now - 11 * 60000, title: 'Fix login' }, { id: 'sealed', sealed: true, status: 'waiting', title: 'SECRET' }];
  w.s.findings = [{ id: 'secret', zone: 'isle', status: 'omen', omenAt: now - 31 * 60000, claim: 'SECRET' }];
  watch.scan(now); watch.scan(now + 60000);
  assert.equal(wakes.length, 1); assert.equal(watch.state.pending.length, 2);
  assert(!JSON.stringify(watch.state).includes('SECRET'));
  assert.equal(watch.state.pending[1].summary, 'isle: omen-pending');
  for (let i = 0; i < 6; i++) watch.ring('Daphne', { severity: 'info', summary: 'A report', event_keys: [watch.state.pending[0].key] });
  assert.throws(() => watch.ring('Daphne', { severity: 'urgent', summary: 'Seventh', event_keys: [] }), /six/);
  assert.equal(fs.readFileSync(path.join(dir, 'steward-bell.jsonl'), 'utf8').trim().split('\n').length, 6);
  w.endTurn('Daphne');
  w.s.findings = [];
  w.beginTurn('Iris', 'iris-token'); w.requestNaming('Iris');
  const mcp = createMcpHandler(w);
  const rpc = (method, params) => new Promise(resolve => mcp({ method: 'POST' }, { writeHead() {}, end(body) { resolve(JSON.parse(body)); } }, JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), 'iris-token'));
  const available = (await rpc('tools/list')).result.tools.map(t => t.name);
  assert(available.includes('choose_name')); assert(!available.includes('ring_bell'));
  const act = await rpc('tools/call', { name: 'act', arguments: { actions: [
    { tool: 'choose_name', args: { name: 'Kleio', reason: 'Keeper of memory' } },
    { tool: 'set_status', args: { mood: 'ready', doing: 'keeping the archive' } },
  ] } });
  assert(!act.result.isError, JSON.stringify(act)); assert.equal(w.s.residents.Kleio.mood, 'ready');
  assert.equal(w.turnFor('iris-token'), 'Kleio');
  const after = (await rpc('tools/list')).result.tools.map(t => t.name);
  assert(!after.includes('choose_name'));
  w.addPost('Kleio', 'resident', 'Today’s heroes completed their labours.', 'projects');
  assert.throws(() => w.addPost('Kleio', 'resident', 'Another digest.', 'projects'), /already/);
  w.endTurn('Kleio');
  // An island-wide ceremony announces once and completes after both identities migrate.
  w.proclaimNaming(['Daphne']);
  assert.equal(w.snapshot({ human: true }).namingOffer, undefined);
  w.requestNaming('Daphne'); w.requestNaming('Kleio');
  const opening = 'The bell rings across the island: the naming ceremony begins. One by one the townsfolk climb the theatre tiers to take their names.';
  assert.equal(w.s.feed.filter(f => f.text === opening).length, 1);
  assert.equal(w.s.feed.find(f => f.text === opening).placeId, 'green');
  w.chooseName('Daphne', { name: 'Laurel', reason: 'A fresh start' });
  assert.equal(w.s.ceremony.endedAt, undefined);
  assert.deepEqual(w.snapshot().ceremony.done, ['Laurel']);
  w.chooseName('Kleio', { name: 'Clio', reason: 'Memory endures' });
  assert(w.s.ceremony.endedAt >= w.s.ceremony.startedAt);
  assert.deepEqual(w.s.ceremony.names, ['Laurel', 'Clio']);
  assert.deepEqual(w.s.ceremony.done, ['Laurel', 'Clio']);
  assert.equal(w.snapshot().world.createdAt, w.s.createdAt);
  assert(w.snapshot().world.prologue.includes('Amygdala was founded.'));
  w.s.residents.Clio.zone = 'isle';
  assert.deepEqual(w.snapshot().ceremony.names, ['Laurel']);
  assert.deepEqual(w.snapshot().ceremony.done, ['Laurel']);
  w.s.residents.Clio.zone = 'village';
  assert.equal(w.s.feed.filter(f => f.text === 'The naming is complete. 2 townsfolk have taken their names; the village goes about its work.').length, 1);
  console.log('PASS: ceremony opening/completion, snapshot progress; naming migration, aliases, active turn, collisions, Watch privacy/deduplication, bell limit, MCP rename within act, daily digest');
} finally {
  if (w) { clearTimeout(w.saveTimer); clearInterval(w.seal.timer); }
  fs.rmSync(dir, { recursive: true, force: true });
}
