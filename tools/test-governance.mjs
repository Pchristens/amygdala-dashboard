// v0.46: Temple governance. The mechanical trivial check, rulings bound to a commit, receipts, overrides, appeals, the
// ledger and the High Priest's reserved wakes. Real git in temp repos; the conductor is stubbed, so no model ever runs.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { World } from '../lib/world.js';
import { Usage } from '../lib/usage.js';
import { Conductor } from '../lib/conductor.js';
import { createMcpHandler } from '../lib/mcp.js';
import { classify, loadRules, releaseFacts, tokensSame, jsTokens, globRe, validFacts } from '../lib/governance.js';
Usage.prototype.pollDeck = () => {}; Usage.prototype.probe = () => {};
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amygdala-governance-')), repo = path.join(dir, 'proj');
const git = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: 'pipe' }).toString().trim();
const write = (f, s) => { fs.mkdirSync(path.dirname(path.join(repo, f)), { recursive: true }); fs.writeFileSync(path.join(repo, f), s); };
const commit = (msg, files) => { for (const [f, s] of Object.entries(files)) s === null ? fs.rmSync(path.join(repo, f)) : write(f, s); git('add', '-A'); git('commit', '-qm', msg); return git('rev-parse', 'HEAD'); };
const lines = n => Array.from({ length: n }, (_, k) => `line ${k}`).join('\n') + '\n';
const tick = () => new Promise(r => setImmediate(r));
let w;
try {
  // ---------- the classifier ----------
  const rules = loadRules();
  assert(rules && rules.maxLines === 20);
  assert(globRe('public/**/*.css').test('public/a/b.css') && globRe('public/**/*.css').test('public/b.css') && !globRe('public/*.css').test('public/a/b.css'));
  assert(globRe('**/package.json').test('package.json') && globRe('tools/*keeper*').test('tools/amygdala-keeper.mjs'));
  // Comments and string text only; code, module specifiers and line breaks are code.
  assert.equal(tokensSame('a.js', 'const a = "x"; // c\nf(a, `t ${b} u`)', 'const a = "yy"; /* d */ // e\nf(a, `v ${b} w`)'), true);
  assert.equal(tokensSame('a.js', 'const a = 1', 'const a = 2'), false);
  assert.equal(tokensSame('a.js', 'f(`t ${b}`)', 'f(`t ${c}`)'), false);
  assert.equal(tokensSame('a.js', 'import x from "./a.js"', 'import x from "./b.js"'), false);
  assert.equal(tokensSame('a.js', 'const m = await import("./a.js")', 'const m = await import("./b.js")'), false);
  assert.equal(tokensSame('a.js', 'return\nx', 'return x'), false);
  assert.equal(tokensSame('a.js', 'x = /re/.test(s)', 'x = /re/.test(s) // why'), true);
  assert.equal(tokensSame('a.js', 'x = /re/.test(s)', 'x = /rf/.test(s)'), false);
  assert.equal(tokensSame('a.js', 'x = a / b', 'x = a / b /* half */'), true);
  // Unsure means non-trivial: a slash after `}`, an unterminated string, comment or template.
  assert.equal(tokensSame('a.js', '{}\n/x/.test(b)', '{}\n/x/.test(b)'), null);
  for (const bad of ['"abc', '/* open', '`open ${x}', 'f(']) assert.equal(jsTokens(bad), null);
  assert.equal(tokensSame('a.html', '<p class="a">Hello</p><!-- c -->', '<p class="a">Goodbye</p>'), true);
  assert.equal(tokensSame('a.html', '<p class="a">Hello</p>', '<p class="b">Hello</p>'), false);
  assert.equal(tokensSame('a.html', '<script>a()</script>', '<script>b()</script>'), false);
  for (const f of ['public/app.js', 'public/panel.js', 'lib/temple.js', 'lib/governance.js', 'server.js']) assert(jsTokens(fs.readFileSync(f, 'utf8')), `${f} tokenizes`);
  assert.equal(classify({ files: [{ path: 'README.md', added: 1, removed: 0, binary: false, status: 'M' }], lines: 1 }, null).trivial, false, 'no rules file: fail closed');
  assert.equal(loadRules(path.join(dir, 'missing.json')), null);
  assert(!validFacts({ base: 'x' }));

  fs.mkdirSync(repo); git('init', '-q'); git('config', 'user.email', 't@example.com'); git('config', 'user.name', 'T');
  const base = commit('base', { 'README.md': lines(5), 'server.js': 'const a = 1;\n', 'public/a.js': 'const s = "hello"; // greet\nexport const f = x => /x+/.test(x) ? s : x / 2;\n',
    'public/s.css': 'a { color: red; }\n', 'tools/test-a.mjs': 'assert(1);\nassert(2);\n', 'governance/protected.json': '{}\n', 'notes.txt': 'n\n', 'public/b.js': '{}\n/x/.test(b)\n' });
  const facts = async (b, h) => { const j = await releaseFacts(repo, b, h); assert(validFacts(j)); return classify(j, rules); };
  // Prose, style, string/comment-only JS and added tests: trivial.
  const c1 = commit('prose', { 'README.md': lines(5) + 'More words.\n', 'public/s.css': 'a { color: blue; }\n', 'public/a.js': 'const s = "hello there"; // greet the reader\nexport const f = x => /x+/.test(x) ? s : x / 2;\n', 'tools/test-a.mjs': 'assert(1);\nassert(2);\nassert(3);\n' });
  const t1 = await facts(base, c1); assert(t1.trivial, t1.reasons.join('; ')); assert.match(t1.reasons[0], /trivial: \d+ changed line/);
  // The line limit binds the whole release, however it is split into commits.
  const c2 = commit('more prose', { 'README.md': lines(5) + 'More words.\n' + lines(12) });
  const c3 = commit('and more', { 'README.md': lines(5) + 'More words.\n' + lines(25) });
  assert((await facts(c2, c3)).trivial); assert((await facts(c1, c2)).trivial);
  const split = await facts(c1, c3); assert(!split.trivial); assert.match(split.reasons.join(), /changed lines \(the limit is 20\)/);
  const nt = async (files, re) => { const before = git('rev-parse', 'HEAD'), after = commit('x', files), r = await facts(before, after); assert(!r.trivial, `expected non-trivial: ${JSON.stringify(files)}`); assert.match(r.reasons.join('; '), re); };
  await nt({ 'public/a.js': 'const s = "hello there"; // greet the reader\nexport const f = x => /x+/.test(x) ? s : x / 3;\n' }, /public\/a\.js: code changed/);
  await nt({ 'public/b.js': '{}\n/x/.test(b) // note\n' }, /could not be tokenized safely/);
  await nt({ 'server.js': 'const a = 1; // a comment\n' }, /server\.js is protected \(server\.js\)/);
  await nt({ 'tools/test-a.mjs': 'assert(1);\nassert(3);\n' }, /test file lost 1 line/);
  await nt({ 'governance/protected.json': '{"x":1}\n' }, /governance\/protected\.json is protected/);
  await nt({ 'notes.txt': 'm\n' }, /not on the allowlist/);
  await nt({ 'residents.json': '[]\n' }, /residents\.json is protected/);
  await nt({ 'public/new.js': 'import x from "https://example.com/x.js";\n' }, /public\/new\.js: code changed/);

  // ---------- the flow, in a world ----------
  const config = [{ name: 'Themis', rank: 'priest', agent: 'claude', model: 'claude-opus-5-5' }, { name: 'Lyra', role: 'smith', agent: 'claude', model: 'claude-haiku-5-5' }, { name: 'Atlas', agent: 'codex', model: 'gpt-5' }];
  w = new World(dir, config, path.join(dir, 'residents.json'));
  const c = Object.assign(Object.create(Conductor.prototype), { world: w, queue: [], pendingDuties: [], running: new Map(), turn: null, lastEnd: Date.now(), rr: 0 });
  c.tick = () => {}; c.run = () => { throw new Error('no model runs in tests'); }; w.conductor = c;
  const sent = []; w.governance.transport = async (wk, o, msg) => { sent.push(msg); return '{}'; };
  const hero = { id: 'local:h1', sessionId: 'h1', host: 'local', path: repo, project: 'proj', title: 'Hero', tool: 'claude', zone: 'village', status: 'running', site: 'forge' };
  const steward = { ...hero, id: 'local:st', sessionId: 'st', title: 'Steward' };
  w.workers.push(hero, steward); w.s.stewardHero = { workerId: steward.id, node: null, sessionId: 'st' };
  const G = w.governance, api = (route, b, actor = 'steward') => G.api(route, b, actor);
  const offer = async (by, sha, ev) => { const o = await w.temple.offer(by.id, 'note', sha, ev); await tick(); return o; };

  // No baseline yet: the first release waits for a ruling. Only the human sets a baseline.
  const first = await offer(hero, git('rev-parse', 'HEAD'));
  assert.equal(first.gov.state, 'pending'); assert.match(first.gov.reasons[0], /no approved baseline/);
  assert.throws(() => api('baseline', { workerId: hero.id, sha: c3, reason: 'deployed by hand' }), /Only the human/);
  api('baseline', { workerId: hero.id, sha: c3, reason: 'what is deployed today' }, 'human');
  assert.equal(G.g.approved['proj@local'].sha, c3);

  // A trivial release ships at once: skip logged, approval advanced, the hero told, a receipt allowed.
  const head0 = git('rev-parse', 'HEAD');
  const triv = commit('docs', { 'README.md': fs.readFileSync(path.join(repo, 'README.md'), 'utf8') + 'One more line.\n' });
  api('baseline', { workerId: hero.id, sha: head0, reason: 'reset to the tip for this test' }, 'human');
  const ot = await offer(hero, triv.slice(0, 12), { report: 'Docs only.', tests: [{ command: 'node tools/test-a.mjs', result: 'ok', commit: triv, by: 'Hero', at: '2026-10-28T10:00:00Z' }] });
  assert.equal(ot.gov.state, 'trivial'); assert.equal(G.g.approved['proj@local'].sha, triv);
  assert.equal(ot.status, 'closed'); assert.equal(ot.closedBy.state, 'trivial'); // closed at classification, no human step
  assert(G.g.ledger.some(e => e.kind === 'skip' && e.sha === triv && /trivial/.test(e.reason)));
  assert(sent.some(m => m.includes(`Commit: ${triv}`) && /ACCEPTED, by the mechanical trivial check/.test(m)));
  assert.equal(ot.gov.tests[0].at, Date.parse('2026-10-28T10:00:00Z'));
  await assert.rejects(w.temple.offer(hero.id, '', triv, { tests: [{ command: 'x' }] }), /test result/);
  const r1 = api('receipt', { sha: triv.slice(0, 10), note: 'deployed' }).receipt;
  assert.equal(r1.kind, 'receipt'); assert.equal(r1.sha, triv); assert.equal(G.g.deployed['proj@local'].sha, triv);

  // A code release waits; receipts are refused until it is accepted.
  const code = commit('code', { 'public/a.js': 'export const f = x => x * 3;\n' });
  const oc = await offer(hero, code, { report: 'Changes f.' });
  assert.equal(oc.gov.state, 'pending'); assert.equal(oc.gov.base, triv); assert.match(oc.gov.reasons.join(), /code changed/);
  assert.throws(() => api('receipt', { sha: code }), /no acceptance/);
  assert.throws(() => api('receipt', { sha: 'deadbeef' }), /no acceptance/);
  // The reserved wake: one duty, for Themis herself.
  assert.equal(c.pendingDuties.filter(d => d.offeringIds?.includes(oc.id)).length, 1);
  const duty = c.pendingDuties.find(d => d.offeringIds?.includes(oc.id)); assert.equal(duty.resident, 'Themis'); assert.equal(G.wakesUsed(), 1, 'it joined the wake still waiting for the first release (v0.64)'); assert(duty.offeringIds.includes(first.id));
  c.dispatchDuties(); assert.equal(c.queue.find(j => j.duty === duty)?.name, 'Themis'); assert(!c.queue.find(j => j.duty === duty).standIn);
  c.queue.length = 0; c.pendingDuties.length = 0;
  // Her context and tools: pending items, missing evidence, the skips to audit, the ledger.
  const look = createMcpHandler(w).lookFor('Themis');
  assert.match(look, /Temple governance/); assert.match(look, new RegExp(`${oc.id}.*awaiting your ruling`)); assert.match(look, /Test evidence: MISSING/); assert.match(look, /Trivial skips to audit/);
  assert(!createMcpHandler(w).lookFor('Atlas').includes('Temple governance'));
  const ex = w.temple.examine('Themis', oc.id); assert.match(ex, /release diff/); assert.match(ex, /<untrusted-report>/); assert.match(ex, /Test evidence: MISSING/);
  const mcp = createMcpHandler(w), token = 'tok_' + 'x'.repeat(30); w.beginTurn('Themis', token, { kind: 'duty' });
  const rpc = (name, args) => new Promise(resolve => mcp({ method: 'POST' }, { writeHead() {}, end: s => resolve(JSON.parse(s)) }, JSON.stringify({ jsonrpc: '2.0', id: 1, method: name ? 'tools/call' : 'tools/list', params: name ? { name, arguments: args } : {} }), token));
  assert((await rpc()).result.tools.some(t => t.name === 'rule_offering'));
  assert.match((await rpc('rule_offering', { id: oc.id, commit: triv, verdict: 'accept', reason: 'looks right to me' })).result.content[0].text, /binds to one commit/);
  assert.match((await rpc('rule_offering', { id: oc.id, commit: code.slice(0, 9), verdict: 'evidence', reason: 'run the tests at this commit' })).result.content[0].text, /evidence/);
  assert.equal(oc.gov.state, 'evidence'); assert(sent.at(-1).includes('PENDING: EVIDENCE REQUESTED'));
  assert.notEqual(oc.status, 'closed', 'a request for evidence leaves the offering open');
  assert.equal(G.digest().find(d => d.offeringId === oc.id)?.escalation, false, 'routine: not for Needs you');
  assert.throws(() => G.rule('Themis', { id: oc.id, commit: code, verdict: 'accept', reason: 'no longer pending' }), /not awaiting your ruling/);
  api('evidence', { offeringId: oc.id, tests: [{ command: 'node --test', result: '12 passed', commit: code, by: 'Hero' }] });
  assert.equal(oc.gov.state, 'pending');
  assert.match((await rpc('rule_offering', { id: oc.id, commit: code, verdict: 'reject', reason: 'f loses the regex check', concern: 'none' })).result.content[0].text, /rejected/);
  w.endTurn?.('Themis', [...w.turns.values()].find(t => t.token === token)?.id);
  assert.equal(oc.gov.state, 'rejected'); assert.equal(oc.status, 'closed'); assert.deepEqual([oc.closedBy.by, oc.closedBy.state, oc.closedBy.sha], ['Themis', 'rejected', code]);
  assert.equal(G.digest().find(d => d.offeringId === oc.id)?.escalation, false, 'the Steward can still act on a plain rejection');
  // The Steward may override heroes' work with a recorded reason; a short reason is refused.
  assert.throws(() => api('override', { offeringId: oc.id, verdict: 'accept', reason: 'ok' }), /reason/);
  api('override', { offeringId: oc.id, verdict: 'accept', reason: 'the check moved to the caller, see report' });
  assert.equal(oc.gov.state, 'accepted'); assert.equal(G.g.approved['proj@local'].sha, code);
  assert(G.g.ledger.some(e => e.kind === 'override' && e.actor === 'steward' && e.offeringId === oc.id));
  const r2 = api('receipt', { sha: code }).receipt;
  // Rollback cites a receipt; only once; unknown receipts are refused.
  assert.throws(() => api('revert', { receiptId: 'rc999', reason: 'broke the map entirely' }), /cite a receipt/);
  api('revert', { receiptId: r2.id, reason: 'broke the map entirely' });
  assert.equal(G.g.deployed['proj@local'].sha, triv);
  assert.throws(() => api('revert', { receiptId: r2.id, reason: 'broke the map entirely' }), /already been reverted/);

  // Security and data-loss decrees bind the Steward; only the human may override them (and that is final).
  const sec = commit('sec', { 'public/a.js': 'export const f = x => eval(x);\n' });
  const os1 = await offer(hero, sec);
  G.rule('Themis', { id: os1.id, commit: sec, verdict: 'reject', reason: 'eval of untrusted input', concern: 'security' });
  assert.throws(() => api('override', { offeringId: os1.id, verdict: 'accept', reason: 'it is fine really, trust me' }), /security decree cannot be overridden/);
  assert.match(G.digest().map(d => d.text).join(), /Not accepted by Themis \(security\)/);
  assert.equal(G.digest().find(d => d.offeringId === os1.id).escalation, true, 'a security decree needs the human');
  api('override', { offeringId: os1.id, verdict: 'reject', reason: 'agreed, keep it out of the release' }, 'human');
  assert(os1.gov.final); assert.throws(() => api('override', { offeringId: os1.id, verdict: 'accept', reason: 'trying again after all' }), /final/);

  // The Steward's own code: only the human may override its ruling.
  const own = commit('own', { 'public/a.js': 'export const f = x => x * 4;\n' });
  const oo = await offer(steward, own);
  assert(oo.gov.stewardOwn);
  G.rule('Themis', { id: oo.id, commit: own, verdict: 'reject', reason: 'needs a test for the new factor' });
  assert.throws(() => api('override', { offeringId: oo.id, verdict: 'accept', reason: 'my own change, I vouch for it' }), /only the human/);
  assert.match(G.digest().map(d => d.text).join(), /Steward's own change/);
  assert.equal(G.digest().find(d => d.offeringId === oo.id).escalation, true, "the Steward's own code needs the human");
  assert.equal(oo.status, 'closed');

  // One appeal per ruling, with new evidence, to an independent reviewer of another provider; then only the human.
  assert.throws(() => api('appeal', { offeringId: oo.id, reason: 'please look again at this' }), /new evidence/);
  const ap = api('appeal', { offeringId: oo.id, reason: 'a test now covers the factor', tests: [{ command: 'node tools/test-a.mjs', result: 'ok', commit: own, by: 'Steward' }] });
  assert.equal(ap.reviewer, 'Atlas'); assert.equal(oo.gov.state, 'appealed'); assert.notEqual(oo.status, 'closed', 'an appeal reopens it');
  assert.throws(() => api('appeal', { offeringId: oo.id, reason: 'again with more', report: 'more words' }), /standing rejection|already been appealed/);
  assert.equal(c.pendingDuties.filter(d => d.offeringIds?.includes(oo.id)).at(-1)?.resident, 'Atlas');
  assert.throws(() => G.rule('Themis', { id: oo.id, commit: own, verdict: 'accept', reason: 'changed my mind' }), /not awaiting your ruling/);
  assert(createMcpHandler(w).lookFor('Atlas').includes('APPEAL assigned to you'));
  assert.throws(() => G.rule('Atlas', { id: oo.id, commit: own, verdict: 'evidence', reason: 'more please' }), /accept or reject/);
  G.rule('Atlas', { id: oo.id, commit: own, verdict: 'reject', reason: 'the test does not exercise the factor' });
  assert.throws(() => api('appeal', { offeringId: oo.id, reason: 'one more time please', report: 'new report text' }), /cannot be appealed again/);
  assert.match(G.digest().map(d => d.text).join(), /only you can override it/);
  assert.equal(oo.status, 'closed'); assert(G.digest().filter(d => d.offeringId === oo.id).every(d => d.escalation));
  api('override', { offeringId: oo.id, verdict: 'accept', reason: 'I read it; ship it' }, 'human');
  assert.equal(oo.gov.state, 'accepted'); assert(oo.gov.final);

  // A skip found misclassified is an override: back to pending, approval withdrawn to the one before.
  const before = G.g.approved['proj@local'].sha;
  const tr2 = commit('docs2', { 'README.md': fs.readFileSync(path.join(repo, 'README.md'), 'utf8') + 'Another line.\n' });
  const o2 = await offer(hero, tr2); assert.equal(o2.gov.state, 'trivial'); assert.equal(G.g.approved['proj@local'].sha, tr2);
  api('override', { offeringId: o2.id, verdict: 'misclassified', reason: 'the README change alters setup steps' });
  assert.equal(o2.gov.state, 'pending'); assert.equal(G.g.approved['proj@local'].sha, before); assert.notEqual(o2.status, 'closed', 'a misclassified skip reopens');
  assert(G.g.ledger.some(e => e.kind === 'override' && e.what === 'misclassified'));
  assert.throws(() => api('receipt', { sha: tr2 }), /no acceptance/);

  // ---------- reserved wakes respect every gate ----------
  c.pendingDuties.length = 0; c.queue.length = 0;
  const wakeFor = () => { o2.gov.wokeAt = 0; G.pump(); return c.pendingDuties.some(d => d.offeringIds?.includes(o2.id)); };
  assert.throws(() => api('settings', { wakeBudget: 3 }, 'human'), /unknown|not/i, 'no daily cap to set (v0.64)');
  w.setHibernate('Themis', true); assert(!wakeFor(), 'hibernating'); w.setHibernate('Themis', false);
  w.usage.limits = { providers: [{ id: 'claude', windows: [{ used_percentage: 96 }] }] }; assert(!wakeFor(), 'provider pressure'); w.usage.limits = { providers: [] };
  w.isHibernating('Themis');
  const used = G.wakesUsed(); assert(wakeFor()); assert.equal(G.wakesUsed(), used + 1);
  wakeFor(); assert.equal(G.wakesUsed(), used + 1, 'a wake not yet run is not doubled'); assert.equal(c.pendingDuties.filter(d => d.offeringIds?.includes(o2.id)).length, 1);
  // No daily cap: many wakes in a day still wake her, each only while something waits.
  for (let i = 0; i < 30; i++) { c.pendingDuties.length = 0; assert(wakeFor(), `wake ${i}`); } assert.equal(G.wakesUsed(), used + 31);
  assert.equal(o2.gov.state, 'pending');
  G.rule('Themis', { id: o2.id, commit: tr2, verdict: 'accept', reason: 'fine after all, setup unchanged' });
  c.dispatchDuties(); assert(!c.queue.some(j => j.duty?.offeringIds?.includes(o2.id))); assert(!c.pendingDuties.some(d => d.offeringIds?.includes(o2.id)));

  assert.equal(o2.status, 'closed');
  // The High Priest's own "misclassified" spends no reserved wake: she is awake and rules in this turn (v0.60).
  c.pendingDuties.length = 0; c.queue.length = 0;
  const tr3 = commit('docs3', { 'README.md': fs.readFileSync(path.join(repo, 'README.md'), 'utf8') + 'Yet another line.\n' });
  const o3 = await offer(hero, tr3); assert.equal(o3.gov.state, 'trivial'); assert(G.canWake('Themis'));
  const woke = G.wakesUsed(); G.rule('Themis', { id: o3.id, commit: tr3, verdict: 'misclassified', reason: 'it changes the setup steps' });
  assert.equal(o3.gov.state, 'pending'); assert.equal(G.wakesUsed(), woke, 'no reserved wake spent'); assert(!c.pendingDuties.some(d => d.offeringIds?.includes(o3.id)), 'no second wake queued');
  G.rule('Themis', { id: o3.id, commit: tr3, verdict: 'accept', reason: 'setup steps unchanged after all' });
  // One wake covers every offering waiting for her (v0.64): a later offering joins the wake not yet run, and a fresh wake
  // lists them all; with nothing waiting, nothing wakes her.
  c.pendingDuties.length = 0; c.queue.length = 0; G.pump(); assert.equal(c.pendingDuties.length, 0, 'nothing waiting, no wake');
  const b0 = G.wakesUsed(), ob1 = await offer(hero, commit('batch1', { 'public/a.js': 'export const f = x => x * 41;\n' })), ob2 = await offer(hero, commit('batch2', { 'public/a.js': 'export const f = x => x * 42;\n' }));
  const mine = () => G.rulableBy('Themis').map(o => o.id).sort();
  assert.equal(c.pendingDuties.length, 1); assert.equal(G.wakesUsed(), b0 + 1, 'one wake for both'); assert(c.pendingDuties[0].offeringIds.includes(ob2.id)); assert.match(c.pendingDuties[0].reason, new RegExp(ob2.id + '\\b'), 'the newcomer is named (fi4162)');
  c.dispatchDuties(); const ob3 = await offer(hero, commit('batch3', { 'public/a.js': 'export const f = x => x * 43;\n' })), qj = c.queue.find(j => j.duty?.offeringIds?.includes(ob3.id));
  assert(qj, 'joins the queued wake'); assert.match(qj.reasons[0], new RegExp(ob3.id + '\\b')); assert.equal(qj.reasons[0], qj.duty.reason); assert.equal(G.wakesUsed(), b0 + 1);
  if (mine().length > 1) { c.pendingDuties.length = 0; c.queue.length = 0; for (const o of G.offerings()) o.gov.wokeAt = 0; G.pump(); assert.equal(c.pendingDuties.length, 1); assert.deepEqual([...c.pendingDuties[0].offeringIds].sort(), mine()); assert.match(c.pendingDuties[0].reason, /offerings await your ruling/); }
  for (const o of [ob1, ob2, ob3]) if (!o.gov.final && o.gov.state === 'pending') G.rule('Themis', { id: o.id, commit: o.gov.sha, verdict: 'accept', reason: 'synthetic batch release' });
  c.dispatchDuties(); assert.deepEqual(mine(), [first.id]); assert.equal(c.pendingDuties.length + c.queue.filter(j => j.duty?.offeringIds).length, 1, 'kept while the first release still waits');
  G.rule('Themis', { id: first.id, commit: first.gov.sha, verdict: 'accept', reason: 'synthetic first release' });
  const queued = [...c.pendingDuties, ...c.queue.map(j => j.duty)].filter(d => d?.offeringIds); assert.equal(queued.length, 1); assert(!queued[0].offeringIds.some(id => G.stillWanted(id, 'Themis')), 'all ruled: the conductor drops the wake');
  G.pump(); assert.equal(c.pendingDuties.length, 0, 'nothing left waiting, no wake');
  // An appeal whose reviewer is disabled or leaves the village passes to another independent reviewer (v0.60).
  const code3 = commit('code3', { 'public/a.js': 'export const f = x => x * 6;\n' }), oa = await offer(hero, code3);
  G.rule('Themis', { id: oa.id, commit: code3, verdict: 'reject', reason: 'needs a test for the factor' });
  assert.equal(api('appeal', { offeringId: oa.id, reason: 'a test now covers the factor', tests: [{ command: 'node t.mjs', result: 'ok', commit: code3, by: 'Hero' }] }).reviewer, 'Atlas');
  w.s.residents.Atlas.enabled = false; G.pump();
  assert.equal(oa.gov.appeals.at(-1).reviewer, 'Lyra', 'handed on'); assert(c.pendingDuties.some(d => d.offeringIds?.includes(oa.id) && d.resident === 'Lyra'), 'the new reviewer is woken');
  assert.throws(() => G.rule('Atlas', { id: oa.id, commit: code3, verdict: 'accept', reason: 'I was assigned first' }), /not awaiting your ruling/);
  w.s.residents.Lyra.enabled = false; G.pump();
  assert.equal(oa.gov.appeals.at(-1).reviewer, null, 'nobody independent is left: it waits'); assert.match(G.digest().map(d => d.text).join(), /waits for a reviewer/);
  w.s.residents.Atlas.enabled = true; w.s.residents.Lyra.enabled = true; G.pump();
  assert.equal(oa.gov.appeals.at(-1).reviewer, 'Atlas');
  G.rule('Atlas', { id: oa.id, commit: code3, verdict: 'reject', reason: 'the test does not exercise the factor' });
  c.pendingDuties.length = 0; c.queue.length = 0;
  // The human's close stays available on an open offering.
  const oh = await offer(hero, commit('code2', { 'public/a.js': 'export const f = x => x * 42;\n' }));
  assert.notEqual(oh.status, 'closed'); w.temple.close(oh.id); assert.equal(oh.status, 'closed');

  // ---------- fixes confirmed without the human ----------
  const delivered = []; w.temple.deliver = async f => { delivered.push(f.id); }; // no agent-deck send in tests
  const finding = (id, extra) => { const f = { id, offeringId: oc.id, zone: 'village', project: 'proj', host: 'local', status: 'decreed', reviewer: 'Atlas', seconds: [], disputes: [], file: 'public/a.js', line: 1, claim: 'f drops the check', severity: 'major', ...extra }; w.s.findings.push(f); return f; };
  const f1 = finding('fx1', { verdict: { by: 'Themis', verdict: 'implement', concern: 'security', reasoning: 'x', ts: 1 } });
  c.pendingDuties.length = 0; w.temple.reportFixed(f1.id);
  assert.match(w.temple.fixCheck('Lyra', { findingId: f1.id, verdict: 'holds', note: 'the check is back' }), /High Priest will confirm/);
  assert.equal(f1.status, 'awaiting_confirmation', 'the smith alone never closes it, least of all a security finding');
  const confirm = c.pendingDuties.find(d => d.key === 'confirm:fx1'); assert(confirm && confirm.role === 'priest' && confirm.confirm);
  assert.throws(() => w.temple.confirmFix('Lyra', { id: f1.id, verdict: 'fixed', reason: 'mine' }), /Only the High Priest/);
  assert.throws(() => w.temple.confirmFix('Themis', { id: f1.id, verdict: 'maybe', reason: 'hmm' }), /verdict/);
  assert(createMcpHandler(w).lookFor('Themis').includes('awaiting your confirm_fix'));
  assert.match(w.temple.confirmFix('Themis', { id: f1.id, verdict: 'fixed', reason: 'read the fix; the check is restored' }), /fixed/);
  assert.equal(f1.status, 'fixed'); assert.equal(f1.fixedBy, 'Themis');
  assert(G.g.ledger.some(e => e.kind === 'fix confirmed' && e.findingId === 'fx1' && e.actor === 'Themis'));
  c.dispatchDuties(); assert(!c.pendingDuties.some(d => d.key === 'confirm:fx1') && !c.queue.some(j => j.duty?.key === 'confirm:fx1'), 'a settled confirmation is dropped');
  // Partial or not holding: back to decreed and carried to the hero again.
  const f2 = finding('fx2'); w.temple.reportFixed(f2.id);
  w.temple.fixCheck('Lyra', { findingId: f2.id, verdict: 'partial', note: 'only one caller fixed' });
  assert.equal(f2.status, 'decreed'); assert.equal(f2.returned.verdict, 'partial'); assert(delivered.includes('fx2'));
  assert(G.g.ledger.some(e => e.kind === 'fix returned' && e.findingId === 'fx2' && e.verdict === 'partial'));
  // The priest may also send a holding fix back; the human's confirmation stays available.
  w.temple.reportFixed(f2.id); w.temple.fixCheck('Lyra', { findingId: f2.id, verdict: 'holds', note: 'now both callers' });
  w.temple.confirmFix('Themis', { id: f2.id, verdict: 'not_fixed', reason: 'a third caller remains' }); assert.equal(f2.status, 'decreed');
  w.temple.setStatus(f2.id, 'fixed'); assert.equal(f2.status, 'fixed'); assert(G.g.ledger.some(e => e.kind === 'fix confirmed' && e.findingId === 'fx2' && e.actor === 'human'));
  // She cannot confirm a fix to her own finding.
  const f3 = finding('fx3', { reviewer: 'Themis' }); w.temple.reportFixed(f3.id); w.temple.fixCheck('Lyra', { findingId: f3.id, verdict: 'holds', note: 'fine' });
  assert.throws(() => w.temple.confirmFix('Themis', { id: f3.id, verdict: 'fixed', reason: 'mine is fixed' }), /cannot confirm/);
  // fix_check counts against the turn's action limit like every other Temple verdict (v0.60).
  const lt = 'tok_' + 'l'.repeat(30); w.beginTurn('Lyra', lt, { kind: 'duty' });
  const fixCall = args => new Promise(resolve => mcp({ method: 'POST' }, { writeHead() {}, end: s => resolve(JSON.parse(s)) }, JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'fix_check', arguments: args } }), lt));
  const fixOuts = []; for (let i = 0; i < 9; i++) fixOuts.push(JSON.stringify(await fixCall({ findingId: f3.id, verdict: 'holds', note: 'still holds' })));
  assert.match(fixOuts[7], /High Priest will confirm/); assert.match(fixOuts[8], /done plenty this turn/);
  // The page: Needs you holds only escalations and waiting heroes.
  const panel = fs.readFileSync(new URL('../public/panel.js', import.meta.url), 'utf8');
  assert(panel.includes("'Nothing needs you'") && panel.includes('.filter((d) => d && d.escalation)'));

  // ---------- the ledger: append-only, verifiable, village only ----------
  assert(G.verify());
  const seqs = G.g.ledger.map(e => e.seq); assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b));
  const victim = G.g.ledger.find(e => e.kind === 'override'), was = victim.reason; victim.reason = 'rewritten'; assert(!G.verify()); victim.reason = was; assert(G.verify());
  const gone = G.g.ledger.splice(2, 1); assert(!G.verify()); G.g.ledger.splice(2, 0, ...gone); assert(G.verify());
  // Isle offerings keep today's behaviour: no governance, nothing in the ledger.
  const isleHero = { ...hero, id: 'local:i1', sessionId: 'i1', zone: 'isle', title: 'Isle hero', project: 'secretproj' };
  w.workers.push(isleHero);
  const count = G.g.ledger.length, oi = await offer(isleHero, own);
  assert.equal(oi.gov, undefined); assert.equal(G.g.ledger.length, count);
  assert(!JSON.stringify(w.snapshot({ human: true }).governance).includes('secretproj'));
  // Human snapshot carries the digest and ledger; residents' snapshot does not; the report text never rides along.
  const snap = w.snapshot({ human: true });
  assert(snap.governance.ledger.length && snap.governance.verified && Array.isArray(snap.governance.digest));
  assert(!('governance' in w.snapshot()));
  assert(!JSON.stringify(snap.offerings).includes('Docs only.')); assert.equal(snap.offerings.find(o => o.id === ot.id).gov.reportChars, 10);
  // Quarantining the project redacts its entries (the chain still verifies) and forgets its approvals.
  w.setQuarantine('proj', 'local', true);
  assert(G.verify()); assert(G.g.ledger.every(e => e.redacted || e.key !== 'proj@local'));
  assert(!JSON.stringify(G.g).includes('proj@local')); assert(!JSON.stringify(G.g.ledger).includes('the check moved'));
  assert.equal(G.offerings().length, 0); assert.throws(() => api('receipt', { sha: triv }), /no acceptance/);
  // Appending after a redaction still chains.
  G.append({ kind: 'note', actor: 'test' }); assert(G.verify());
  console.log('governance ok: classifier, release line limit, rulings, closing, receipts, overrides, appeals, wakes, fix confirmation, escalations, ledger');
} finally { if (w) { clearTimeout(w.saveTimer); clearInterval(w.seal.timer); } fs.rmSync(dir, { recursive: true, force: true }); }
