import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { World } from '../lib/world.js';
import { Usage } from '../lib/usage.js';
import { Conductor } from '../lib/conductor.js';
import { createMcpHandler } from '../lib/mcp.js';
// No external provider processes in this unit test.
Usage.prototype.pollDeck = () => {};
Usage.prototype.probe = () => {};
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearthfield-lean-'));
let w;
try {
  const config = [{ name: 'Lyra', agent: 'antigravity', model: 'gemini-4-argon-medium', lean: true, persona: 'p' }, { name: 'Iris', agent: 'claude', model: 'haiku', persona: 'p' }];
  const file = path.join(dir, 'residents.json');
  fs.writeFileSync(file, JSON.stringify(config));
  w = new World(dir, config, file);
  const mcp = createMcpHandler(w);
  const rpc = (token, method, params) => new Promise(resolve => mcp({ method: 'POST' }, { writeHead() {}, end(body) { resolve(JSON.parse(body)); } }, JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), token));

  // Lean mode: only act and read tools are listed; act's description carries the rest, and hidden tools still work through act.
  w.beginTurn('Lyra', 'lyra-token');
  const lean = (await rpc('lyra-token', 'tools/list')).result.tools;
  assert(lean.every(t => t.name === 'act' || t.name.startsWith('read_') || t.name === 'examine_offering'));
  const act = lean.find(t => t.name === 'act');
  assert.match(act.description, /post\(text, channel\?, reply_to\?\)/);
  assert.match(act.description, /note_to_self\(text\)/);
  const done = (await rpc('lyra-token', 'tools/call', { name: 'act', arguments: { actions: [{ tool: 'post', args: { text: 'hello' } }, { tool: 'set_status', args: { mood: 'calm', doing: 'reading' } }] } })).result.content[0].text;
  assert.match(done, /1\. post: Posted p\d+/); assert.match(done, /2\. set_status: Status updated/);
  w.endTurn('Lyra');
  w.beginTurn('Iris', 'iris-token');
  const full = (await rpc('iris-token', 'tools/list')).result.tools;
  assert(full.some(t => t.name === 'post') && full.length > lean.length);

  // Long posts: up to 2400 chars, flagged when clipped; others' long posts are shortened in look unless they're for you.
  const long = w.addPost('Iris', 'resident', 'x'.repeat(3000));
  assert.equal(long.text.length, 2400); assert.equal(long.clipped, true);
  assert.equal(w.addPost('Guest', 'visitor', 'y'.repeat(1000), 'commons', null, 'village').text.length, 800);
  w.endTurn('Iris');
  w.addPost('You', 'human', 'z'.repeat(1500));
  const view = mcp.lookFor('Lyra');
  assert.match(view, /read_board with post_id/); assert(view.includes('z'.repeat(1500)));
  assert(!view.includes('x'.repeat(401)));

  // Routine wakes skip residents with nothing new; anything new (or a long idle) wakes them.
  // hasNews alone, without a live conductor (which could spawn real CLIs).
  const c = { world: w, hasNews: Conductor.prototype.hasNews };
  w.s.residents.Lyra.appearance = w.s.residents.Iris.appearance = { ts: Date.now() };
  w.endTurn('Lyra'); w.endTurn('Iris');
  assert.equal(c.hasNews('Lyra'), false);
  w.addPost('Iris', 'resident', 'hi Lyra');
  assert.equal(c.hasNews('Lyra'), true); assert.equal(c.hasNews('Iris'), false);
  w.s.residents.Iris.lastTurnAt = Date.now() - 7 * 3600000;
  assert.equal(c.hasNews('Iris'), true);
  console.log('PASS: lean tool listing and act catalogue, post caps and clipping, shortened long posts in look, idle-wake skipping');
} finally {
  if (w) { clearTimeout(w.saveTimer); clearInterval(w.seal.timer); }
  fs.rmSync(dir, { recursive: true, force: true });
}
