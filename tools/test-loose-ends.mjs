import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Nodes } from '../lib/nodes.js';
import { Tales } from '../lib/tales.js';
import { Conductor } from '../lib/conductor.js';
import { pagePresence } from '../lib/notify.js';
// Loose ends from a review (v0.58): closed node terminals, a local hero quarantined mid-tale, stuck duties, lost bells, page presence.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amygdala-loose-'));
const originalTimeout = globalThis.setTimeout;
try {
  // Output still in flight for a terminal the server already closed is dropped, not a failed poll that kills every terminal.
  let seq = 0; const w = { s: {}, workers: [], sites: { privateWorker: x => !!x.private }, id: () => `t${++seq}`, changed() {}, refreshWorkers() {}, usage: { mergeDeck() {} } };
  const nodes = new Nodes(w), a = nodes.auth(nodes.issue('Node A').token), b = nodes.auth(nodes.issue('Node B').token);
  for (const p of [a, b]) nodes.live.set(p.id, { at: Date.now(), deckAvailable: true });
  w.workers.push({ id: 'node:one', node: a.id, sessionId: 's1', zone: 'village' }, { id: 'node:two', node: a.id, sessionId: 's2', zone: 'village' });
  const one = nodes.openTerm('node:one'), two = nodes.openTerm('node:two'); one.on('close', () => {}); two.on('close', () => {});
  const ids = nodes.termPoll(a, { output: [] }).terms.map(t => t.id); assert.equal(ids.length, 2);
  one.kill();
  let out = ''; two.stdout.on('data', d => out += d);
  const after = nodes.termPoll(a, { output: [{ id: ids[0], d: 'YQ==' }, { id: ids[0], exit: true }, { id: ids[1], d: 'Yg==' }] });
  assert.deepEqual(after.terms.map(t => t.id), [ids[1]]); assert.equal(JSON.parse(out).d, 'Yg==');
  assert.throws(() => nodes.termPoll(a, { output: [{ id: 'never-issued', d: 'YQ==' }] }), /Unrequested/);
  assert.throws(() => nodes.termPoll(b, { output: [{ id: ids[0], d: 'YQ==' }] }), /Unrequested/, 'another node may not write to a closed terminal');
  assert.throws(() => nodes.termPoll(b, { output: [{ id: ids[1], d: 'YQ==' }] }), /Unrequested/, 'nor to a live one');
  assert.throws(() => nodes.termPoll(a, { output: [{ id: ids[0], d: '!!' }] }), /Invalid terminal output/, 'closed terminals keep the output check');

  // Bells: an ack-aware helper gets again what it was sent but never acknowledged; an old helper keeps at-most-once.
  const now = Date.now(); w.s.bells = [{ id: 1, ts: now - 120000, severity: 'attention', by: 'Watch', summary: 'test' }]; w.s.bellSeq = 1;
  const report = { hostname: 'test', os: 'macos', deckAvailable: false, sessions: [], results: [] }, again = p => { nodes.live.get(p.id).at -= 2000; };
  for (const p of [a, b]) { p.bellCursor = p.bellAck = 0; again(p); }
  assert.equal(nodes.report(a, { ...report, bellAck: 0 }).bells.length, 1); again(a);
  assert.equal(nodes.report(a, { ...report, bellAck: 0 }).bells.length, 1, 'the lost response is resent'); again(a);
  assert.equal(nodes.report(a, { ...report, bellAck: 1 }).bells.length, 0); assert.equal(a.bellAck, 1); again(a);
  assert.equal(nodes.report(b, report).bells.length, 1); again(b); assert.equal(nodes.report(b, report).bells.length, 0); assert.equal(b.bellAck, 1); again(b);
  assert.equal(nodes.report(b, { ...report, bellAck: 0 }).bells.length, 0, 'an old helper’s dispatched bells count as delivered'); again(b);
  nodes.setNotify(a.id, false); w.s.bells.push({ ...w.s.bells[0], id: 2 }); w.s.bellSeq = 2; assert.equal(nodes.report(a, { ...report, bellAck: 1 }).bells.length, 0); again(a);
  nodes.setNotify(a.id, true); assert.equal(nodes.report(a, { ...report, bellAck: 1 }).bells.length, 0, 'muted bells are not replayed');

  // A local hero quarantined while its git history is read gets no village tale.
  globalThis.setTimeout = () => ({ unref() {} });
  const tw = { s: { findings: [], tales: [], heroWatch: { hero: { firstSeen: Date.now() - 1000, ranMs: 1000, baseline: 'base' } }, residents: {} }, workers: [{ id: 'hero', title: 'Synthetic', project: 'test', host: 'local', tool: 'test', zone: 'village' }],
    rawWorkers: [{ id: 'hero', path: dir }], config: [], seal: { locked: false }, id: () => 'tl1', hasRole: () => false, zoneOf: () => 'village', addFeed() { throw new Error('no feed line'); }, changed() {}, nodes: { allowed: () => true } };
  const tales = new Tales(tw, dir); tales.writeChronicle = () => { throw new Error('no chronicle'); };
  tales.git = async (_, args) => { if (args[0] === 'rev-parse') tw.workers = [{ ...tw.workers[0], zone: 'isle' }]; return args[0] === 'rev-parse' ? 'head' : ''; };
  await assert.rejects(tales.complete('hero'), /changed/); assert.equal(tw.s.tales.length, 0); assert(!tw.s.heroWatch.hero.told);
  globalThis.setTimeout = originalTimeout;

  // Duties for one resident drop once that resident is disabled or moved away; a hibernating one keeps its duty.
  const residents = { Iris: { enabled: true, zone: 'village' }, Rhea: { enabled: true, zone: 'village' } }, sleeping = new Set();
  const cw = { s: { residents, tales: [], findings: [] }, config: [], governance: { stillWanted: () => true }, zoneOf: n => residents[n]?.zone, isHibernating: n => sleeping.has(n), dutyHolder: () => null, hasRole: () => false };
  const c = Object.assign(Object.create(Conductor.prototype), { world: cw, queue: [], pendingDuties: [] });
  const duty = (who, key) => ({ role: 'priest', zone: 'village', key, reason: 'synthetic', resident: who, offeringId: 'of1' });
  residents.Iris.enabled = false; residents.Rhea.zone = 'isle'; c.pendingDuties = [duty('Iris', 'gov:a'), duty('Rhea', 'gov:b')]; c.dispatchDuties();
  assert.deepEqual(c.pendingDuties, []); assert.deepEqual(c.queue, []);
  residents.Iris.enabled = true; sleeping.add('Iris'); c.pendingDuties = [duty('Iris', 'gov:c')]; c.dispatchDuties(); assert.equal(c.pendingDuties.length, 1);
  sleeping.clear(); c.dispatchDuties(); assert.deepEqual(c.pendingDuties, []); assert.equal(c.queue[0].name, 'Iris');
  // A role duty for a side where nobody holds the role is dropped; one whose holders are only asleep waits.
  c.queue = []; c.pendingDuties = [{ role: 'priest', zone: 'isle', key: 'omen:x', reason: 'synthetic' }]; c.dispatchDuties(); assert.deepEqual(c.pendingDuties, []);
  cw.config = [{ name: 'Iris' }]; cw.hasRole = (n, r) => n === 'Iris' && r === 'priest'; c.pendingDuties = [{ role: 'priest', zone: 'village', key: 'omen:y', reason: 'synthetic' }]; c.dispatchDuties(); assert.equal(c.pendingDuties.length, 1);

  // A page already counted stays counted when the presence table is full.
  const pages = new Map(); for (let i = 0; i < 256; i++) pagePresence(pages, { id: `page-${i}`, visible: true });
  pagePresence(pages, { id: 'page-0', visible: true }); assert(pages.has('page-0'));
  pagePresence(pages, { id: 'page-new', visible: true }); assert(!pages.has('page-new')); assert.equal(pages.size, 256);
  pagePresence(pages, { id: 'page-1', visible: false }); assert(!pages.has('page-1'));
  assert.throws(() => pagePresence(pages, { id: 'bad id', visible: true }), /presence/);
  console.log('loose ends: closed terminals, bell acknowledgement, mid-tale quarantine, stuck duties and page presence passed');
} finally {
  globalThis.setTimeout = originalTimeout;
  fs.rmSync(dir, { recursive: true, force: true });
}
