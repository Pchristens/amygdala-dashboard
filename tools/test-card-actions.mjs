import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { panelDocument } from './panel-dom.mjs';
import { h } from '../public/util.js';
import { residentCard } from '../public/cards.js';
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8'), panelSource = fs.readFileSync(new URL('../public/panel.js', import.meta.url), 'utf8');
globalThis.document = panelDocument();
const cardEl = h('div'), opener = h('button'), calls = [], card = {};
document.body.append(opener, cardEl);
const resident = { name: 'Synthetic Ada', zone: 'village', enabled: true, doing: 'reading' };
const ctx = vm.createContext({ document, h, residentCard, card, cardEl, state: { residents: [resident] }, api: async (...args) => { calls.push(['api', ...args]); return {}; }, okResult: () => true, toast: text => calls.push(['toast', text]), setDrawer: (...args) => calls.push(['drawer', ...args]), panel: { orderTo: name => calls.push(['order', name]), showResident: name => calls.push(['resident', name]) }, map: { follow: name => { ctx.following = name; calls.push(['follow', name]); }, following: name => ctx.following === name }, cardPlaceName: () => null, repositionCard() {} });
const run = code => vm.runInContext(code, ctx);
vm.runInContext(app.slice(app.indexOf('function pinCard('), app.indexOf("// The map's place label")), ctx);
const actionsStart = app.indexOf('function wakeResident(');
if (actionsStart >= 0) vm.runInContext(app.slice(actionsStart, app.indexOf('function buildCard(')), ctx);
vm.runInContext(app.slice(app.indexOf('function buildCard('), app.indexOf("  if (type === 'worker')", app.indexOf('function buildCard('))) + '\n}', ctx);
const snapshotStart = app.indexOf('  if (card.info) {', app.indexOf('function applyState('));
const snapshotCode = app.slice(snapshotStart, app.indexOf('  if (placePane.id', snapshotStart));
const click = label => { const button = cardEl.querySelectorAll('button').find(b => b.textContent === label); assert(button && !button.hidden, label); button.dispatchEvent({ type: 'click', stopPropagation() {} }); };
const open = () => { opener.focus(); run("showCard({type:'resident',id:'Synthetic Ada'},true)"); };
const tests = [
  ['focus returns on close', () => { open(); assert.equal(document.activeElement, cardEl.querySelector('.resident-card')); run('closeCard()'); assert.equal(document.activeElement, opener); }],
  ['snapshot keeps the mounted root and focus', () => { open(); const root = cardEl.querySelector('.resident-card'); const button = root.querySelector('button'); button.focus(); ctx.state = { residents: [{ ...resident, doing: 'updated work' }] }; run(snapshotCode); assert.equal(cardEl.querySelector('.resident-card'), root); assert.equal(document.activeElement, button); assert.match(root.textContent, /updated work/); }],
  ['wake uses current name once', async () => { open(); cardEl.querySelector('.resident-card').update({ ...resident, name: 'Synthetic Renamed' }, ctx.state); calls.length = 0; click('Wake now'); await Promise.resolve(); assert.equal(calls.filter(c => c[0] === 'api').length, 1); assert.equal(calls[0][1], '/api/residents/Synthetic%20Renamed/wake'); }],
  ['details and order navigate after closing', () => { open(); calls.length = 0; click('Details'); assert.deepEqual(calls, [['drawer', true, 'residents'], ['resident', resident.name]]); assert(cardEl.hidden); open(); calls.length = 0; click('Order…'); assert.deepEqual(calls, [['drawer', true, 'orders'], ['order', resident.name]]); assert(cardEl.hidden); }],
  ['follow and unfollow', () => { open(); calls.length = 0; click('Follow'); click('Unfollow'); assert.deepEqual(calls, [['follow', resident.name], ['follow', null]]); }],
  ['re-pinning from inside the card keeps the first opener', () => { open(); cardEl.querySelector('.resident-card button').focus(); run("showCard({type:'resident',id:'Synthetic Ada'},true)"); run('closeCard()'); assert.equal(document.activeElement, opener); }],
  ['missing resident closes card', () => { open(); ctx.state = { residents: [] }; run(snapshotCode); assert(cardEl.hidden); assert.equal(document.activeElement, opener); }],
  ['orderTo selects only eligible option and focuses headline', () => {
    const root = h('div', { id: 'orders' }); document.body.append(root);
    const headline = h('input', { 'aria-label': 'Headline' }); root.append(headline);
    const options = ['all', resident.name, 'Synthetic Other'].map(value => ({ value, selected: true }));
    const tabs = [];
    const pctx = vm.createContext({ document: { getElementById: () => root }, selectTab: name => tabs.push(name), renderOrders: () => { root._to = { options }; root._form = root; } });
    const start = panelSource.indexOf('  function orderTo(');
    assert(start >= 0, 'orderTo must be exposed');
    vm.runInContext(panelSource.slice(start, panelSource.indexOf('  return { openOrder', start)), pctx);
    vm.runInContext("orderTo('Synthetic Ada')", pctx); assert.deepEqual(options.map(o => o.selected), [false, true, false]); assert.equal(document.activeElement, headline);
    vm.runInContext("orderTo('Missing')", pctx); assert(options.every(o => !o.selected)); assert.deepEqual(tabs, ['orders', 'orders']);
    assert.match(panelSource, /return \{ openOrder, orderTo,/);
  }],
];
let failed = 0;
for (const [name, test] of tests) { try { await test(); console.log('PASS', name); } catch (e) { failed++; console.error('FAIL', name, e.message); } }
assert.equal(failed, 0);
