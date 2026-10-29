// Node terminals without polling (v0.74): a held request answers at once on input, an open or a close, and never loses input.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Nodes } from '../lib/nodes.js';

let seq = 0; const w = { s: {}, workers: [], sites: { privateWorker: x => !!x.private }, id: () => `t${++seq}`, changed() {}, refreshWorkers() {}, usage: { mergeDeck() {} } };
const nodes = new Nodes(w), pass = nodes.auth(nodes.issue('Node A').token), other = nodes.auth(nodes.issue('Node B').token);
for (const p of [pass, other]) nodes.live.set(p.id, { at: Date.now(), deckAvailable: true });
w.workers.push({ id: 'node:a', node: pass.id, sessionId: 's1', zone: 'village' }, { id: 'node:b', node: pass.id, sessionId: 's2', zone: 'village' });
const wait = { output: [], wait: true }, settled = p => Promise.race([p.then(v => v), new Promise(r => setTimeout(() => r('held'), 30))]);

// Idle: the poll is held; an open answers it at once.
let held = nodes.termWait(pass, wait, { ms: 5000 }); assert.equal(await settled(held), 'held');
const a = nodes.openTerm('node:a'); a.on('close', () => {});
let r = await settled(held); assert.notEqual(r, 'held'); assert.equal(r.wait, true); assert.deepEqual(r.terms.map(t => [t.sessionId, t.open]), [['s1', true]]);
// Input answers a held poll, in order, and the next hold starts empty.
held = nodes.termWait(pass, wait, { ms: 5000 }); assert.equal(await settled(held), 'held');
a.stdin.write('{"t":"i","d":"YQ=="}\n'); a.stdin.write('{"t":"i","d":"Yg=="}\n');
r = await settled(held); assert.deepEqual(r.terms[0].input.map(JSON.parse).map(m => m.d), ['YQ==', 'Yg==']);
// Input that came between polls is answered without holding.
a.stdin.write('{"t":"i","d":"Yw=="}\n'); r = await settled(nodes.termWait(pass, wait, { ms: 5000 })); assert.equal(r.terms[0].input.length, 1);
// A held poll for one node is not answered by another node's input.
held = nodes.termWait(pass, wait, { ms: 5000 }); const otherHeld = nodes.termWait(other, wait, { ms: 5000 });
a.stdin.write('{"t":"i","d":"ZA=="}\n'); r = await settled(held); assert.equal(r.terms[0].input.length, 1); assert.equal(await settled(otherHeld), 'held');
// A superseded hold answers terms: null and takes no input: the newer one gets it.
held = nodes.termWait(pass, wait, { ms: 5000 }); const newer = nodes.termWait(pass, wait, { ms: 5000 });
assert.deepEqual(await settled(held), { terms: null, wait: true });
a.stdin.write('{"t":"i","d":"ZQ=="}\n'); r = await settled(newer); assert.equal(r.terms[0].input.length, 1);
// A hold whose request went away takes no input; the next poll still gets it.
const gone = new AbortController(); held = nodes.termWait(pass, wait, { ms: 5000, signal: gone.signal }); gone.abort();
assert.deepEqual(await settled(held), { terms: null, wait: true });
a.stdin.write('{"t":"i","d":"Zg=="}\n'); assert.equal(nodes.termPoll(pass, { output: [] }).terms[0].input.length, 1);
// An output-only post delivers output but neither takes input nor announces opens.
let out = ''; a.stdout.on('data', d => out += d);
const id = nodes.termPoll(pass, { output: [] }).terms[0].id, b = nodes.openTerm('node:b'); b.on('close', () => {});
a.stdin.write('{"t":"i","d":"Zw=="}\n');
assert.deepEqual(nodes.termPoll(pass, { output: [{ id, d: 'aA==' }], input: false }), { wait: true }); assert.equal(JSON.parse(out).d, 'aA==');
r = await settled(nodes.termWait(pass, wait, { ms: 5000 })); assert.equal(r.terms.find(t => t.id === id).input.length, 1); assert.equal(r.terms.find(t => t.id !== id).open, true);
// A close answers a held poll; the timeout answers anyway so privacy is re-checked; a private hero drops out.
held = nodes.termWait(pass, wait, { ms: 5000 }); b.kill(); r = await settled(held); assert.deepEqual(r.terms.map(t => t.id), [id]);
r = await nodes.termWait(pass, wait, { ms: 20 }); assert.deepEqual(r.terms.map(t => t.id), [id]);
w.workers[0].private = true; r = await settled(nodes.termWait(pass, wait, { ms: 5000 })); assert.deepEqual(r.terms, []); w.workers[0].private = false;
// A revoked pass rejects the held poll instead of throwing inside a timer.
held = nodes.termWait(pass, wait, { ms: 5000 }); nodes.revoke(pass.id);
await assert.rejects(Promise.race([held, new Promise((_, j) => setTimeout(() => j(new Error('still held')), 1000))]), /Invalid node pass/);
// Old nodes: a plain poll is unchanged apart from announcing that holds exist.
assert.deepEqual(Object.keys(nodes.termPoll(other, { output: [] })).sort(), ['terms', 'wait']);
const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8'), helper = fs.readFileSync(new URL('./amygdala-node.mjs', import.meta.url), 'utf8');
assert.match(server, /termWait\(pass, body, \{ signal: gone\.signal \}\)/);
assert.match(helper, /output: \[\], wait: true/); assert.match(helper, /held && \{ input: false \}/); assert.match(helper, /if \(!r\.wait\) \{ held = false; break; \}/);
console.log('term push ok');
