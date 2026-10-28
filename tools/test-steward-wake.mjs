import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { World } from '../lib/world.js';
import { Usage } from '../lib/usage.js';
import { Watch } from '../lib/watch.js';
import { LEGACY_FAILURE } from '../lib/nodes.js';
import { createMcpHandler } from '../lib/mcp.js';
import { executeJob, resumingElsewhere, stewardLive } from './amygdala-node.mjs';
// v0.41: the Watch wakes the Steward. No agent-deck, ps or model process runs here: the conductor, node and runners are stubs.
Usage.prototype.pollDeck = () => {}; Usage.prototype.probe = () => {};
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amygdala-steward-wake-'));
const tick = () => new Promise(r => setImmediate(r));
let w;
try {
  const config = [{ name: 'Ione', agent: 'claude', model: 'haiku', role: 'watch', persona: 'p' }, { name: 'Cody', agent: 'codex', model: 'gpt-5', persona: 'p' }];
  const file = path.join(dir, 'residents.json'); fs.writeFileSync(file, JSON.stringify(config));
  w = new World(dir, config, file);
  const duties = []; w.watch = new Watch(w, { duty: (...a) => { duties.push(a); return true; }, running: new Map() }, dir, { start: false });
  const n = w.nodes, p = n.auth(n.issue('Test PC', 24).token);
  const base = { title: 'Steward', project: 'amygdala', path: '/home/test/amygdala', group: '', tool: 'claude' };
  const steward = { id: 'st-1', status: 'running', ...base }, codex = { id: 'cx-1', status: 'error', ...base, title: 'Other', tool: 'codex' }, isle = { id: 'is-1', status: 'error', ...base, title: 'Secret', group: 'isle' };
  const report = (sessions, results = [], extra = {}) => { if (n.live.get(p.id)) n.live.get(p.id).at -= 2000; return n.report(p, { hostname: 'test', os: 'linux', deckAvailable: true, sessions, results, ...extra }); };
  report([steward, codex, isle]);
  const sid = `node:${p.id}:st-1`;

  // The setting: only a village, non-private Claude node hero; null clears it.
  assert.throws(() => w.watch.setStewardHero('nope'), /not private/);
  assert.throws(() => w.watch.setStewardHero(42), /not private/);
  assert.throws(() => w.watch.setStewardHero(`node:${p.id}:cx-1`), /Claude/);
  assert.throws(() => w.watch.setStewardHero(`node:${p.id}:is-1`), /not private/);
  w.workers.push({ id: 'local:x', zone: 'village', tool: 'claude', host: 'local', sessionId: 'x', status: 'error' });
  assert.throws(() => w.watch.setStewardHero('local:x'), /not private/);
  w.workers.pop();
  assert.deepEqual(w.watch.setStewardHero(sid), { stewardHero: { workerId: sid, node: p.id, sessionId: 'st-1' } });
  assert.deepEqual(w.snapshot({ human: true }).stewardHero, w.s.stewardHero); assert.equal(w.snapshot().stewardHero, undefined);
  assert.deepEqual(w.watch.setStewardHero(null), { stewardHero: null }); w.watch.setStewardHero(sid);
  assert.equal(report([steward, codex, isle]).steward, 'st-1');

  // Detection: two minutes of error while the node reports, raised once, generic text only.
  const t0 = Date.now(), pending = () => w.watch.state.pending.filter(e => e.key === 'steward-down:steward');
  w.watch.scan(t0); assert.equal(pending().length, 0);
  report([{ ...steward, status: 'error' }, codex, isle]);
  w.watch.scan(t0 + 1000); w.watch.scan(t0 + 60000); assert.equal(pending().length, 0);
  w.watch.scan(t0 + 121000); assert.equal(pending().length, 1); assert.equal(pending()[0].summary, "The Steward's session is down.");
  const raisedAt = pending()[0].ts; w.watch.scan(t0 + 180000); w.watch.scan(t0 + 240000);
  assert.equal(pending().length, 1); assert.equal(pending()[0].ts, raisedAt);
  assert(!JSON.stringify(w.watch.state).includes('/home/test'));
  // Missing from an online node's report also counts; recovery clears it so a later fall raises again.
  report([codex, isle]); w.watch.scan(t0 + 250000); assert.equal(pending().length, 1);
  report([steward, codex, isle]); w.watch.scan(t0 + 260000); assert.equal(pending().length, 0); assert.equal(w.watch.state.seen['steward-down:steward'], undefined);
  // An offline node never raises (that is out of reach; see SPEC v0.41).
  report([{ ...steward, status: 'stopped' }, codex, isle]); n.live.get(p.id).at -= 14000;
  w.watch.scan(t0 + 300000); w.watch.scan(t0 + 500000); assert.equal(pending().length, 0);
  report([{ ...steward, status: 'stopped' }, codex, isle]);
  w.watch.scan(t0 + 600000); w.watch.scan(t0 + 721000); assert.equal(pending().length, 1);
  // Archived is the human's choice, not a fall.
  report([{ ...steward, status: 'stopped', archived: true }, codex, isle]); w.watch.scan(t0 + 730000); assert.equal(pending().length, 0);
  report([{ ...steward, status: 'error' }, codex, isle]); w.watch.scan(t0 + 731000); w.watch.scan(t0 + 852000); assert.equal(pending().length, 1);
  // Resumed in a plain terminal: agent-deck says error, the node says the conversation is live; not down, the event clears.
  report([{ ...steward, status: 'error' }, codex, isle], [], { stewardLive: true }); w.watch.scan(t0 + 860000); assert.equal(pending().length, 0);
  w.watch.scan(t0 + 1100000); assert.equal(pending().length, 0);
  assert.throws(() => report([steward], [], { stewardLive: 'yes' }), /Invalid node report/);
  report([{ ...steward, status: 'error' }, codex, isle]); w.watch.scan(t0 + 1110000); w.watch.scan(t0 + 1231000); assert.equal(pending().length, 1);

  // Server-side job gate: only the named Steward, only when down, and only through the start kind's exact payload.
  await assert.rejects(n.request(p.id, 'start', { sessionId: 'cx-1' }, `node:${p.id}:cx-1`), /Only the Steward/);
  await assert.rejects(n.request(p.id, 'start', { sessionId: 'st-1', extra: 1 }, sid), /Invalid start/);
  await assert.rejects(n.request(p.id, 'start', { sessionId: 'is-1' }, `node:${p.id}:is-1`), /private or gone/);

  // The action: the acting Watch only, in a watch duty turn, with the event pending.
  const mcp = createMcpHandler(w);
  const rpc = (token, method, params) => new Promise(resolve => mcp({ method: 'POST' }, { writeHead() {}, end(body) { resolve(JSON.parse(body)); } }, JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), token));
  const listed = async token => (await rpc(token, 'tools/list')).result.tools.some(t => t.name === 'wake_steward');
  w.beginTurn('Cody', 'cody-life', { job: { dutyKey: 'watch:pending' } });
  assert.throws(() => w.watch.wakeSteward('Cody'), /Only the Watch/); assert.equal(await listed('cody-life'), false); w.endTurn('Cody');
  w.beginTurn('Ione', 'ione-life', { job: { name: 'Ione', reasons: [] } });
  assert.throws(() => w.watch.wakeSteward('Ione'), /Only the Watch/); assert.equal(await listed('ione-life'), false); w.endTurn('Ione');
  const watchJob = { name: 'Ione', reasons: [], dutyKey: 'watch:pending' };
  w.beginTurn('Ione', 'ione-watch', { job: watchJob }); assert.equal(await listed('ione-watch'), true);
  const keep = w.watch.state.pending; w.watch.state.pending = keep.filter(e => e.key !== 'steward-down:steward');
  assert.throws(() => w.watch.wakeSteward('Ione'), /not down/); assert.equal(await listed('ione-watch'), false); w.watch.state.pending = keep;
  const out = (await rpc('ione-watch', 'tools/call', { name: 'wake_steward', arguments: {} })).result.content[0].text;
  assert.match(out, /on its way/); assert.equal(w.s.stewardWakes.length, 1);
  let sent = report([{ ...steward, status: 'error' }, codex, isle]);
  assert.equal(sent.jobs.length, 1); assert.deepEqual(Object.keys(sent.jobs[0]).sort(), ['id', 'kind', 'sessionId']); assert.equal(sent.jobs[0].kind, 'start'); assert.equal(sent.steward, 'st-1');
  report([{ ...steward, status: 'error' }, codex, isle], [{ id: sent.jobs[0].id, ok: true, output: '', error: '' }]); await tick();
  assert.equal(w.s.feed.at(-1).text, 'Ione woke the Steward');
  // Rate limits: one try per fifteen minutes, six per UTC day; refused tries are not counted.
  assert.throws(() => w.watch.wakeSteward('Ione'), /fifteen minutes/); assert.equal(w.s.stewardWakes.length, 1);
  const noon = Date.UTC(2026, 9, 28, 12);
  w.s.stewardWakes = [1, 2, 3, 4, 5].map(h => noon - h * 3600000);
  w.watch.wakeSteward('Ione', noon); assert.equal(w.s.stewardWakes.length, 6);
  assert.throws(() => w.watch.wakeSteward('Ione', noon + 20 * 60000), /six times today/);
  w.endTurn('Ione');
  // The queued wake reached an un-updated node, which refuses the unknown kind with its catch-all text.
  sent = report([{ ...steward, status: 'error' }, codex, isle]); assert.equal(sent.jobs[0].kind, 'start');
  const bells = w.s.bells.length;
  report([{ ...steward, status: 'error' }, codex, isle], [{ id: sent.jobs[0].id, ok: false, output: '', error: LEGACY_FAILURE }]); await tick();
  assert.equal(w.s.bells.length, bells + 1); assert.equal(w.s.bells.at(-1).summary, "The Steward's session is down and could not be woken. Please update Amygdala on Test PC.");
  assert.equal(w.s.bells.at(-1).severity, 'urgent'); assert.equal(w.s.bells.at(-1).isle, false);

  // A stand-in for the Watch may wake it too; an offline node rings the bell at once, and a node refusal is repeated only if safe.
  w.s.stewardWakes = [];
  w.beginTurn('Cody', 'cody-watch', { job: { name: 'Cody', reasons: [], dutyKey: 'watch:pending', standIn: { role: 'watch', for: 'Ione', title: 'The Watch' } } });
  assert.equal(await listed('cody-watch'), true);
  n.live.get(p.id).at -= 14000;
  assert.match(w.watch.wakeSteward('Cody'), /offline or has no agent-deck.*bell has rung/); assert.match(w.s.bells.at(-1).summary, /could not be woken\. That machine is offline/); assert.equal(w.s.bells.at(-1).by, 'Cody');
  report([{ ...steward, status: 'error' }, codex, isle]); w.s.stewardWakes = [];
  w.watch.wakeSteward('Cody'); sent = report([{ ...steward, status: 'error' }, codex, isle]);
  report([{ ...steward, status: 'error' }, codex, isle], [{ id: sent.jobs[0].id, ok: false, output: '', error: 'Already running elsewhere.' }]); await tick();
  assert.equal(w.s.bells.at(-1).summary, "The Steward's session is down and could not be woken. Already running elsewhere.");
  w.s.stewardWakes = []; w.watch.wakeSteward('Cody'); sent = report([{ ...steward, status: 'error' }, codex, isle]);
  report([{ ...steward, status: 'error' }, codex, isle], [{ id: sent.jobs[0].id, ok: false, output: '', error: 'The Steward could not be started.' }]); await tick();
  assert.equal(w.s.bells.at(-1).summary, "The Steward's session is down and could not be woken.");
  // The job is dropped (not sent) if the human renamed the Steward meanwhile.
  w.s.stewardWakes = []; const dropped = w.watch.wakeSteward('Cody'); assert.match(dropped, /on its way/);
  w.s.stewardHero = { ...w.s.stewardHero, workerId: 'node:other' }; sent = report([{ ...steward, status: 'error' }, codex, isle]); await tick();
  assert.equal(sent.jobs.length, 0); assert.equal(sent.steward, null); w.watch.setStewardHero(sid);
  w.endTurn('Cody');
  assert(!JSON.stringify(w.s.bells).includes('/home/test') && !JSON.stringify(w.s.feed).includes('/home/test'));

  // Node side: the duplicate guard and the Steward check, with stub agent-deck and ps runners.
  const cid = '0b5c7a1e-1111-2222-3333-444455556666';
  const deckSession = { id: 'st-1', title: 'Steward', path: '/home/test/amygdala', tool: 'claude', status: 'error', claude_session_id: cid };
  const job = { id: 'j1', kind: 'start', sessionId: 'st-1' }, calls = [];
  const run = async (file, args) => { calls.push([file, ...args]); return { stdout: file === 'agent-deck' && args[1] === 'show' ? JSON.stringify({ claude_session_id: cid }) : 'started' }; };
  const exec = (o = {}, s = deckSession, village = ['st-1']) => executeJob(job, [job], [s], village, run, null, null, { steward: 'st-1', platform: 'linux', ps: async () => '  PID COMMAND\n    1 /sbin/init\n', ...o });
  await assert.rejects(exec({ ps: async () => `  PID COMMAND\n 4242 claude --resume ${cid}\n` }), e => e.safe && e.message === 'Already running elsewhere.');
  await assert.rejects(exec({ ps: async () => `  PID COMMAND\n 4243 tmux new-session -d "claude --session-id ${cid}"\n` }), /Already running elsewhere/);
  await assert.rejects(exec({ ps: async () => { throw new Error('no ps'); } }), /Could not check for a duplicate/);
  await assert.rejects(exec({ steward: null }), /Only the Steward/);
  await assert.rejects(exec({ steward: 'cx-1' }), /Only the Steward/);
  await assert.rejects(exec({ platform: 'win32' }), /Cannot check/);
  await assert.rejects(exec({}, { ...deckSession, status: 'running' }), /already running/);
  await assert.rejects(exec({}, { ...deckSession, tool: 'codex' }), /local Claude session/);
  await assert.rejects(exec({}, { ...deckSession, ssh_host: 'remote' }), /local Claude session/);
  await assert.rejects(exec({}, { ...deckSession, group: 'isle' }), /private or unrequested/);
  await assert.rejects(exec({}, { ...deckSession, archived: true }), /private or unrequested/);
  await assert.rejects(exec({}, deckSession, []), /private or unrequested/);
  assert.equal(calls.filter(c => c[2] === 'start').length, 0);
  assert.equal(await exec(), 'started'); assert.deepEqual(calls.at(-1), ['agent-deck', 'session', 'start', 'st-1']);
  calls.length = 0; assert.equal(await exec({}, { ...deckSession, claude_session_id: undefined }), 'started'); assert.deepEqual(calls[0], ['agent-deck', 'session', 'show', 'st-1', '--json']);
  assert(resumingElsewhere(`9 /home/u/.local/share/claude/versions/2.1.0 --resume=${cid}`, cid));
  assert(resumingElsewhere(`9 node /usr/lib/claude-code/cli.js -r ${cid}`, cid));
  assert(!resumingElsewhere(`9 claude --resume ${cid}`, cid, 9), 'own pid is ignored');
  assert(!resumingElsewhere(`9 vim --resume ${cid}`, cid)); assert(!resumingElsewhere(`9 claude --resume other-${cid}`, cid)); assert(!resumingElsewhere(`9 claude ${cid}`, cid));
  // The node's liveness report: only for the named Steward, down in agent-deck, with its conversation running elsewhere.
  const livePs = async () => `  PID COMMAND\n 4242 claude --resume ${cid}\n`, idlePs = async () => '  PID COMMAND\n    1 /sbin/init\n';
  assert.equal(await stewardLive([deckSession], 'st-1', run, livePs, 'linux'), true);
  assert.equal(await stewardLive([deckSession], 'st-1', run, idlePs, 'linux'), false);
  assert.equal(await stewardLive([{ ...deckSession, status: 'running' }], 'st-1', run, livePs, 'linux'), false);
  assert.equal(await stewardLive([deckSession], null, run, livePs, 'linux'), false);
  assert.equal(await stewardLive([deckSession], 'st-1', run, livePs, 'win32'), false);
  assert.equal(await stewardLive([deckSession], 'st-1', run, async () => { throw new Error('no ps'); }, 'linux'), false);
  console.log('steward wake ok');
} finally { w?.flush?.(); fs.rmSync(dir, { recursive: true, force: true }); }
