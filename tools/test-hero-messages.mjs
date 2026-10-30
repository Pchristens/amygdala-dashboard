import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { World } from '../lib/world.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amygdala-hero-messages-'));
let w;
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
try {
  w = new World(dir, [], path.join(dir, 'residents.json'));
  const hero = { id: 'local:h1', sessionId: 'h1', host: 'local', title: 'Builder', project: 'proj', path: dir, zone: 'village', status: 'running', tool: 'claude' };
  w.setWorkers([hero]);
  let release;
  let sentArgs;
  const started = w.messageHero(hero.id, 'hello', args => new Promise(resolve => { sentArgs = args; release = () => resolve({ stdout: JSON.stringify({ content: 'reply' }) }); }));
  assert(started.ok && started.id);
  assert.throws(() => w.messageHero(hero.id, 'again'), /already in flight/);
  assert.equal(w.snapshot().workers[0].messages, undefined);
  await tick();
  assert.equal(sentArgs[2], 'h1'); release(); await tick(); await tick();
  assert.deepEqual(w.snapshot({ human: true }).workers.find(x => x.id === hero.id).messages.map(e => [e.from, e.status]), [['keeper', 'answered'], ['hero', 'answered']]);
  assert.equal(w.snapshot({ human: true }).workers.find(x => x.id === hero.id).messages[1].text, 'reply');

  const node = { ...hero, id: 'node:n:h2', sessionId: 'h2', node: 'n' }; w.setWorkers([node]);
  // Existing callers (orders, Temple fixes, petition relays) send without wait; the new check must still let them through.
  const realRequest = Object.getPrototypeOf(w.nodes).request.bind(w.nodes);
  const passes = w.nodes.passes; w.nodes.passes = () => [{ id: 'n', online: true, deckAvailable: true }];
  for (const payload of [{ sessionId: 'h2', message: 'queued' }, { sessionId: 'h2', message: 'waited', wait: true }]) { const before = w.nodes.jobs.size, pending = realRequest('n', 'send', payload, node.id); assert.equal(w.nodes.jobs.size, before + 1); [...w.nodes.jobs.values()].at(-1).finish(null, 'ok'); assert.equal(await pending, 'ok'); }
  for (const payload of [{ sessionId: 'h2', message: 'x', wait: false }, { sessionId: 'h2', message: 1 }, { sessionId: 'h2', message: 'x', extra: 1 }]) await assert.rejects(realRequest('n', 'send', payload, node.id), /Invalid message/);
  w.nodes.passes = passes;
  w.nodes.request = async () => JSON.stringify({ content: 'node reply' });
  w.messageHero(node.id, 'node hi'); await tick(); await tick();
  assert.equal(w.s.heroThreads[node.id].at(-1).text, 'node reply');

  const hostile = ['isle', 'tagged', 'quarantined', 'sealed', 'private'].map((kind, i) => ({ ...hero, id: `local:p${i}`, title: kind, ...(kind === 'isle' ? { zone: 'isle' } : kind === 'tagged' ? { isleTagged: true } : { [kind]: true }) }));
  w.setWorkers([hero, ...hostile]);
  for (const h of hostile) assert.throws(() => w.messageHero(h.id, 'no'), /private or gone/);
  w.s.heroThreads['local:p0'] = [{ id: 'secret', from: 'hero', text: 'private', ts: Date.now(), status: 'answered' }];
  assert.equal(w.snapshot({ human: true }).workers.find(x => x.id === 'local:p0').messages, undefined);
  assert.equal('heroThreads' in w.snapshot(), false);
  assert(!JSON.stringify(w.snapshot({ human: true })).includes('"private","ts"') && !JSON.stringify(w.snapshot({ human: true })).includes('id":"secret'));

  w.setWorkers([hero]); w.messageHero(hero.id, 'clip', async () => ({ stdout: JSON.stringify({ content: 'x'.repeat(7000) }) })); await tick(); await tick();
  assert.equal(w.s.heroThreads[hero.id].at(-1).text.length, 6000);
  w.messageHero(hero.id, 'failure', async () => ({ err: new Error('sensitive stderr') })); await tick(); await tick();
  assert.equal(w.s.heroThreads[hero.id].at(-1).status, 'failed'); assert(!JSON.stringify(w.s.heroThreads[hero.id]).includes('sensitive stderr')); assert.equal(w.s.heroThreads[hero.id].at(-1).text, 'failure');
  assert.throws(() => w.messageHero(hero.id, 'x'.repeat(8001)), /8000/);

  w.s.heroThreads[hero.id] = [{ id: 'stuck', from: 'keeper', text: 'waiting', ts: Date.now(), status: 'sending' }]; w.save();
  const reloaded = new World(dir, [], path.join(dir, 'residents.json'));
  assert.equal(reloaded.s.heroThreads[hero.id][0].status, 'failed'); assert.equal(reloaded.s.heroThreads[hero.id][0].text, 'waiting'); assert.equal(reloaded.s.heroThreads[hero.id][0].note, 'the server restarted');
  w.s.heroThreads[hero.id] = [{ id: 'gone', from: 'keeper', text: 'x', ts: Date.now(), status: 'answered' }];
  w.setWorkers([{ ...hero, status: 'stopped' }]);
  await w.sites.heroAction(hero.id, 'forget', async () => ({ err: null, stdout: '' }));
  assert.equal(w.s.heroThreads[hero.id], undefined);
} finally { w?.saveTimer && clearTimeout(w.saveTimer); fs.rmSync(dir, { recursive: true, force: true }); }
console.log('hero messages ok');
