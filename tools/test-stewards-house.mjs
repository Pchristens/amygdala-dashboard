// v0.49: the Steward's House. The deploy stone (gold, ember, unlit), the read-only stewardHouse view in the human snapshot
// only, isle and quarantined projects never appearing in it, commissions kept as sent/started/confirmed, and the Steward
// hero standing at the house. A throwaway World; the commission launcher is stubbed, so no agent-deck or model runs.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { World } from '../lib/world.js';
import { Usage } from '../lib/usage.js';
import { houseView, HOUSE_ID } from '../lib/stewards-house.js';
Usage.prototype.pollDeck = () => {}; Usage.prototype.probe = () => {};
const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amygdala-house-'));
const roster = JSON.parse(fs.readFileSync(path.join(root, 'residents.json'), 'utf8')).filter(r => r.zone !== 'isle');
const sha = n => crypto.createHash('sha1').update(`house-${n}`).digest('hex');
let w;
try {
  w = new World(dir, roster, path.join(dir, 'residents.json'));
  const now = Date.now(), gv = w.governance;
  const hero = (i, project, extra = {}) => ({ id: `local:h${i}`, sessionId: `h${i}`, title: `Task ${i}`, tool: 'claude', host: 'local', project, path: `/tmp/${project}`, model: 'synthetic', status: 'running', updatedAt: now, lastActivityAt: now, ...extra });
  // Two village heroes, one isle-tagged hero and one whose project was sent to the isle by quarantine.
  w.s.quarantine = ['secretq@local'];
  const heroes = [hero(0, 'tideworks'), hero(1, 'reefchart'), hero(2, 'hiddenisle', { zone: 'isle', isleTagged: true }), hero(3, 'secretq')];
  w.setWorkers(heroes);
  assert(w.places?.some?.(p => p.id === HOUSE_ID) || w.snapshot({ human: true }).places.some(p => p.id === HOUSE_ID), 'the house is a landmark');

  // ---------- unlit: nothing deployed is known ----------
  w.version = sha(0);
  let v = houseView(w);
  assert.equal(v.stone, 'unknown'); assert.deepEqual(v.projects, []); assert.deepEqual(v.why, []);

  // ---------- gold: what runs is what the Temple approved, every receipt cites its approval ----------
  const offering = (n, h, state) => ({ id: `of${n}`, zone: 'village', workerId: h.id, host: h.host, project: h.project, title: h.title, kind: 'diff', status: 'closed', headCommit: sha(n), createdAt: now,
    gov: { key: `${h.project}@${h.host}`, sha: sha(n), base: null, state, class: state === 'trivial' ? 'trivial' : 'review', reasons: [], rulings: [], appeals: [], at: now } });
  const o1 = offering(1, heroes[0], 'accepted'), o2 = offering(2, heroes[1], 'trivial');
  w.s.offerings.push(o1, o2);
  gv.append({ kind: 'ruling', actor: 'Themis', offeringId: o1.id, key: o1.gov.key, sha: o1.gov.sha, verdict: 'accept', concern: 'none', reason: 'Reviewed.' });
  gv.append({ kind: 'skip', actor: 'mechanical check', offeringId: o2.id, key: o2.gov.key, sha: o2.gov.sha, base: null, reason: 'trivial: prose' });
  gv.approve(o1); gv.approve(o2);
  const r1 = gv.receipt({ sha: o1.gov.sha, offeringId: o1.id }, 'Steward').receipt; gv.receipt({ sha: o2.gov.sha, offeringId: o2.id }, 'Steward');
  w.version = sha(1);
  v = houseView(w);
  assert.equal(v.stone, 'ok', v.why.join('; ')); assert.equal(v.version, sha(1));
  assert.deepEqual(v.projects.map(p => [p.key, p.state]), [['reefchart@local', 'matches'], ['tideworks@local', 'matches']]);
  assert(v.projects.find(p => p.key === 'tideworks@local').running);
  assert.deepEqual(v.projects.find(p => p.key === 'tideworks@local').approved.cites, { kind: 'ruling', seq: 1, by: 'Themis' });
  assert.equal(v.receipts.length, 2); assert(v.receipts.every(r => r.cites && r.standing));
  assert.equal(v.receipts.find(r => r.id === r1.id).cites.kind, 'ruling'); assert.equal(v.receipts.find(r => r.offeringId === o2.id).cites.kind, 'trivial check');
  assert(v.notes.some(n => n.kind === 'skip'));

  // ---------- ember: the server runs a commit no receipt names ----------
  w.version = sha(9);
  v = houseView(w); assert.equal(v.stone, 'drift'); assert.match(v.why.join(), /no deploy receipt/);
  // ...or a newer approval was never deployed, so deployed differs from approved
  w.version = sha(1);
  const o3 = offering(3, heroes[0], 'accepted'); w.s.offerings.push(o3);
  gv.append({ kind: 'ruling', actor: 'Themis', offeringId: o3.id, key: o3.gov.key, sha: o3.gov.sha, verdict: 'accept', concern: 'none', reason: 'Reviewed again.' }); gv.approve(o3);
  v = houseView(w); assert.equal(v.stone, 'drift'); assert.equal(v.projects.find(p => p.key === 'tideworks@local').state, 'differs');
  gv.receipt({ sha: o3.gov.sha, offeringId: o3.id }, 'Steward'); w.version = sha(3);
  assert.equal(houseView(w).stone, 'ok');
  // ...or a receipt whose approval no longer stands (the acceptance was withdrawn after the deploy)
  o3.gov.state = 'refused';
  v = houseView(w); assert.equal(v.stone, 'drift'); assert(v.receipts.some(r => r.offeringId === o3.id && !r.standing));
  o3.gov.state = 'accepted';
  // ...or a receipt with no ruling or trivial check before it, written into the ledger by hand
  const o4 = offering(4, heroes[1], 'accepted'); w.s.offerings.push(o4);
  gv.append({ kind: 'receipt', id: 'rc-bare', actor: 'Steward', offeringId: o4.id, key: o4.gov.key, sha: o4.gov.sha, how: 'accepted', note: null });
  v = houseView(w); assert.equal(v.stone, 'drift'); assert(v.receipts.some(r => r.id === 'rc-bare' && !r.cites)); assert.match(v.why.join(), /rc-bare cites no ruling/);
  gv.append({ kind: 'revert', id: 'rv-bare', actor: 'Steward', receiptId: 'rc-bare', offeringId: o4.id, key: o4.gov.key, sha: o4.gov.sha, reason: 'Withdrawn for the test.' });
  assert.equal(houseView(w).stone, 'ok', 'a reverted receipt no longer lights the ember');

  // ---------- the isle never appears: isle-tagged, quarantined and isle-zoned offerings ----------
  const isleKeys = ['hiddenisle@local', 'secretq@local', 'zoned@local'];
  w.s.offerings.push({ id: 'ofz', zone: 'isle', workerId: 'local:hz', host: 'local', project: 'zoned', title: 'isle work', kind: 'diff', status: 'closed', createdAt: now, gov: { key: 'zoned@local', sha: sha(7), state: 'accepted', rulings: [], appeals: [] } });
  for (const [i, key] of isleKeys.entries()) {
    w.s.governance.approved[key] = { sha: sha(20 + i), offeringId: `ofi${i}`, at: now };
    w.s.governance.deployed[key] = { sha: sha(30 + i), receiptId: `rci${i}`, at: now };
    gv.append({ kind: 'override', what: 'misclassified', actor: 'Themis', offeringId: `ofi${i}`, key, sha: sha(20 + i), reason: `ISLE-SECRET-${i}` });
    gv.append({ kind: 'receipt', id: `rci${i}`, actor: 'Steward', offeringId: `ofi${i}`, key, sha: sha(30 + i), how: 'accepted', note: `ISLE-SECRET-NOTE-${i}` });
  }
  v = houseView(w);
  const text = JSON.stringify(v);
  for (const key of isleKeys) assert(!text.includes(key), `${key} stays off the house`);
  assert(!/ISLE-SECRET|hiddenisle|secretq|zoned/.test(text));
  for (let i = 0; i < 3; i++) for (const s of [sha(20 + i), sha(30 + i)]) assert(!text.includes(s), 'no isle commit');
  assert.equal(v.stone, 'ok', 'isle drift does not light the village stone');
  const human = w.snapshot({ human: true });
  assert(!/ISLE-SECRET|hiddenisle@|secretq@|zoned@/.test(JSON.stringify(human.stewardHouse)));

  // ---------- human only: visitors and other snapshots see neither the house's accounts nor the running commit ----------
  assert(human.stewardHouse && human.world.version === sha(3));
  const visitor = w.snapshot({ human: false });
  assert.equal(visitor.stewardHouse, undefined); assert.equal(visitor.world.version, undefined);
  assert(visitor.places.some(p => p.id === HOUSE_ID && p.name === "The Steward's House"), 'visitors still see the house itself');
  const plain = w.snapshot(); assert.equal(plain.stewardHouse, undefined); assert.equal(plain.world.version, undefined, 'no running commit in the default snapshot');

  // ---------- read-only: building the view changes nothing, and the house has no route or tool of its own ----------
  const before = JSON.stringify(w.s);
  houseView(w); w.snapshot({ human: true }); houseView(w);
  assert.equal(JSON.stringify(w.s), before, 'the house writes nothing');
  assert(gv.verify?.() !== false, 'the ledger chain still verifies');
  const src = fs.readFileSync(path.join(root, 'lib', 'stewards-house.js'), 'utf8');
  assert(!/\.(append|approve|receipt|revert|changed|save)\(|\bw\.s\.[\w.]+\s*=[^=]|\bw\.s\.[\w.]+\.(push|splice)\(/.test(src), 'no writes in the house module');
  for (const f of ['server.js', 'lib/mcp.js']) assert(!/stewards?-house|houseView/.test(fs.readFileSync(path.join(root, f), 'utf8')), `${f}: no house route or tool`);

  // ---------- the Steward stands at its house; other heroes stay at their sites ----------
  const house = human.places.find(p => p.id === HOUSE_ID);
  let snap = w.snapshot({ human: true });
  assert(!snap.workers.some(x => x.home), 'no Steward named: nobody lives at the house');
  w.s.stewardHero = { workerId: heroes[1].id, node: null, sessionId: heroes[1].sessionId }; w.refreshWorkers();
  snap = w.snapshot({ human: true });
  const st = snap.workers.find(x => x.id === heroes[1].id), other = snap.workers.find(x => x.id === heroes[0].id);
  assert.equal(st.home, HOUSE_ID); assert(Math.hypot(st.x - house.x, st.y - house.y) < 30, 'the Steward stands at the house');
  assert(st.site, 'its work site is still known'); assert(!other.home && other.site, 'other heroes keep their sites');
  assert.equal(snap.stewardHouse.steward.set, true); assert.equal(snap.stewardHouse.steward.workerId, heroes[1].id);
  assert.equal(snap.stewardHouse.steward.onMap, !!w.nodes?.allowed(heroes[1].id));
  // A Steward that turned out to be on the isle is not placed at the house and reveals nothing.
  w.s.stewardHero = { workerId: heroes[2].id, node: null, sessionId: heroes[2].sessionId }; w.refreshWorkers();
  snap = w.snapshot({ human: true });
  assert(!snap.workers.some(x => x.home)); assert.equal(snap.stewardHouse.steward.onMap, false); assert.equal(snap.stewardHouse.steward.title, null);
  // A resting Steward goes to the Hall, not the house.
  w.s.stewardHero = { workerId: heroes[0].id, node: null, sessionId: heroes[0].sessionId };
  w.setWorkers([{ ...heroes[0], status: 'stopped' }, ...heroes.slice(1)]);
  assert(!w.snapshot({ human: true }).workers.some(x => x.home));
  w.setWorkers(heroes);

  // ---------- commissions: sent, started, confirmed; petitions and failures handled; launcher stubbed ----------
  let launches = 0;
  w.sites.launch = async () => { launches++; return { id: 'h0' }; };
  await w.sites.commission({ site: 'forge', path: '/tmp', tool: 'claude', prompt: 'Mend the tide tables' });
  await w.sites.commission({ site: 'forge', path: '/tmp', tool: 'claude', prompt: 'A visitor’s private words', petition: true });
  assert.equal(launches, 2); assert.equal(w.sites.sent.length, 1, 'a petition commission is never recorded');
  let cv = w.sites.commissionsView();
  assert.equal(cv.length, 1); assert.equal(cv[0].state, 'confirmed', 'the hero is on the map'); assert.equal(cv[0].title, 'Task 0'); assert.equal(cv[0].machine, 'this machine');
  assert(!JSON.stringify(cv).includes('Mend the tide tables'), 'the task text is never kept');
  w.sites.launch = async () => ({ id: 'not-yet' });
  await w.sites.commission({ site: 'library', path: '/tmp', tool: 'codex', prompt: 'Chart the reef' });
  w.sites.launch = async () => { throw new Error('no agent-deck'); };
  await assert.rejects(w.sites.commission({ site: 'quarry', path: '/tmp', tool: 'claude', prompt: 'x' }));
  cv = w.sites.commissionsView();
  assert.deepEqual(cv.map(c => c.state), ['failed', 'started', 'confirmed']); assert.equal(cv[1].title, null, 'no title before the hero appears');
  // A commission whose hero lands on the isle disappears from the house.
  w.sites.launch = async () => ({ id: 'h2' });
  await w.sites.commission({ site: 'forge', path: '/tmp', tool: 'claude', prompt: 'y' });
  assert.equal(w.sites.commissionsView().length, 3, 'the isle hero’s commission is dropped');
  assert(!JSON.stringify(w.snapshot({ human: true }).stewardHouse.commissions).includes('local:h2'));

  console.log('stewards-house: deploy stone states, human-only view, isle exclusion, read-only, Steward placement and commissions passed');
} finally { w?.close?.(); fs.rmSync(dir, { recursive: true, force: true }); }
