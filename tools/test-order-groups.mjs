import assert from 'node:assert/strict';
import { panelDocument } from './panel-dom.mjs';
import { createPanel } from '../public/panel.js';

globalThis.document = panelDocument(); globalThis.window = {}; globalThis.requestAnimationFrame = fn => fn();
const panel = createPanel({ api: async () => ({}) });
const orders = [
  { id: 'a', group: 'g', to: 'Ada', status: 'answered', headline: 'Shared task' },
  { id: 'b', group: 'g', to: 'Bela', status: 'working', headline: 'Shared task' },
  { id: 'c', group: 'g', to: 'Cleo', status: 'queued', headline: 'Shared task' },
  { id: 'd', group: 'g', to: 'Dara', status: 'failed', headline: 'Shared task' },
  { id: 'e', to: 'Eli', status: 'queued', headline: 'Open task' },
  { id: 'f', to: 'Flo', status: 'cancelled', headline: 'Finished task' },
];
const update = list => panel.update({ zones: [{ id: 'village' }], residents: [], workers: [], posts: [], exhibits: [], orders: list });
update(orders);
const list = document.getElementById('orders').querySelector('div.order-list') || document.getElementById('orders');
const cards = list.querySelectorAll('.order-card'), group = cards.find(c => c.dataset.orderIds === '["a","b","c","d"]');
assert(group, 'group card keeps every member id');
assert.match(group.textContent, /4 residents · 1 answered, 1 working, 1 queued, 1 failed/);
assert(!/Ada · answered \|/.test(group.textContent), 'no duplicate pipe-separated recipient sentence');
const finished = list.querySelector('details.temple-fold');
assert(finished && !finished.open && finished.querySelector('summary').textContent === 'Finished orders (1)');
assert.deepEqual(finished.querySelectorAll('.order-card').map(c => JSON.parse(c.dataset.orderIds)), [['f']]);
panel.openOrder('f'); assert.equal(finished.open, true); assert.equal(finished.querySelector('.order-card').querySelector('details').open, true);
const openCard = cards.find(c => c.dataset.orderIds === '["e"]'), openDetails = openCard.querySelector('details'); openDetails.open = true;
update(orders.map(o => ({ ...o, chat: o.id === 'e' ? 'changed' : o.chat })));
const rebuilt = document.getElementById('orders').querySelectorAll('.order-card').find(c => c.dataset.orderIds === '["e"]');
assert.equal(rebuilt.querySelector('details').open, true, 'open state survives order updates by first order id');
console.log('order groups: compact outcomes, finished fold, and open details preserved');
// A real NodeList has no array methods (panel-dom returns arrays, so check the source instead).
const fs = await import('node:fs'); for (const f of ['panel.js', 'app.js']) assert.doesNotMatch(fs.readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8'), /querySelectorAll\([^)]*\)\.(filter|map|find|some|every|reduce)\(/, `${f} calls an array method on a NodeList`);
// The Finished orders fold keeps its open state across rebuilds, as the Tale settings fold does (Themis residual on 4062fa0).
{ const src = (await import('node:fs')).readFileSync(new URL('../public/panel.js', import.meta.url), 'utf8'); assert.match(src, /finishedFold\.open = finishedOpen; finishedFold\.addEventListener\('toggle', \(\) => \{ finishedOpen = finishedFold\.open; \}\)/); }
