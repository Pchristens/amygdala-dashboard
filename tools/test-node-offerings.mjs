// v0.43: offerings from node heroes (snapshot and file reads run on the hero's machine), and the standing note.
// Real git in a temp repo; the node is driven in-process through its report loop. No agent-deck, ps or model runs.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { World } from '../lib/world.js';
import { Usage } from '../lib/usage.js';
import { LEGACY_FAILURE } from '../lib/nodes.js';
import { standingNote } from '../lib/sites.js';
import { sha, snapshotOf } from '../lib/snapshot.js';
import { executeJob, reportSessions } from './amygdala-node.mjs';
Usage.prototype.pollDeck = () => {}; Usage.prototype.probe = () => {};
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amygdala-node-offer-')), repo = path.join(dir, 'proj');
const git = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: 'pipe' }).toString();
const tick = () => new Promise(r => setImmediate(r));
let w;
try {
  fs.mkdirSync(repo); git('init', '-q'); git('config', 'user.email', 't@example.com'); git('config', 'user.name', 'T');
  fs.writeFileSync(path.join(repo, 'map.js'), 'const a = 1;\nconst b = 2;\n'); git('add', '.'); git('commit', '-qm', 'base');
  fs.writeFileSync(path.join(repo, 'map.js'), 'const a = 1;\nconst b = 3;\n'); fs.writeFileSync(path.join(repo, '.env'), 'SECRET=1\n');
  w = new World(dir, [], path.join(dir, 'residents.json'));
  const n = w.nodes, p = n.auth(n.issue('Test PC', 24).token);
  const deck = [{ id: 'h1', title: 'Graphics', path: repo, status: 'running', tool: 'claude' }, { id: 'h2', title: 'Secret', path: repo, status: 'running', tool: 'claude', group: 'isle' }];
  const sessions = reportSessions(deck, []);
  let village = [], legacy = false;
  // One node report: run whatever jobs came back, as the node helper would, and send their results next time.
  let pending = [];
  const pump = async () => {
    if (n.live.get(p.id)) n.live.get(p.id).at -= 2000;
    const next = n.report(p, { hostname: 'test', os: 'linux', deckAvailable: true, sessions, results: pending.splice(0) }); village = next.village;
    for (const job of next.jobs) {
      const out = legacy ? Promise.reject(new Error('Unrequested job.')) : executeJob(job, next.jobs, deck, village);
      await out.then(o => pending.push({ id: job.id, ok: true, output: String(o), error: '' }), () => pending.push({ id: job.id, ok: false, output: '', error: LEGACY_FAILURE }));
    }
    await tick();
  };
  const settle = async promise => { let done = false, value, error; promise.then(v => { done = true; value = v; }, e => { done = true; error = e; }); for (let i = 0; i < 6 && !done; i++) await pump(); if (error) throw error; return value; };
  await pump();
  const hero = w.workers.find(x => x.id === `node:${p.id}:h1`); assert(hero && hero.node === p.id);

  // The offering: snapshotted on the node, kept with the whole change's hash, secrets never included.
  const o = await settle(w.temple.offer(hero.id, 'graphics pass'));
  const local = await snapshotOf(repo);
  assert.equal(o.node, p.id); assert.equal(o.kind, 'working changes'); assert.equal(o.headCommit, local.head); assert.equal(o.diffHash, sha(local.diff));
  assert.deepEqual(o.files, ['map.js']); assert(!w.temple.readSnapshot(o).includes('SECRET'));
  assert(w.temple.readSnapshot(o).includes('+const b = 3;'));
  // Reviewers read files at the offered commit through the node; traversal and secrets are refused there too.
  const c = await settle(w.temple.nodeLines(o, 'map.js', 1, 5)); assert.equal(c.total, 3); assert.deepEqual(c.lines.slice(0, 2), ['const a = 1;', 'const b = 2;']);
  for (const bad of ['../x', '.env', '/etc/passwd']) await assert.rejects(settle(w.temple.nodeLines(o, bad, 1, 5)), /not readable/);
  // Staleness for a decree: unchanged, then changed once the hero edits again.
  const f = { file: 'map.js', line: 2, severity: 'low', claim: 'c', scenario: 's', evidence: 'const b = 3;' };
  assert.match(await settle(w.temple.envelope(f, o)), /unchanged|Reviewed snapshot/);
  fs.writeFileSync(path.join(repo, 'map.js'), 'const a = 1;\nconst b = 4;\n');
  const second = await settle(w.temple.nodeSnapshot(hero)); assert.notEqual(second.d.hash, o.diffHash);
  // A named commit (v0.44): that commit alone, even after work lands on top of it; a stale commit still reads unchanged.
  const base = git('rev-parse', 'HEAD').trim(); git('commit', '-qam', 'later');
  const oc = await settle(w.temple.offer(hero.id, 'base', base.slice(0, 10)));
  assert.equal(oc.kind, 'commit'); assert.equal(oc.headCommit, base); assert.deepEqual(oc.files, ['map.js']); assert(w.temple.readSnapshot(oc).includes('+const b = 2;'));
  assert.match(await settle(w.temple.envelope(f, oc)), /not changed/);
  const lc = await snapshotOf(repo, base); assert.equal(lc.kind, 'commit'); assert.equal(sha(lc.diff), oc.diffHash);
  await assert.rejects(settle(w.temple.offer(hero.id, '', 'deadbeef1')), /No such commit/);
  await assert.rejects(w.temple.offer(hero.id, '', 'HEAD; rm'), /hex/);
  await assert.rejects(n.request(p.id, 'snapshot', { sessionId: 'h1', commit: '--all' }, hero.id), /Invalid snapshot/);
  // No git: the node says so as data, and the offering falls back to a scroll (the hero's output, read on the node).
  // Isle heroes on a node are refused before any job is sent.
  const isleHero = w.workers.find(x => x.id === `node:${p.id}:h2`);
  if (isleHero) await assert.rejects(w.temple.offer(isleHero.id), /village work|private/);
  // An old node doesn't know the job: the human is told to update it.
  legacy = true; await assert.rejects(settle(w.temple.offer(hero.id)), /Please update Amygdala on Test PC/); legacy = false;
  // Bad payloads never reach a node.
  await assert.rejects(n.request(p.id, 'show', { sessionId: 'h1', commit: 'zz', file: 'a', start: 1, end: 2 }, hero.id), /Invalid file read/);
  await assert.rejects(n.request(p.id, 'snapshot', { sessionId: 'h1', extra: 1 }, hero.id), /Invalid snapshot/);

  // The standing note: names the Steward only when it is reachable from the hero's machine.
  assert.match(standingNote('a655bbb4-1793157180'), /agent-deck session send a655bbb4-1793157180 /);
  assert(!standingNote(null).includes('agent-deck session send')); assert(!standingNote('x; rm -rf /').includes('rm -rf'));
  for (const note of [standingNote(null), standingNote('s')]) { assert.match(note, /don't push, deploy/); assert.match(note, /Fable/); }
  // Commissions carry the Steward only to the Steward's own machine, and never for a visitor's petition hero.
  w.s.stewardHero = { workerId: hero.id, node: p.id, sessionId: 'h1' };
  const sent = []; const realRequest = n.request.bind(n); n.request = (node, kind, payload, id) => { sent.push(payload); return Promise.resolve('{"id":"new"}'); };
  await w.sites.commission({ node: p.id, site: 'forge', path: '/x', tool: 'claude', prompt: 'Build', steward: 'forged' });
  await w.sites.commission({ node: p.id, site: 'forge', path: '/x', tool: 'claude', prompt: 'Build' }, { quiet: true });
  w.s.stewardHero = { ...w.s.stewardHero, node: 'elsewhere' }; await w.sites.commission({ node: p.id, site: 'forge', path: '/x', tool: 'claude', prompt: 'Build' });
  n.request = realRequest;
  assert.equal(sent[0].commission.steward, 'h1'); assert.equal(sent[0].commission.petition, undefined);
  assert.equal(sent[1].commission.steward, undefined); assert.equal(sent[1].commission.petition, true);
  assert.equal(sent[2].commission.steward, undefined);
  console.log('node offerings ok');
} finally { w?.flush?.(); fs.rmSync(dir, { recursive: true, force: true }); }
