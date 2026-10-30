// Cross-model review with a stub conductor: no models or runtime state.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { World } from '../lib/world.js';
import { Usage } from '../lib/usage.js';
import { createMcpHandler } from '../lib/mcp.js';
import { Conductor } from '../lib/conductor.js';
Usage.prototype.pollDeck = () => {}; Usage.prototype.probe = () => {};
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amygdala-examiner-'));
const config = [{ name: 'Themis', rank: 'priest', agent: 'claude', model: 'claude-opus-5-5' }, { name: 'Quill', rank: 'low', agent: 'codex', model: 'gpt-6.1-sol' }];
let w;
try {
  w = new World(dir, config, path.join(dir, 'roster.json')); w.s.paused = false;
  const c = Object.assign(Object.create(Conductor.prototype), { world: w, queue: [], pendingDuties: [], running: new Map(), tick() {} }); w.conductor = c;
  const g = w.governance; g.autoWakeMin = 1; g.transport = async () => '{}';
  const make = async (provider = 'anthropic', kind = 'commit') => {
    const o = { id: w.id('of'), zone: 'village', provider, tool: 'claude', kind, project: 'test', host: 'local', workerId: 'missing', headCommit: 'a'.repeat(40), status: 'open', title: 'test', commanded: {}, reviewers: [], anchored: [], files: ['x.js'], omittedPaths: [], createdAt: Date.now() };
    w.s.offerings.push(o); await g.consider(o); return o;
  };
  const mcp = createMcpHandler(w), token = 'examiner-test-turn';
  const rpc = (name, args, cap = token) => new Promise(resolve => mcp({ method: 'POST' }, { writeHead() {}, end: s => resolve(JSON.parse(s)) }, JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }), cap));
  const o = await make(); assert.equal(o.gov.examination.state, 'pending'); assert(c.pendingDuties.some(d => d.examinationId === o.id));
  g.pump(); assert(!c.pendingDuties.some(d => d.offeringIds?.includes(o.id))); assert.throws(() => g.wakePriest({}, 'human'), /Nothing awaits/);
  assert.throws(() => g.finishExamination('Themis', { offering_id: o.id, summary: 'No defects found.' }), /assigned/);
  o.gov.release = { paths: ['earlier.js'] }; fs.writeFileSync(g.releaseFile(o), '+const earlierDefect = true;');
  w.temple.examine('Quill', o.id);
  const earlier = w.temple.report('Quill', { offering_id: o.id, file: 'earlier.js', line: 1, severity: 'high', claim: 'Earlier commit defect', failure_scenario: 'An input fails', evidence: 'const earlierDefect = true;' });
  assert.equal(earlier.file, 'earlier.js');
  w.s.findings.push({ id: 'finding', offeringId: o.id, zone: 'village', reviewer: 'Quill', severity: 'high', file: 'x.js', line: 1, claim: 'EXAMINER SECRET CLAIM', status: 'open', seconds: [], disputes: [] });
  assert((await rpc('finish_examination', { offering_id: o.id, summary: 'EXAMINER SECRET SUMMARY' }, null)).result.isError);
  w.beginTurn('Quill', token, { kind: 'duty' });
  assert(!(await rpc('finish_examination', { offering_id: o.id, summary: 'EXAMINER SECRET SUMMARY' })).result.isError); w.endTurn('Quill'); assert.equal(o.gov.examination.state, 'done'); assert.deepEqual(o.gov.examination.findings, [earlier.id, 'finding']);
  assert(c.pendingDuties.some(d => d.offeringIds?.includes(o.id)));
  w.temple.readSnapshot = () => 'diff';
  const blind = w.temple.examine('Themis', o.id, 0, true); assert(!blind.includes('EXAMINER SECRET')); assert(blind.includes('hidden until you record draft_ruling'));
  const args = { id: o.id, commit: o.headCommit, verdict: 'reject', reason: 'Concrete defect found.' };
  assert.throws(() => g.rule('Themis', args), /draft_ruling/);
  g.draft('Themis', { offering_id: o.id, sha: o.headCommit, verdict: 'accept', reason: 'Independent first view.' });
  assert(w.temple.examine('Themis', o.id).includes('EXAMINER SECRET SUMMARY')); assert(w.temple.examine('Themis', o.id).includes('EXAMINER SECRET CLAIM'));
  assert.throws(() => g.draft('Themis', { offering_id: o.id, sha: o.headCommit, verdict: 'reject', reason: 'Overwrite first view.' }), /already/);
  g.rule('Themis', args); assert.equal(o.gov.rulings[0].draft.verdict, 'accept'); assert.equal(g.g.ledger.at(-1).draft.verdict, 'accept'); assert(g.verify());
  assert(!('examination' in g.public(o.gov, false))); assert(!('drafts' in g.public(o.gov, false))); assert(!('draft' in g.public(o.gov, false).rulings[0]));
  assert(!('examination' in w.snapshot({ human: false }).offerings.find(x => x.id === o.id).gov));
  const codex = await make('openai'); assert(!codex.gov.examination);
  const working = await make('anthropic', 'working changes'); assert(!working.gov.examination);
  g.g.approved['test@local'] = { sha: 'b'.repeat(40) }; g.facts = async () => ({ diff: '', files: [], lines: 0 });
  const trivial = await make(); assert.equal(trivial.gov.class, 'trivial'); assert(!trivial.gov.examination); delete g.g.approved['test@local'];
  for (const gate of ['expiry', 'pressure', 'paused', 'budget', 'hibernate', 'missing', 'disabled', 'provider']) {
    const x = await make(); assert.equal(x.gov.examination.state, 'pending');
    if (gate === 'expiry') x.gov.examination.at -= 45 * 60000;
    if (gate === 'pressure') w.usage.limits = { providers: [{ id: 'codex', windows: [{ used_percentage: 95 }] }] };
    if (gate === 'paused') w.s.paused = true;
    if (gate === 'budget') w.s.dailyTurnBudget = 0;
    if (gate === 'hibernate') w.setHibernate('Quill', true);
    if (gate === 'missing') x.gov.examination.by = 'Gone';
    if (gate === 'disabled') w.s.residents.Quill.enabled = false;
    if (gate === 'provider') config[1].model = 'claude-opus-5-5';
    g.pump(); assert.equal(x.gov.examination.state, 'skipped', gate); assert(x.gov.examination.reason); assert(g.rulableBy('Themis').includes(x));
    w.s.paused = false; w.s.dailyTurnBudget = 100; w.setHibernate('Quill', false); w.s.residents.Quill.enabled = true; config[1].model = 'gpt-6.1-sol'; delete c.pressureBlocked; w.usage.limits = { providers: [] };
  }
  assert.throws(() => g.setSettings({ examiner: 'Quill' }, 'steward'), /Only the human/); assert.throws(() => g.setSettings({ examiner: 'Gone' }, 'human'), /roster/); g.setSettings({ examiner: 'Quill' }, 'human'); assert(g.verify());
  console.log('examiner checks passed');
} finally { if (w) clearTimeout(w.saveTimer); fs.rmSync(dir, { recursive: true, force: true }); }
