// v0.76: node-side evidence for Temple fix checks.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { World } from '../lib/world.js';
import { Usage } from '../lib/usage.js';
import { fixView } from '../lib/snapshot.js';
Usage.prototype.pollDeck = () => {}; Usage.prototype.probe = () => {};
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amygdala-fix-node-'));
let w;
try {
  w = new World(dir, [], path.join(dir, 'residents.json'));
  const n = w.nodes, node = { id: 'node1', name: 'Other Machine', online: true, deckAvailable: true };
  n.passes = () => [node]; n.allowed = id => w.workers.some(x => x.id === id && x.zone === 'village');
  const worker = { id: 'hero1', node: node.id, sessionId: 's1', project: 'p1', zone: 'village' }; w.workers.push(worker);
  const o = { id: 'off1', node: node.id, workerId: worker.id, project: worker.project, headCommit: 'a'.repeat(40), kind: 'commit', path: null };
  w.temple.get = () => o; w.temple.readSnapshot = () => '+++ b/a.js\n+const issue = 1;';
  const f = { id: 'f1', offeringId: o.id, file: 'a.js', evidence: 'const issue = 1;', status: 'open' }; w.s.findings.push(f);
  w.tablet.entries = () => []; w.tablet.verify = () => ({ ok: true });
  const realRequest = n.request.bind(n); let requests = []; const reply = { head: 'b'.repeat(40), changedSinceSnapshot: true, diff: 'diff', evidenceStillInCommittedFile: false, evidenceStillInWorkingFile: true, uncommittedChanges: true };
  n.request = async (...args) => { requests.push(args); return JSON.stringify(reply); };
  let t = await w.tablet.trail(f.id); assert.equal(requests.length, 1); assert.equal(requests[0][1], 'fix'); assert.deepEqual(requests[0][2], { sessionId: 's1', commit: o.headCommit, file: f.file, evidence: f.evidence }); assert.deepEqual(t.answer, { headNow: reply.head, snapshotCommit: o.headCommit, ...reply });
  for (const bad of [{ ...reply, head: 'z' }, { ...reply, diff: 'x'.repeat(40001) }, { ...reply, uncommittedChanges: 'yes' }]) { requests = []; n.request = async () => JSON.stringify(bad); t = await w.tablet.trail(f.id); assert.equal(t.answer.unavailable, 'the node sent an invalid fix view'); }
  requests = []; w.workers.splice(w.workers.indexOf(worker), 1); const backup = { ...worker, id: 'hero2', sessionId: 's2' }; w.workers.push(backup); n.request = async (...args) => { requests.push(args); return JSON.stringify(reply); }; await w.tablet.trail(f.id); assert.equal(requests[0][3], backup.id);
  w.workers.splice(w.workers.indexOf(backup), 1); t = await w.tablet.trail(f.id); assert.match(t.answer.unavailable, /Other Machine/);
  const isle = { ...f, id: 'isle-f', zone: 'isle' }; w.s.findings.push(isle); w.assertOpen = () => { throw new Error('sealed'); }; requests = []; await assert.rejects(w.tablet.trail(isle.id), /sealed/); assert.equal(requests.length, 0);
  const repo = path.join(dir, 'repo'); fs.mkdirSync(repo); const git = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: 'pipe' }).toString();
  git('init', '-q'); git('config', 'user.email', 't@example.com'); git('config', 'user.name', 'T'); fs.writeFileSync(path.join(repo, 'a.js'), 'const issue = 1;\n'); git('add', '.'); git('commit', '-qm', 'reviewed'); const commit = git('rev-parse', 'HEAD').trim(); fs.writeFileSync(path.join(repo, 'a.js'), 'const fixed = 2;\n'); git('commit', '-qam', 'fixed');
  const view = await fixView(repo, commit, 'a.js', 'const issue = 1;'); assert.match(view.diff, /const fixed = 2/); assert.equal(view.evidenceStillInCommittedFile, false); await assert.rejects(fixView(repo, commit, '.env', 'x'), /not readable/);
  w.workers.push(worker); n.request = realRequest; await assert.rejects(n.request(node.id, 'fix', { sessionId: 's1', commit: 'bad', file: 'a', evidence: 'x' }, worker.id), /Invalid fix/); await assert.rejects(n.request(node.id, 'fix', { sessionId: 's1', commit: 'a'.repeat(40), file: 'a', evidence: 'x', extra: true }, worker.id), /Invalid fix/);
  console.log('fix node ok');
} finally { w?.flush?.(); fs.rmSync(dir, { recursive: true, force: true }); }
