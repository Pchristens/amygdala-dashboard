import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { World } from '../lib/world.js';
import { Usage } from '../lib/usage.js';
import { Conductor } from '../lib/conductor.js';
import { createMcpHandler } from '../lib/mcp.js';
import { normalizeTriage, modelTier } from '../lib/triage.js';
import { guidanceCommand } from '../lib/guidance.js';
import { Watch } from '../lib/watch.js';
Usage.prototype.pollDeck = () => {};
Usage.prototype.probe = () => {};
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amygdala-petitions-test-'));
let w;
try {
  const config = [{ name: 'Lyra', agent: 'claude', model: 'claude-haiku-5-5', persona: 'Kind and thoughtful', title: 'Guide' }, { name: 'Atlas', agent: 'codex', model: 'gpt-5' }, { name: 'Other', agent: 'grok' }, { name: 'Bram', role: 'harbourmaster', agent: 'antigravity', model: 'gemini-3.8-flash-medium' }, { name: 'Moss', agent: 'grok', enabled: false }, { name: 'Gem', role: 'librarian', agent: 'antigravity', model: 'gemini-4-argon-medium' }];
  w = new World(dir, config, path.join(dir, 'residents.json'));
  const v = w.visitors;
  v.triageRunner = async () => ({ answer: JSON.stringify({ greeting: 'Welcome, Father, to Willow Pier.', tier: 'considered', suggest: 'Atlas', alternates: ['Gem'], reason: 'A thoughtful guide.' }) });
  const a = v.issue('Father'), b = v.issue('Guest');
  const rpc = (token, name, args = {}) => {
    const reply = v.mcp(token, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }).result;
    if (reply.isError) throw new Error(reply.content[0].text);
    try { return JSON.parse(reply.content[0].text); } catch { return reply.content[0].text; }
  };
  const ask = () => rpc(a.token, 'ask_guidance', { question: 'PRIVATE QUESTION: how should I approach a difficult conversation?', about: 'Family' });
  const first = ask(), second = ask();
  await v.triages.get(first.id); await v.triages.get(second.id);
  assert.equal(w.s.petitions[0].triage.suggest, 'Atlas');
  assert.equal((await v.waitTriage(first)).id, first.id);
  assert.match(rpc(a.token, 'check_guidance', { id: first.id }).triage.greeting, /Father/);
  assert.equal(w.snapshot({ human: true }).petitions[0].triage.suggest, 'Atlas');
  assert(w.snapshot({ human: true }).petitions[0].answerers.some(r => r.name === 'Gem' && r.tier === 'deep'));
  assert.equal(first.status, 'pending'); assert.equal(w.s.petitions.length, 2);
  // Each petition rings the keeper's bell at once, without the question.
  const rung = w.s.bells.filter(b => b.kind === 'petition'); assert.equal(rung.length, 2); assert.equal(rung[0].severity, 'attention');
  assert(!JSON.stringify(w.s.bells).includes('PRIVATE QUESTION') && !JSON.stringify(w.s.bells).includes('Family'));
  assert.throws(ask, /2 pending/);
  assert.throws(() => rpc(a.token, 'ask_guidance', { question: 'x'.repeat(2001) }), /2000/);
  assert.throws(() => rpc(b.token, 'ask_guidance', { question: 'test', about: 'x'.repeat(81) }), /80/);
  assert.throws(() => rpc(b.token, 'check_guidance', { id: first.id }), /No such/);
  assert.deepEqual(rpc(b.token, 'check_guidance'), []);
  assert.equal(rpc(a.token, 'check_guidance').length, 2);
  v.decide(first.id, 'deny', { note: 'Please speak to someone you trust.' });
  assert.equal(rpc(a.token, 'check_guidance', { id: first.id }).note, 'Please speak to someone you trust.');
  assert.throws(() => v.decide(first.id, 'allow', { answerer: 'self', answer: 'x' }), /pending/);
  v.decide(second.id, 'allow', { answerer: 'self', answer: 'Listen carefully and make time.' });
  assert.equal(rpc(a.token, 'check_guidance', { id: second.id }).answerer, 'You');
  for (let i = 2; i < 8; i++) { const p = ask(); v.decide(p.id, 'deny'); }
  assert.throws(ask, /8 guidance/);
  assert.equal(rpc(a.token, 'check_guidance').length, 5);
  assert(!JSON.stringify(w.snapshot()).includes('PRIVATE QUESTION'));
  assert(!('petitions' in w.snapshot()));
  assert(w.snapshot({ human: true }).petitions[0].question.includes('PRIVATE QUESTION'));
  assert(!JSON.stringify([w.s.feed, w.s.posts]).includes('PRIVATE QUESTION'));
  assert(!rpc(a.token, 'look').includes('PRIVATE QUESTION'));
  assert(!createMcpHandler(w).lookFor('Lyra').includes('PRIVATE QUESTION'));
  // Use the real queue/tick and decision methods without starting conductor intervals or CLIs.
  const c = Object.assign(Object.create(Conductor.prototype), { world: w, queue: [], turn: { name: 'busy' }, lastEnd: Date.now(), rr: 0 });
  w.conductor = c;
  const p = rpc(b.token, 'ask_guidance', { question: 'PRIVATE QUESTION for Lyra' });
  let runs = 0, release;
  c.guidanceRunner = async () => { runs++; await new Promise(resolve => { release = resolve; }); return { answer: 'Take one small step.', text: '{"usage":{"input_tokens":12,"output_tokens":5}}' }; };
  const budget = w.autoTurnsToday();
  w.usage.limits.providers = [{ id: 'claude', windows: [{ used_percentage: 20 }] }];
  v.decide(p.id, 'allow', { answerer: 'Lyra', depth: 'research', rounds: 2 });
  assert.equal(runs, 0); assert.equal(c.queue.length, 1); assert.equal(w.s.petitions.at(-1).status, 'allowed');
  c.turn = null; c.tick();
  assert.equal(runs, 1); assert.equal(w.s.petitions.at(-1).status, 'answering');
  c.tick(); assert.equal(runs, 1); release();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(w.s.petitions.at(-1).status, 'answered');
  assert.equal(w.s.usage.at(-1).kind, 'guidance'); assert.equal(w.s.usage.at(-1).resident, 'Lyra');
  assert.equal(w.autoTurnsToday(), budget);
  assert.equal(rpc(b.token, 'check_guidance', { id: p.id }).answer, 'Take one small step.');
  // Research follow-ups stay private and are held by provider pressure, then run without human priority.
  let followRun = 0, finishFollow;
  c.guidanceRunner = async (_r, task) => { followRun++; assert.equal(task.depth, 'research'); assert.equal(task.followups[0].question, 'PRIVATE FOLLOW-UP'); await new Promise(resolve => { finishFollow = resolve; }); return { answer: 'A sourced follow-up.', text: 'usage' }; };
  c.turn = { name: 'busy' };
  const follow = rpc(b.token, 'follow_up_guidance', { id: p.id, text: 'PRIVATE FOLLOW-UP' });
  assert.equal(follow.status, 'waiting'); assert.equal(c.queue.at(-1).human, undefined);
  assert.throws(() => rpc(b.token, 'follow_up_guidance', { id: p.id, text: 'x'.repeat(2001) }), /2000/);
  w.usage.limits.providers = [{ id: 'claude', windows: [{ used_percentage: 96 }] }]; c.turn = null; c.tick();
  assert.equal(followRun, 0); assert(c.queue.some(j => j.followup === 0));
  w.usage.limits.providers = [{ id: 'claude', windows: [{ used_percentage: 75 }] }]; c.tick(); assert.equal(followRun, 0, 'a research follow-up keeps to the 70% bar');
  w.usage.limits.providers = [{ id: 'claude', windows: [{ used_percentage: 20 }] }]; w.s.paused = true; c.tick(); assert.equal(followRun, 0, 'a paused village holds follow-ups');
  w.s.paused = false; c.tick(); assert.equal(followRun, 1);
  finishFollow({ answer: 'A sourced follow-up.', text: 'usage' }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(rpc(b.token, 'check_guidance', { id: p.id }).followups[0].answer, 'A sourced follow-up.');
  c.turn = { name: 'busy' };
  assert.equal(rpc(b.token, 'follow_up_guidance', { id: p.id, text: 'second' }).status, 'waiting');
  assert.throws(() => rpc(b.token, 'follow_up_guidance', { id: p.id, text: 'third' }), /No follow-ups/);
  // A restart forgets the queue: the waiting follow-up fails, and a failed follow-up gives its round back.
  new v.constructor(w); assert.equal(w.s.petitions.find(x => x.id === p.id).followups[1].status, 'failed');
  assert.equal(rpc(b.token, 'follow_up_guidance', { id: p.id, text: 'second again' }).status, 'waiting');
  assert.throws(() => rpc(b.token, 'follow_up_guidance', { id: p.id, text: 'third' }), /No follow-ups/);
  const newest = guidanceCommand({ name: 'Lyra', agent: 'claude', model: 'm', persona: '' }, { visitor: 'Guest', question: 'q', answer: 'a', depth: 'research', followupRun: true, followups: [{ question: 'f1' }] }, '/tmp/empty');
  assert.match(newest.args[1], /Answer the newest follow-up/);
  assert(!JSON.stringify([w.s.posts, w.s.feed]).includes('PRIVATE FOLLOW-UP'));
  c.queue = []; c.turn = { name: 'busy' };
  assert.throws(() => c.validateGuidance('Other'), /Claude or Codex/);
  w.usage.limits.providers = [{ id: 'claude', windows: [{ used_percentage: 95 }] }, { id: 'codex', windows: [{ used_percentage: 90 }] }];
  assert.throws(() => c.validateGuidance('Lyra'), /85%/); assert.throws(() => c.validateGuidance('Atlas'), /85%/);
  const sample = { visitor: 'Guest', question: 'family decision' };
  c.turn = null;
  const agyResearch = rpc(b.token, 'ask_guidance', { question: 'research for agy' }); await v.triages.get(agyResearch.id);
  assert.throws(() => v.decide(agyResearch.id, 'allow', { answerer: 'Gem', depth: 'research' }), /below 70%|Claude or Codex/);
  w.usage.limits.providers = [{ id: 'claude', windows: [{ used_percentage: 70 }] }];
  assert.throws(() => v.decide(agyResearch.id, 'allow', { answerer: 'Lyra', depth: 'research' }), /below 70%/);
  v.decide(agyResearch.id, 'deny');
  assert.notEqual(normalizeTriage(w, sample, { tier: 'deep', suggest: 'Lyra' }).suggest, 'Lyra');
  assert.notEqual(normalizeTriage(w, sample, { suggest: 'Moss' }).suggest, 'Moss');
  assert.equal(normalizeTriage(w, sample, { tier: 'deep', suggest: 'Bram' }).suggest, 'Gem');
  for (const suggest of ['Lyra', 'Moss']) {
    v.triageRunner = async () => ({ answer: JSON.stringify({ greeting: 'Welcome, Guest.', tier: 'deep', suggest, alternates: [], reason: 'A guide.' }) });
    const invalid = rpc(b.token, 'ask_guidance', { question: 'family decision' });
    await v.triages.get(invalid.id);
    assert.equal(rpc(b.token, 'check_guidance', { id: invalid.id }).triage.suggest, 'Gem');
    v.decide(invalid.id, 'deny');
  }
  w.usage.limits.providers = [];
  v.triageRunner = async () => { throw new Error('timeout'); };
  const fallback = rpc(b.token, 'ask_guidance', { question: 'family decision' });
  await v.triages.get(fallback.id);
  assert.match(rpc(b.token, 'check_guidance', { id: fallback.id }).triage.greeting, /Welcome to Willow Pier, Guest/);
  v.decide(fallback.id, 'deny');
  c.guidanceRunner = async r => { assert.equal(r.agent, 'antigravity'); return { answer: 'A Gemini reply.' }; };
  const gem = rpc(b.token, 'ask_guidance', { question: 'learning' });
  await v.triages.get(gem.id);   // triage holds the conductor; the answer runs after it
  v.decide(gem.id, 'allow', { answerer: 'Gem' });
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(rpc(b.token, 'check_guidance', { id: gem.id }).answer, 'A Gemini reply.');
  assert.equal(modelTier('gpt-6-astra'), 'deep');

  c.guidanceRunner = async () => { throw new Error('timeout'); };
  const failed = rpc(b.token, 'ask_guidance', { question: 'PRIVATE QUESTION timeout' });
  await v.triages.get(failed.id);
  v.decide(failed.id, 'allow', { answerer: 'Atlas' }); await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(rpc(b.token, 'check_guidance', { id: failed.id }).status, 'failed');
  assert.equal(rpc(b.token, 'check_guidance', { id: failed.id }).note, 'the answer could not be prepared; ask again later');
  const old = rpc(b.token, 'ask_guidance', { question: 'PRIVATE QUESTION old' }); w.s.petitions.find(x => x.id === old.id).askedAt -= 11 * 60000;
  const watch = new Watch(w, c, dir, { start: false }); watch.scan();
  assert(watch.state.pending.some(x => x.key === `petition-pending:${old.id}`));
  assert(!JSON.stringify(watch.state).includes('PRIVATE QUESTION'));
  for (const r of [config[0], config[1], config[3]]) {
    const command = guidanceCommand(r, { visitor: 'Guest', question: 'test' }, '/tmp/empty', '/tmp/profile');
    assert(!JSON.stringify(command).includes('amygdala.url')); assert(!JSON.stringify(command).includes('PRIVATE QUESTION'));
    if (r.agent === 'claude') { assert(command.args.includes('--strict-mcp-config')); assert.equal(command.args[command.args.indexOf('--tools') + 1], ''); }
    else if (r.agent === 'antigravity') { assert.equal(command.cmd, 'agy'); assert(command.args.includes('--sandbox')); assert(command.args.includes('--disable-slash-commands')); assert(command.args.includes('--print-timeout')); }
    else { assert(command.args.includes('read-only')); assert(command.args.includes('features.shell_tool=false')); }
  }
  const claudeAnswer = guidanceCommand(config[0], { visitor: 'Guest', question: 'test', depth: 'answer' }, '/tmp/empty', '/tmp/profile');
  const codexAnswer = guidanceCommand(config[1], { visitor: 'Guest', question: 'test', depth: 'answer' }, '/tmp/empty', '/tmp/profile');
  assert.equal(claudeAnswer.args[claudeAnswer.args.indexOf('--tools') + 1], ''); assert(codexAnswer.args.includes('web_search="disabled"'));
  const claudeResearch = guidanceCommand(config[0], { visitor: 'Guest', question: 'test', depth: 'research' }, '/tmp/empty', '/tmp/profile');
  const codexResearch = guidanceCommand(config[1], { visitor: 'Guest', question: 'test', depth: 'research' }, '/tmp/empty', '/tmp/profile');
  assert(claudeResearch.args.includes('WebSearch,WebFetch')); assert(claudeResearch.args.includes('--allowedTools'));
  assert(!claudeResearch.args.some(x => /Bash|Read|Edit|Write|ApplyPatch/.test(x)));
  assert(codexResearch.args.includes('web_search="live"')); assert(codexResearch.args.includes('features.shell_tool=false'));
  assert(!JSON.stringify(w.snapshot()).includes('PRIVATE QUESTION'));
  assert(!createMcpHandler(w).lookFor('Lyra').includes('PRIVATE QUESTION'));
  console.log('PASS: petitions RPC, limits, isolation, manual decisions, privacy, queue, usage, pressure, failures, Watch, CLI isolation');
} finally { if (w) { clearTimeout(w.saveTimer); clearInterval(w.seal.timer); } fs.rmSync(dir, { recursive: true, force: true }); }
