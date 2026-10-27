import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { World } from '../lib/world.js';
import { Usage } from '../lib/usage.js';
import { Conductor } from '../lib/conductor.js';
import { createMcpHandler } from '../lib/mcp.js';
import { parseOrder } from './amygdala-order.mjs';
Usage.prototype.pollDeck = () => {}; Usage.prototype.probe = () => {};
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amygdala-parallel-'));
const settle = () => new Promise(resolve => setImmediate(resolve));
let w, c;
try {
  const config = ['Quill', 'Other', 'Third', 'Sleeping', 'Disabled', 'Away'].map(name => ({ name, agent: 'claude', model: 'claude-test', enabled: name !== 'Disabled' }));
  w = new World(dir, config, path.join(dir, 'roster.json')); w.s.residents.Sleeping.hibernate = true;
  // Synthetic zone fixture; no real isle records are loaded.
  w.s.residents.Away.zone = 'isle';
  const a = w.beginTurn('Quill', 'a'), b = w.beginTurn('Other', 'b');
  assert.equal(w.activeTurn.id, a.id); assert.equal(w.activeTurns.length, 2);
  assert.throws(() => { w.activeTurn = null; }, TypeError);
  w.endTurn('Quill', a.id); assert.equal(w.activeTurn.id, b.id); w.endTurn('Other', b.id); assert.equal(w.activeTurn, null);
  const g = w.orders.create({ to: 'all', headline: 'Inspect the village', brief: 'PRIVATE BROADCAST' });
  assert.deepEqual(g.members.map(o => o.to), ['Quill', 'Other', 'Third']);
  assert.equal(new Set(g.members.map(o => o.postId)).size, 1); assert.equal(w.s.posts.filter(p => p.group === g.id).length, 1);
  assert.equal(w.s.feed.filter(f => f.group === g.id).length, 1); assert.match(w.s.posts.at(-1).text, /The Steward calls the whole village: Inspect/);
  const wait = w.orders.waitGroup(g.id, 2); let resolved = false; wait.then(() => { resolved = true; });
  w.orders.cancel(g.members[0].id); await settle(); assert.equal(resolved, false);
  for (const o of g.members.slice(1)) w.orders.cancel(o.id); assert.equal((await wait).members.length, 3);
  assert.equal((await w.orders.waitGroup(g.id)).status, 'cancelled');
  const queued = [];
  for (const to of ['Quill', 'Quill', 'Quill', 'Quill', 'Other', 'Third']) queued.push(w.orders.create({ to, brief: 'PRIVATE WORK' }));
  const releases = new Map();
  c = Object.assign(Object.create(Conductor.prototype), { world: w, running: new Map(), queue: [], pendingDuties: [], maxTurns: 4, maxPerResident: 3, rr: 0, lastEnd: Date.now(), homes: path.join(dir, 'homes'), logs: path.join(dir, 'logs'),
    runner: (r, { turn, prompt }) => { assert(prompt.includes('PRIVATE WORK')); return new Promise(resolve => releases.set(turn.id, resolve)); } });
  fs.mkdirSync(c.logs); w.conductor = c;
  const mcp = createMcpHandler(w);
  const rpc = (token, name, args) => new Promise(resolve => mcp({ method: 'POST' }, { writeHead() {}, end(s) { resolve(JSON.parse(s).result); } }, JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }), token));
  // Any Claude window blocks even a different model-specific pool; queued orders stay queued.
  w.usage.limits = { providers: [{ id: 'claude', windows: [{ kind: 'seven_day_fable', used_percentage: 95 }] }] };
  c.tick(); assert.equal(w.activeTurns.length, 0); assert(queued.every(o => o.status === 'queued'));
  w.usage.limits.providers = []; const offTick = w.onChange(() => c.tick()); c.tick(); c.tick(); offTick(); await settle();
  assert.equal(w.activeTurns.length, 4); assert.equal(w.activeTurns.filter(t => t.resident === 'Quill').length, 3);
  assert.equal(queued[3].status, 'queued'); assert.equal(queued[5].status, 'queued');
  const turns = [...w.turns.values()], q = turns.filter(t => t.resident === 'Quill');
  assert((await rpc(q[0].token, 'answer_order', { id: q[1].orderId, chat: 'wrong', report: 'wrong' })).isError);
  assert.equal(w.orders.get(q[1].orderId).status, 'working');
  const answer = t => rpc(t.token, 'answer_order', { id: t.orderId, chat: 'Done', report: 'PRIVATE REPORT', data: { ok: true } });
  assert(!(await answer(q[0])).isError);
  const human = w.snapshot({ human: true }), visitor = w.snapshot();
  assert.equal(human.residents.find(r => r.name === 'Quill').parallel.length, 2); assert.equal(human.world.activeTurns.length, 4);
  assert(!('activeTurns' in visitor.world)); assert(visitor.residents.every(r => !('parallel' in r))); assert(!('orders' in visitor));
  assert(!JSON.stringify(visitor).includes('PRIVATE')); assert(!JSON.stringify(human).includes('PRIVATE REPORT'));
  assert(!JSON.stringify(human.world).includes(q[0].token));
  // Each turn has its own post allowance and capability; revoking one leaves its sibling live.
  for (const t of q.slice(0, 2)) { assert(!(await rpc(t.token, 'post', { text: 'A short note.' })).isError); assert(!(await rpc(t.token, 'post', { text: 'Another note.' })).isError); assert((await rpc(t.token, 'post', { text: 'Too many.' })).isError); }
  const oldToken = q[0].token, racing = rpc(oldToken, 'set_status', { mood: 'wrong' }); w.revokeTurn(oldToken); assert((await racing).isError); assert((await rpc(oldToken, 'set_status', { mood: 'wrong' })).isError); assert(!(await rpc(q[1].token, 'set_status', { mood: 'calm' })).isError);
  c.queue.push({ name: 'Third', human: true, reasons: ['Life wake'] }); c.tick(); assert.equal(c.queue.length, 1);
  releases.get(q[0].id)({}); await settle(); c.tick(); await settle();
  assert.equal(w.activeTurns.length, 4); assert.equal(queued[3].status, 'working'); assert.equal(c.queue.length, 1);
  // Answer and drain the remaining orders, then the ordinary wake can run.
  for (const t of [...w.turns.values()]) { if (w.orders.get(t.orderId).status === 'working') assert(!(await answer(t)).isError); releases.get(t.id)({}); }
  await settle(); c.tick(); await settle();
  assert.equal(w.activeTurns.length, 1); const last = [...w.turns.values()][0]; assert.equal(last.orderId, queued[5].id); assert(!(await answer(last)).isError); releases.get(last.id)({}); await settle();
  let life = 0; c.runner = async (r, { turn }) => { assert.equal(turn.kind, 'life'); life++; return {}; }; c.tick(); await settle(); assert.equal(life, 1); assert.equal(w.activeTurn, null);
  w.conductor = null;
  const pair = w.orders.create({ to: ['Other', 'Quill', 'Other'], brief: 'PRIVATE PAIR' }); assert.equal(pair.members.length, 2);
  // Wait disconnects release listeners without cancelling any order.
  const before = w.listeners.size, abort = new AbortController(), waiting = w.orders.waitGroup(pair.id, 2, abort.signal); abort.abort(); await waiting; assert.equal(w.listeners.size, before);
  const groupDone = w.orders.waitGroup(pair.id, 2);
  for (const o of pair.members) { const t = w.beginTurn(o.to, `pair-${o.id}`, { kind: 'order', orderId: o.id }); w.turnContext.run(t, () => w.orders.start(o.to, o.id)); assert(!(await answer(t)).isError); w.endTurn(o.to, t.id); }
  const reports = await groupDone; assert(reports.members.every(o => o.report === 'PRIVATE REPORT' && o.data.ok));
  const renamed = [1, 2].map(() => w.orders.create({ to: 'Quill', brief: 'Rename during work' }));
  const rt = renamed.map(o => w.beginTurn('Quill', `rename-${o.id}`, { kind: 'order', orderId: o.id }));
  for (const t of rt) w.turnContext.run(t, () => w.orders.start('Quill', t.orderId));
  w.requestNaming('Quill'); assert(!(await rpc(rt[0].token, 'choose_name', { name: 'Laurel', reason: 'A new name' })).isError);
  for (const t of rt) { assert.equal(t.resident, 'Laurel'); assert(!(await answer(t)).isError); w.endTurn('Laurel', t.id); }
  assert.deepEqual(parseOrder(['Quill,Other', '--brief-file', 'f']).to, ['Quill', 'Other']); assert.equal(parseOrder(['all', '--brief-file', 'f']).to, 'all');
  console.log('parallel: compatibility, fan-out, caps, usage guard, capabilities, life pause, group waits and redaction passed');
} finally {
  if (w) { clearTimeout(w.saveTimer); clearInterval(w.seal.timer); }
  fs.rmSync(dir, { recursive: true, force: true });
}
