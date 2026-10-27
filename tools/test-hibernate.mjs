import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { World } from '../lib/world.js';
import { Usage } from '../lib/usage.js';
import { Conductor, turnPrompt, ROLE_JOBS } from '../lib/conductor.js';
import { createMcpHandler } from '../lib/mcp.js';
import { Watch } from '../lib/watch.js';
import { triagePetition } from '../lib/triage.js';
Usage.prototype.pollDeck = () => {};
Usage.prototype.probe = () => {};
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearthfield-hibernate-'));
let w;
try {
  const config = [
    { name: 'Quill', agent: 'claude', model: 'claude-fable', role: 'bard', bard: true, title: 'The Bard' },
    { name: 'Iris', agent: 'claude', model: 'claude-fable', rank: 'priest', title: 'High Priest' },
    { name: 'Atlas', agent: 'codex', model: 'gpt-6-astra', role: 'starwatcher', rank: 'high' },
    { name: 'Terra', agent: 'codex', model: 'gpt-6.1-terra', role: 'smith' },
    { name: 'Bram', agent: 'claude', model: 'claude-sonnet', role: 'harbourmaster' },
    { name: 'Juniper', agent: 'claude', model: 'claude-sonnet', role: 'watch' },
    { name: 'Kleio', agent: 'claude', model: 'claude-sonnet', role: 'archivist' },
    { name: 'Guest', agent: 'antigravity', model: 'gemini-4-argon', enabled: false },
  ].map(r => ({ persona: 'A resident.', ...r }));
  const file = path.join(dir, 'residents.json'); fs.writeFileSync(file, JSON.stringify(config)); w = new World(dir, config, file);
  const pressure = { anthropic: 0, openai: 0, google: 0 }; w.usage.providerPressure = provider => pressure[provider] ?? 0;
  const transitions = () => w.s.feed.filter(f => /hibernates|wakes from hibernation/.test(f.text));
  w.setHibernate('Quill', true); w.isHibernating('Quill'); w.isHibernating('Quill');
  assert.equal(transitions().length, 1); assert.equal(w.s.residents.Quill.hibernateReason, 'manual');
  w.setHibernate('Quill', false); w.isHibernating('Quill'); assert.equal(transitions().length, 2);
  pressure.anthropic = 80; assert(w.isHibernating('Quill')); const since = w.s.residents.Quill.hibernatingSince;
  pressure.anthropic = 79; assert(w.isHibernating('Quill')); pressure.anthropic = 75; assert(w.isHibernating('Quill'));
  assert.equal(w.s.residents.Quill.hibernatingSince, since); assert.equal(transitions().length, 3);
  pressure.anthropic = 74; assert(!w.isHibernating('Quill')); assert.equal(transitions().length, 4);
  pressure.anthropic = 80; w.isHibernating('Quill'); w.setHibernate('Quill', true); pressure.anthropic = 77; w.setHibernate('Quill', false); assert(w.isHibernating('Quill'));
  pressure.anthropic = 74; assert(!w.isHibernating('Quill'));
  assert.equal(w.snapshot().residents.find(r => r.name === 'Quill').hibernating, false);

  // Prototype harness: no conductor constructor, timers, homes, or provider processes.
  const runs = [], c = Object.assign(Object.create(Conductor.prototype), { world: w, queue: [], pendingDuties: [], lastEnd: 0, rr: 0, current: null, turn: null, hasNews: () => true,
    run(r, reasons) { runs.push({ r, prompt: turnPrompt(r, reasons), job: this.current }); w.beginTurn(r.name, 'test-capability'); } });
  w.conductor = c; w.s.paused = false; c.digestDay = new Date().toISOString().slice(0, 10);
  const finish = () => { if (w.activeTurn) w.endTurn(w.activeTurn.resident); c.current = null; c.turn = null; c.lastEnd = Date.now(); };
  pressure.anthropic = 90; pressure.openai = 90;
  c.tick(); assert.equal(runs.length, 0);
  c.wake('Quill', 'A resident mention', { human: false }); assert.equal(runs.length, 0);
  c.onPost({ id: 'p-human', text: '@Quill please answer', author: 'You', authorKind: 'human', zone: 'village' });
  assert.equal(runs.length, 1); assert.equal(runs[0].r.name, 'Quill'); assert.equal(runs[0].job.human, true); finish(); c.queue = [];

  pressure.openai = 0;
  const tale = { id: 't-delegate', zone: 'village', hero: 'A hero', tool: 'codex', project: 'demo', commits: [], fixed: [], workedMs: 60000, startedAt: Date.now() - 60000, endedAt: Date.now(), tale: null };
  w.s.tales.push(tale);
  const mcp = createMcpHandler(w), rpc = (method, params) => new Promise(resolve => mcp({ method: 'POST' }, { writeHead() {}, end(body) { resolve(JSON.parse(body)); } }, JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), 'test-capability'));
  c.duty('bard', 'village', 'tale:t-delegate', 'Tell the completed tale');
  const delegated = runs.at(-1); assert.equal(delegated.r.name, 'Atlas'); assert.deepEqual(delegated.job.standIn, { role: 'bard', for: 'Quill', title: 'The Bard' });
  assert.match(delegated.prompt, /You are standing in for Quill as The Bard while they hibernate/); assert(delegated.prompt.includes(ROLE_JOBS.bard));
  assert.match(mcp.lookFor('Atlas'), /You are the bard/);
  assert(w.actsAs('Atlas', 'bard')); assert(!w.actsAs('Terra', 'bard'));
  assert((await rpc('tools/list')).result.tools.some(t => t.name === 'write_tale'));
  const told = await rpc('tools/call', { name: 'write_tale', arguments: { id: tale.id, title: 'A faithful tale', text: 'The hero completed a minute of careful work. The village remembers the labour from the recorded account.' } });
  assert(!told.result.isError, JSON.stringify(told)); assert.equal(tale.bard, 'Atlas');
  finish(); assert(!w.actsAs('Atlas', 'bard')); assert.throws(() => w.tales.tell('Atlas', tale.id, 'No', 'x'.repeat(100)), /Only the bard/);
  assert.equal((await rpc('tools/call', { name: 'set_status', arguments: { mood: 'oops', doing: 'oops' } })).result.isError, true);

  // Same-tier selection and priest conflicts are checked before dispatch and at judgement.
  const f = { id: 'f-omen', zone: 'village', project: 'demo', status: 'omen', reviewer: 'Atlas', provider: 'openai', seconds: [{ by: 'Terra', provider: 'openai' }], disputes: [] }; w.s.findings.push(f);
  c.duty('priest', 'village', 'omen:f-omen', 'Judge the omen', f.id);
  assert.equal(c.pendingDuties.length, 1); assert.equal(runs.at(-1), delegated);
  f.seconds = []; c.tick(); assert.equal(runs.at(-1).r.name, 'Terra'); assert(w.actsAs('Terra', 'priest'));
  f.seconds.push({ by: 'Terra', provider: 'openai' }); assert.throws(() => w.temple.judge('Terra', f.id, 'reject', 'I seconded it'), /cannot judge/);
  f.seconds = []; f.reviewer = 'Terra'; assert.throws(() => w.temple.judge('Terra', f.id, 'reject', 'I found it'), /cannot judge/); finish();

  // Other role permissions follow the same temporary predicate.
  w.s.residents.Terra.hibernate = true;
  const fix = { id: 'f-fix', zone: 'village', project: 'demo', status: 'awaiting_confirmation' }; w.s.findings.push(fix);
  c.duty('smith', 'village', 'fix:f-fix', 'Check a fix'); assert.equal(runs.at(-1).r.name, 'Atlas');
  const smithTools = (await rpc('tools/list')).result.tools.map(t => t.name); assert(smithTools.includes('fix_check') && smithTools.includes('read_fix'));
  assert.match(mcp.lookFor('Atlas'), /Forge log/);
  w.temple.fixCheck('Atlas', { findingId: fix.id, verdict: 'holds', note: 'Advisory check only.' }); assert.equal(fix.status, 'awaiting_confirmation');
  finish(); assert.throws(() => w.temple.fixCheck('Atlas', { findingId: fix.id }), /Only the smith/);
  w.watch = new Watch(w, c, dir, { start: false }); w.watch.raise('test-event', 'test', 'village', 'A synthetic village event.'); w.watch.notify();
  assert.equal(runs.at(-1).r.name, 'Atlas'); assert((await rpc('tools/list')).result.tools.some(t => t.name === 'ring_bell'));
  w.watch.ring('Atlas', { severity: 'info', summary: 'A synthetic report.', event_keys: ['test-event:test'] });
  w.watch.completed('Atlas'); assert.equal(w.watch.state.pending.length, 0); finish(); assert.throws(() => w.watch.ring('Atlas', {}), /Only the Watch/);
  c.duty('archivist', 'village', 'digest:test', 'Keep the Archive'); assert.match(mcp.lookFor('Atlas'), /Daily digest: due today/);
  w.addPost('Atlas', 'resident', 'A short factual digest.', 'projects'); assert.equal(w.s.residents.Kleio.digestDay, new Date().toISOString().slice(0, 10));
  assert.throws(() => w.addPost('Atlas', 'resident', 'Another digest.', 'projects'), /already been posted/); finish();
  w.s.residents.Terra.hibernate = false;

  // Keep work queued without spending any hot allowance, then retry once pressure recovers.
  pressure.openai = 90; c.duty('bard', 'village', 'tale:pending', 'A pending tale'); c.duty('bard', 'village', 'tale:pending', 'Duplicate');
  assert.equal(c.pendingDuties.length, 1); const before = runs.length;
  c.tick(); assert.equal(runs.length, before); pressure.anthropic = 74; c.tick();
  assert.equal(c.pendingDuties.length, 0); assert.equal(runs.length, before + 1); assert.equal(runs.at(-1).r.name, 'Quill'); finish();
  pressure.anthropic = 90; w.setHibernate('Quill', true); c.duty('bard', 'village', 'tale:manual', 'Manual sleep'); assert.equal(c.pendingDuties.length, 1); assert.equal(runs.length, before + 1);
  for (let i = 0; i < 30; i++) c.duty('bard', 'village', `tale:cap-${i}`, 'Pending'); assert.equal(c.pendingDuties.length, 20); c.pendingDuties = [];

  // Synthetic zone metadata only: never inspect real isle state or transcripts.
  w.cfg('Guest').enabled = true; w.s.residents.Guest.enabled = true; w.s.residents.Guest.zone = 'isle';
  for (const r of config.filter(r => r.name !== 'Guest')) w.s.residents[r.name].hibernate = true;
  assert.equal(w.dutyHolder('bard', 'village'), null);
  w.s.residents.Guest.zone = 'village'; assert.equal(w.dutyHolder('bard', 'village').name, 'Guest');
  w.s.residents.Guest.enabled = false;

  // Harbourmaster triage never runs a hot provider and retries with a tool-less stand-in.
  let triages = 0; const petition = { id: 'petition-test', visitor: 'Visitor', about: 'hello', question: 'hello', status: 'pending' }; w.s.petitions.push(petition);
  await triagePetition(w, petition, async () => { triages++; throw new Error('Should not run'); });
  assert.equal(triages, 0); assert(w.visitors.pendingTriages.includes(petition.id));
  w.s.residents.Terra.hibernate = false; pressure.openai = 0;
  w.visitors.triageRunner = async r => { triages++; assert.equal(r.name, 'Terra'); return { answer: JSON.stringify({ greeting: 'Welcome, Visitor', tier: 'quick', suggest: 'Terra' }) }; };
  w.visitors.retryTriages(); await w.visitors.triages.get(petition.id); assert.equal(triages, 1);
  w.s.paused = true; c.queue = []; c.pendingDuties = [];
  console.log('PASS: hibernation transitions/hysteresis, routine and duty gates, human mention bypass, bard prompt/tools/capability, priest conflicts, deferred retry/dedupe/cap, zone separation, tool-less harbourmaster delegation');
} finally {
  if (w) { w.s.paused = true; clearTimeout(w.saveTimer); clearInterval(w.seal.timer); }
  fs.rmSync(dir, { recursive: true, force: true });
}
