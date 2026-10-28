import assert from 'node:assert/strict';
import { terminalInput, terminalKeys } from '../public/terminal-input.js';
import { PassThrough } from 'node:stream';
import { terminalPoller, terminalOutput } from './amygdala-node.mjs';
import { Nodes } from '../lib/nodes.js';
import { TermHub } from '../lib/term.js';
function clock() {
  let now = 0, seq = 0; const tasks = new Map();
  return { schedule(fn, delay) { const id = ++seq; tasks.set(id, { at: now + delay, fn }); return id; }, cancel(id) { tasks.delete(id); },
    async tick(ms) { const end = now + ms; for (;;) { const next = [...tasks].sort((a,b) => a[1].at - b[1].at)[0]; if (!next || next[1].at > end) break; tasks.delete(next[0]); now = next[1].at; next[1].fn(); await settle(); } now = end; },
  };
}
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
class Terminal {
  hasSelection() { return this.selected; }
  attachCustomKeyEventHandler(handler) { this.keys = handler; }
  onData(handler) { this.data = handler; return { dispose() {} }; }
  paste(text) { this.data(`\x1b[200~${text}\x1b[201~`); }
}
const term = new Terminal(); let copied = 0;
term.attachCustomKeyEventHandler(e => terminalKeys(term, e, () => copied++));
for (const event of [{ key: 'v', ctrlKey: true }, { key: 'V', ctrlKey: true, shiftKey: true }, { key: 'Insert', shiftKey: true }, { key: 'v', metaKey: true }]) assert.equal(term.keys(event), false);
assert.equal(term.keys({ key: 'c', ctrlKey: true }), true); // Preserve interrupt without selection.
term.selected = true;
assert.equal(term.keys({ key: 'c', ctrlKey: true }), false);
let prevented = false;
assert.equal(term.keys({ type: 'keydown', key: 'C', ctrlKey: true, shiftKey: true, preventDefault() { prevented = true; } }), false);
assert.equal(copied, 1); assert(prevented);
const time = clock(), requests = [], errors = [];
let resolve, concurrent = 0, peak = 0;
const transport = terminalInput({ ...time, error: e => errors.push(e), send(action, body) {
  concurrent++; peak = Math.max(peak, concurrent); requests.push({ action, body });
  return new Promise(r => { resolve = status => { concurrent--; r({ status, ok: status === 200 }); }; });
} });
term.onData(data => transport.data(data));
term.paste('hello\n世界'); await time.tick(20); assert.equal(requests.length, 0);
transport.resize(80,24); transport.connect(); await time.tick(0); assert.equal(requests.length, 1);
term.data('x'.repeat(150000)); transport.resize(90,30); transport.resize(100,40);
await time.tick(100); assert.equal(requests.length, 1);
resolve(429); await settle(); await time.tick(25);
assert(Buffer.from(requests[1].body.d, 'base64').subarray(0, Buffer.from(requests[0].body.d, 'base64').length).equals(Buffer.from(requests[0].body.d, 'base64'))); // Busy consumes nothing; new bytes may join retry.
const delivered = [];
for (let i = 0; i < 20; i++) {
  const req = requests.at(-1); if (req.action === 'input') delivered.push(Buffer.from(req.body.d, 'base64'));
  resolve(200); await settle(); await time.tick(0);
  if (req.action === 'resize') break;
}
assert.equal(Buffer.concat(delivered).toString(), '\x1b[200~hello\n世界\x1b[201~' + 'x'.repeat(150000));
assert.deepEqual(requests.filter(r => r.action === 'resize').map(r => r.body), [{ cols: 100, rows: 40 }]);
assert.equal(peak,1); assert.equal(errors.length,0); transport.dispose();
// Scheduler wakes while idle and during a pending request, without overlapping fetches.
const pc = clock(); let active = false, polls = 0, finish;
const poller = terminalPoller(() => { polls++; return new Promise(r => { finish = r; }); }, () => active, pc);
await pc.tick(0); assert.equal(polls,1); finish(); await settle();
await pc.tick(1999); assert.equal(polls,1); poller.wake(); await pc.tick(0); assert.equal(polls,2);
active = true; poller.wake(); await pc.tick(0); assert.equal(polls,2); finish(); await settle(); await pc.tick(0); assert.equal(polls,3);
finish(); await settle(); await pc.tick(24); assert.equal(polls,3); await pc.tick(1); assert.equal(polls,4); poller.dispose(); finish(); await settle();
// Output wakes polling immediately; paused fixture producers retain every chunk.
const outputs = [], producers = new Map(); let wakes = 0;
const producer = { child: { stdout: new PassThrough() } }, outputTerm = { id: 'fixture-output' };
producers.set(outputTerm.id, producer);
producer.lines = terminalOutput(outputTerm, producer.child, producers, outputs, () => wakes++);
for (let i = 0; i < 40; i++) producer.child.stdout.write(JSON.stringify({ t: 'o', d: Buffer.from(String(i)).toString('base64') }) + '\n');
assert(wakes >= 24); assert(producer.child.stdout.isPaused());
const allOutput = [];
for (let i = 0; i < 20 && allOutput.length < 40; i++) { allOutput.push(...outputs.splice(0,8)); if (outputs.length < 16) producer.lines.resume(); await new Promise(setImmediate); }
assert.deepEqual(allOutput.map(o => Buffer.from(o.d, 'base64').toString()), Array.from({ length: 40 }, (_,i) => String(i)));
producer.lines.close(); producer.child.stdout.end();
// An ambiguous network failure must not replay accepted input on SSE reconnect.
const fc = clock(); let sends = 0;
const failed = terminalInput({ ...fc, send: async () => { sends++; throw new Error('offline'); }, error() {} });
failed.data('a'); failed.connect(); await fc.tick(10); failed.connect(); await fc.tick(100); assert.equal(sends,1); failed.dispose();
// Exercise the panel wiring with a fake DOM, xterm, fetch and EventSource.
const { mountHeroTerminal } = await import('../public/panel.js');
const mc = clock(), saved = new Map();
const install = (name, value) => { saved.set(name, Object.getOwnPropertyDescriptor(globalThis,name)); Object.defineProperty(globalThis,name,{ value, configurable:true, writable:true }); };
class Element {
  constructor() { this.children = []; this.style = {}; this.clientWidth = 600; this.clientHeight = 400; }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.children.push(child); }
  setAttribute() {}
  addEventListener() {}
}
let mounted, stream, posted = [];
class MountedTerminal extends Terminal {
  constructor() { super(); mounted = this; this.cols = 80; this.rows = 24; this.options = {}; }
  loadAddon() {} open() {} focus() {} write() {} dispose() { this.disposed = true; }
}
try {
  install('document', { createElement: () => new Element(), createTextNode: text => text });
  install('window', { Terminal: MountedTerminal, FitAddon: { FitAddon: class { fit() {} } } });
  install('ResizeObserver', class { observe() {} disconnect() {} });
  install('EventSource', class { constructor() { stream = this; this.events = {}; } addEventListener(name,fn) { this.events[name] = fn; } close() {} });
  install('requestAnimationFrame', fn => mc.schedule(fn,0)); install('cancelAnimationFrame', mc.cancel);
  install('setTimeout', mc.schedule); install('clearTimeout', mc.cancel);
  install('fetch', async (url, options) => { posted.push({ url, body: JSON.parse(options.body) }); return { ok:true, status:200 }; });
  const dispose = mountHeroTerminal(new Element(), { id:'node:fixture', node:'fixture' }, { token:'fixture', onClose() {} });
  mounted.paste('native paste'); await mc.tick(20); assert.equal(posted.length,0);
  stream.onopen(); await mc.tick(0);
  assert.equal(Buffer.from(posted.find(p => p.url.endsWith('/input')).body.d,'base64').toString(),'\x1b[200~native paste\x1b[201~');
  assert.equal(mounted.keys({ key:'v', ctrlKey:true }),false);
  dispose(); assert(mounted.disposed);
} finally { for (const [name, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis,name,descriptor); else delete globalThis[name]; } }
// Actual node/TermHub fixture: bounded refusal is atomic, retry preserves bytes and bridge.
let seq = 0;
const world = { s: {}, workers: [], sites: { privateWorker: () => false }, id: () => `test-${++seq}`, changed() {}, refreshWorkers() {} };
const nodes = world.nodes = new Nodes(world), issued = nodes.issue('Fixture Node'), pass = nodes.auth(issued.token);
nodes.live.set(pass.id, { at: Date.now(), deckAvailable: true });
const worker = { id: 'node:fixture', node: pass.id, sessionId: 'fixture', zone: 'village' }; world.workers.push(worker);
const hub = new TermHub(world); await hub.open(worker.id);
const chunk = Buffer.alloc(16384, 120).toString('base64'), expected = [];
let refused = false;
for (let i = 0; i < 30; i++) {
  try { hub.input(worker.id, chunk); expected.push(chunk); }
  catch (e) { assert.equal(e.status,429); refused = true; break; }
}
assert(refused); assert(hub.bridges.has(worker.id));
const batch = nodes.termPoll(pass, { output: [] }).terms[0].input.map(JSON.parse);
assert.deepEqual(batch.map(x => x.d),expected); assert(batch.length > 8);
hub.input(worker.id, chunk); assert.deepEqual(nodes.termPoll(pass, { output: [] }).terms[0].input.map(JSON.parse), [{ t: 'i', d: chunk }]);
assert.deepEqual(nodes.termPoll(pass, { output: [] }).terms[0].input, []);
worker.quarantined = true; assert.throws(() => hub.input(worker.id, chunk), /private/);
nodes.termPoll(pass, { output: [] }); assert.equal(hub.bridges.size,0); clearInterval(hub.watch);
console.log('terminal input: native shortcuts, early paste, batching, retries, scheduler and byte backpressure passed');
