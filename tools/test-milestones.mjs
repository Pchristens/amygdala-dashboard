import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { milestoneOf, verifyCommit, MilestoneScanner } from '../lib/milestones.js';
import { validateReport } from '../lib/nodes.js';
import { Watch } from '../lib/watch.js';
import { standingNote } from '../lib/sites.js';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'milestones-'));
try {
  assert.deepEqual(milestoneOf('Milestone: parser — commit abc1234 — tested: fixtures'), { sha: 'abc1234', name: 'Milestone: parser' });
  assert.equal(milestoneOf('Milestone 3 complete\nabc1234').sha, 'abc1234');
  assert.equal(milestoneOf('Phase 2 done (abc1234)').sha, 'abc1234');
  for (const text of ['Milestone: parser', 'commit abc1234', 'Milestone: parser abc1234\n\n---\n\nAll done']) assert.equal(milestoneOf(text), null);
  assert.equal(milestoneOf('Milestone one abc1234\nMilestone two def5678').sha, 'def5678');
  const git = args => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-m', 'fixture']);
  const sha = git(['rev-parse', 'HEAD']); assert.equal(await verifyCommit(dir, sha.slice(0, 7)), sha); assert.equal(await verifyCommit(dir, 'f'.repeat(40)), false);
  const transcriptPath = path.join(dir, 'fixture.jsonl'); fs.writeFileSync(transcriptPath, JSON.stringify({ role: 'assistant', content: `Milestone: parser — commit ${sha}` }) + '\n');
  const scanner = new MilestoneScanner(), hero = { id: 'fixture', host: 'local', zone: 'village', status: 'idle', path: dir, transcriptPath };
  assert.equal((await scanner.scan(hero, ['fixture'])).sha, sha); assert.equal((await scanner.scan(hero, ['fixture'])).sha, sha);
  const session = { id: 'fixture', title: 'Fixture', project: 'fixture', path: '', group: '', status: 'idle', tool: 'codex', milestone: { sha, name: 'parser' } };
  const report = milestone => ({ hostname: 'fixture', os: 'linux', deckAvailable: true, sessions: [{ ...session, milestone }], results: [] });
  assert.doesNotThrow(() => validateReport(report(session.milestone)));
  for (const milestone of [null, { sha: 'abc1234', name: '' }, { sha, name: 'x'.repeat(61) }, { sha, name: '', extra: true }]) assert.throws(() => validateReport(report(milestone)));
  const w = { s: { findings: [], offerings: [] }, workers: [{ ...hero, title: 'Fixture', project: 'fixture', milestone: { sha, name: 'parser' } }], changed() {}, dutyHolder() {}, usage: { snapshot: () => ({}) }, petitionHero: h => h.petition };
  let watch = new Watch(w, { duty() {} }, dir, { start: false }); watch.scan(); watch.scan(); assert.equal(w.s.bells.length, 1); assert.equal(w.s.bells[0].kind, 'hero-milestone'); assert.equal(w.s.bells[0].severity, 'info');
  w.s = JSON.parse(JSON.stringify(w.s)); watch = new Watch(w, { duty() {} }, dir, { start: false }); watch.scan(); assert.equal(w.s.bells.length, 1);
  // Synthetic flags exercise refusal without any private transcript or contents.
  for (const flags of [{ zone: 'isle' }, { sealed: true }, { private: true }, { isleTagged: true }, { quarantined: true }, { petition: true }]) { w.workers = [{ ...w.workers[0], ...flags, id: 'excluded' }]; watch.scan(); assert.equal(w.s.bells.length, 1); }
  w.workers = [{ ...hero, id: 'offered', milestone: { sha, name: '' } }]; w.s.offerings = [{ headCommit: sha }]; watch.scan(); assert.equal(w.s.bells.length, 1);
  assert.ok(standingNote().includes('`Milestone: <name> — commit <hash> — tested: <how>`'));
  console.log('milestones ok');
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
