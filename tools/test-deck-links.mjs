import assert from 'node:assert/strict';
import fs from 'node:fs';
import { deckLink } from '../public/panel.js';
import { relay } from '../lib/keeper.js';
import { panelDocument } from './panel-dom.mjs';
import { createPanel } from '../public/panel.js';
import http from 'node:http';

assert.equal(deckLink({ id: 'local:abc123' }), 'http://127.0.0.1:8420/s/abc123');
assert.equal(deckLink({ id: 'node:abc123' }), null);
const relayedAs = id => { globalThis.document = { querySelector: s => s === 'meta[name="hf-relayed"]' ? { getAttribute: () => id } : null }; };
// Through the Mac's keeper (node pass np1): only that node's heroes, to the Mac's own Deck.
relayedAs('np1');
assert.equal(deckLink({ id: 'local:abc123' }), null, 'the village machine\'s heroes are not on the viewer\'s Deck');
assert.equal(deckLink({ id: 'node:np1:s-42', node: 'np1', sessionId: 's-42' }), 'http://127.0.0.1:8420/s/s-42');
assert.equal(deckLink({ id: 'node:np2:s-43', node: 'np2', sessionId: 's-43' }), null, 'another node\'s hero gets no link');
relayedAs('1');
assert.equal(deckLink({ id: 'node:np1:s-42', node: 'np1', sessionId: 's-42' }), null, 'an unnamed relay links nothing');
globalThis.document = { querySelector: () => null };
assert.equal(deckLink({ id: 'node:np1:s-42', node: 'np1', sessionId: 's-42' }), null, 'on the village machine, node heroes get no link');
globalThis.document = panelDocument();
const ui = createPanel({ canOpenTerminal: () => true });
ui.update({ workers: [{ id: 'local:abc123', title: 'hero', status: 'running', tool: 'codex', host: 'local', site: 'forge', zone: 'village' }], residents: [], counsel: [], sites: [{ id: 'forge', label: 'Forge' }], world: {} });
const row = document.querySelector('.worker-row');
assert(row.querySelector('.row-quick').querySelector('button').textContent === 'Terminal ▸' && !row.querySelector('.worker-more').textContent.includes('Terminal'));
const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
assert.match(server, /req\.headers\['x-amygdala-relayed'\][\s\S]*hf-relayed/);

const viaRelay = viewer => new Promise(resolve => {
  const up = http.createServer((req, res) => { resolve(req.headers['x-amygdala-relayed']); res.end('ok'); }).listen(0, '127.0.0.1', () => {
    const port = up.address().port;
    const gate = http.createServer((req, res) => relay(req, res, port, req.url, viewer)).listen(0, '127.0.0.1', () => {
      http.get({ host: '127.0.0.1', port: gate.address().port, path: '/' }, res => { res.resume(); res.on('end', () => { up.close(); gate.close(); }); });
    });
  });
});
assert.equal(await viaRelay('np1'), 'np1', 'the relay names the viewing node');
assert.equal(await viaRelay('bad"><script>'), '1', 'an odd id never reaches the page');
console.log('deck links ok');
