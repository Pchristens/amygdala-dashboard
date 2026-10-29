// v0.59: findings from a review of the foundations. A node's release must be measured from the approved base; secret
// files stay out of the release diff even when git quotes their names; deleting a test file is never "tests added";
// post retention is per zone; hero announcements keep the feed bounded; an empty exhibit and a malformed page token are
// refused cleanly. Throwaway worlds and temp git repos; no node, agent-deck or model runs.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { World } from '../lib/world.js';
import { Usage } from '../lib/usage.js';
import { Governance, releaseFacts, classify, loadRules, validFacts } from '../lib/governance.js';
import { snapshotOf } from '../lib/snapshot.js';
Usage.prototype.pollDeck = () => {}; Usage.prototype.probe = () => {};
const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amygdala-foundations-')), repo = path.join(dir, 'proj');
const hex = n => crypto.createHash('sha1').update(`f-${n}`).digest('hex');
let w;
try {
  // ---------- a node's release is measured from the base the server asked for ----------
  const B = hex(1), H = hex(2), other = hex(3);
  const facts = base => ({ base, head: H, files: [{ path: 'README.md', added: 1, removed: 0, binary: false, status: 'M' }], tooMany: false, lines: 1, diff: '', hash: '0'.repeat(64), truncated: false });
  assert(validFacts(facts(other)));
  const G = Object.create(Governance.prototype), o = { node: 'n1', headCommit: H }, wk = { node: 'n1', sessionId: 's1', id: 'node:n1:s1' };
  let answer; G.w = { nodes: { request: async () => JSON.stringify(answer) } };
  answer = facts(other); await assert.rejects(G.facts(o, wk, B), /invalid release/, 'a release from another base must not be classified');
  answer = facts(B); assert.equal((await G.facts(o, wk, B)).base, B);

  // ---------- the release diff reviewers see leaves out secret files, quoted names included ----------
  const git = (...a) => execFileSync('git', ['-C', repo, '-c', 'user.email=t@example.com', '-c', 'user.name=T', ...a], { stdio: 'pipe' }).toString().trim();
  fs.mkdirSync(repo); git('init', '-q');
  fs.writeFileSync(path.join(repo, 'README.md'), 'a\n'); git('add', '-A'); git('commit', '-qm', 'base'); const b0 = git('rev-parse', 'HEAD');
  fs.writeFileSync(path.join(repo, 'README.md'), 'a\nb\n'); fs.writeFileSync(path.join(repo, '.env.café'), 'SYNTHETIC_SECRET_VALUE=1\n'); fs.writeFileSync(path.join(repo, '.env'), 'PLAIN_SECRET_VALUE=1\n');
  git('add', '-A'); git('commit', '-qm', 'secret'); const h0 = git('rev-parse', 'HEAD');
  const rf = await releaseFacts(repo, b0, h0);
  assert(!rf.diff.includes('SYNTHETIC_SECRET_VALUE') && !rf.diff.includes('PLAIN_SECRET_VALUE'), 'secret file contents stay out of the release diff');
  assert(rf.diff.includes('+b'), 'the rest of the diff is kept');
  assert.equal(rf.files.length, 3); assert(!classify(rf, loadRules()).trivial, 'the secret files still count against the release');
  // Offering snapshots (a commit, the last commit, working changes) leave committed secret files out too (v0.60).
  const commitSnap = await snapshotOf(repo, h0), lastSnap = await snapshotOf(repo);
  assert.equal(lastSnap.kind, 'last commit');
  for (const s of [commitSnap, lastSnap]) { assert(!s.diff.includes('SYNTHETIC_SECRET_VALUE') && !s.diff.includes('PLAIN_SECRET_VALUE'), `secret contents stay out of the ${s.kind} snapshot`); assert(s.diff.includes('+b') && s.diff.startsWith(`commit ${h0}`)); }
  fs.appendFileSync(path.join(repo, '.env'), 'WORKING_SECRET_VALUE=1\n'); fs.appendFileSync(path.join(repo, 'README.md'), 'c\n');
  const work = await snapshotOf(repo); assert.equal(work.kind, 'working changes'); assert(!work.diff.includes('WORKING_SECRET_VALUE') && work.diff.includes('+c'));
  git('checkout', '--', '.');

  // ---------- deleting a test file is never "tests added" ----------
  const del = classify({ files: [{ path: 'tools/test-a.mjs', added: 0, removed: 0, binary: false, status: 'D' }], lines: 0, tooMany: false }, loadRules());
  assert(!del.trivial); assert.match(del.reasons.join(), /test file was deleted/);

  // ---------- the world ----------
  const roster = JSON.parse(fs.readFileSync(path.join(root, 'residents.json'), 'utf8')).filter(r => r.zone !== 'isle');
  w = new World(dir, roster, path.join(dir, 'residents.json'));
  const name = roster[0].name;
  // Post retention is per zone: village chatter never evicts the other side's posts.
  for (let i = 0; i < 5; i++) w.s.posts.push({ id: w.id('p'), author: 'synthetic', authorKind: 'resident', zone: 'isle', channel: 'commons', text: 'x', ts: 0 });
  for (let i = 0; i < 305; i++) w.addPost(name, 'resident', `village post ${i}`, 'commons', null, 'village');
  assert.equal(w.s.posts.filter(p => p.zone === 'isle').length, 5, 'isle posts survive village activity');
  assert.equal(w.s.posts.filter(p => p.zone === 'village').length, 300);
  // A missing poem is refused as empty, not a TypeError.
  assert.throws(() => w.addExhibit(name, 'Nothing', 'poem', undefined), /Content is empty/);
  // Hero announcements keep the feed bounded.
  const now = Date.now(), hero = status => ({ id: 'local:h1', sessionId: 'h1', title: 'Task', tool: 'claude', host: 'local', project: 'tideworks', path: '/tmp/tideworks', status, updatedAt: now, lastActivityAt: now });
  for (let i = 0; i < 200; i++) w.setWorkers([hero(i % 2 ? 'waiting' : 'running')]);
  assert(w.s.feed.filter(f => (f.zone ?? 'village') === 'village').length <= 150, `feed bounded (${w.s.feed.length})`);

  // ---------- a malformed page token is refused, not a RangeError ----------
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8'), auth = server.match(/const tokenOk = ([\s\S]*?\n});/)[1];
  const token = 'a'.repeat(32), tokenOk = vm.runInNewContext('(' + auth + ')', { crypto, Buffer, String, API_TOKEN: token }), url = new URL('http://x/');
  assert.equal(tokenOk({ headers: { 'x-amygdala-token': 'é'.repeat(32) } }, url), false);
  assert.equal(tokenOk({ headers: {} }, new URL('http://x/?token=' + encodeURIComponent('é'.repeat(32)))), false);
  assert.equal(tokenOk({ headers: { 'x-amygdala-token': token } }, url), true);
  console.log('foundations ok: node release base, quoted secret paths, test deletion, per-zone posts, bounded feed, empty exhibit, page token');
} finally {
  w?.close?.();
  fs.rmSync(dir, { recursive: true, force: true });
}
