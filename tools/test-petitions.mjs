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
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearthfield-petitions-test-'));
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
  v.decide(p.id, 'allow', { answerer: 'Lyra' });
  assert.equal(runs, 0); assert.equal(c.queue.length, 1); assert.equal(w.s.petitions.at(-1).status, 'allowed');
  c.turn = null; c.tick();
  assert.equal(runs, 1); assert.equal(w.s.petitions.at(-1).status, 'answering');
  c.tick(); assert.equal(runs, 1); release();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(w.s.petitions.at(-1).status, 'answered');
  assert.equal(w.s.usage.at(-1).kind, 'guidance'); assert.equal(w.s.usage.at(-1).resident, 'Lyra');
  assert.equal(w.autoTurnsToday(), budget);
  assert.equal(rpc(b.token, 'check_guidance', { id: p.id }).answer, 'Take one small step.');
  assert.throws(() => c.validateGuidance('Other'), /Claude or Codex/);
  w.usage.limits.providers = [{ id: 'claude', windows: [{ used_percentage: 95 }] }, { id: 'codex', windows: [{ used_percentage: 90 }] }];
  assert.throws(() => c.validateGuidance('Lyra'), /85%/); assert.throws(() => c.validateGuidance('Atlas'), /85%/);
  const sample = { visitor: 'Guest', question: 'family decision' };
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
    assert(!JSON.stringify(command).includes('hearthfield.url')); assert(!JSON.stringify(command).includes('PRIVATE QUESTION'));
    if (r.agent === 'claude') { assert(command.args.includes('--strict-mcp-config')); assert.equal(command.args[command.args.indexOf('--tools') + 1], ''); }
    else if (r.agent === 'antigravity') { assert.equal(command.cmd, 'agy'); assert(command.args.includes('--sandbox')); assert(command.args.includes('--disable-slash-commands')); assert(command.args.includes('--print-timeout')); }
    else { assert(command.args.includes('read-only')); assert(command.args.includes('features.shell_tool=false')); }
  }
  assert(!JSON.stringify(w.snapshot()).includes('PRIVATE QUESTION'));
  assert(!createMcpHandler(w).lookFor('Lyra').includes('PRIVATE QUESTION'));
  console.log('PASS: petitions RPC, limits, isolation, manual decisions, privacy, queue, usage, pressure, failures, Watch, CLI isolation');
} finally { if (w) { clearTimeout(w.saveTimer); clearInterval(w.seal.timer); } fs.rmSync(dir, { recursive: true, force: true }); }
