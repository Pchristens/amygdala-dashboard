// Execute the real app's drawer/shortcut handlers with event bubbling and a minimal focus model.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
class Element {
  constructor(parent = null, tab = '') { this.parent = parent; this.dataset = { tab }; this.attrs = {}; this.listeners = {}; this.classes = new Set(); this.inert = false; this.classList = { toggle: (c, on = !this.classes.has(c)) => { on ? this.classes.add(c) : this.classes.delete(c); return on; }, contains: c => this.classes.has(c) }; }
  setAttribute(k, v) { this.attrs[k] = v; }
  getAttribute(k) { return this.attrs[k]; }
  addEventListener(k, f) { (this.listeners[k] ||= []).push(f); }
  closest(selector) { return selector === '.drawer-tab' && this.isTab ? this : selector === '.rail-tab' && this.isRail ? this : this.parent?.closest(selector); }
  click() { const event = { target: this }; for (let el = this; el; el = el.parent) for (const fn of el.listeners.click || []) fn(event); }
  focus() { for (let el = this; el; el = el.parent) if (el.inert) return; document.activeElement = this; }
}
const ids = Object.fromEntries(['drawer','rail','drawer-close','lamp-glyph','needs-chip','happening'].map(id => [id, new Element()]));
const tabs = new Element(ids.drawer); ids['drawer-close'].parent = tabs;
const nav = ['activity','people','work','lamps'].map(destination => { const el = new Element(ids.rail); el.dataset.destination = destination; el.isRail = true; return el; });
ids.rail.querySelectorAll = () => nav;
const feedButton = new Element(ids.happening); ids.happening.querySelector = () => feedButton;
const document = { body: new Element(), activeElement: null, querySelector: () => null };
const timers = [], prefs = new Map(), panel = { activeTab: 'board', selectTab(tab) { this.activeTab = tab; } };
const context = vm.createContext({ document, requestAnimationFrame: f => f(), panel, VIEW_DESTINATION: { board:'activity', exhibits:'activity', tales:'activity', residents:'people', workshop:'work', orders:'work', terminal:'work', place:'activity', lamps:'lamps' }, DESTINATION_VIEWS: { activity:['board','exhibits','tales'], people:['residents'], work:['workshop','orders'], lamps:['lamps'] }, $: id => ids[id], localStorage: { getItem: k => prefs.get(k), setItem: (k,v) => prefs.set(k,v) }, setTimeout: f => timers.push(f), disposeTerminal() {}, repositionCard() {}, refreshCardBounds() {}, currentTabBeforePlace: 'board' });
vm.runInContext(app.slice(app.indexOf('const drawer ='), app.indexOf('// resize by dragging the handle')), context);
for (const line of app.split('\n').filter(l => /^\$\('(lamp-glyph|needs-chip)'\)\.addEventListener/.test(l))) vm.runInContext(line.replace("$('needs-chip').addEventListener", "$('needs-chip').addEventListener"), context);
vm.runInContext(app.slice(app.indexOf("const happeningButton ="), app.indexOf('const happeningList =')), context);
const cases = [
  ['rail opens a destination first view and closes on repeat', () => { vm.runInContext('setDrawer(false)', context); nav[2].click(); assert.equal(panel.activeTab, 'workshop'); assert.equal(ids.drawer.classList.contains('open'), true); assert.equal(nav[2].attrs['aria-selected'], 'true'); nav[2].click(); assert.equal(ids.drawer.classList.contains('open'), false); }],
  ['rail remembers the last view within a destination', () => { vm.runInContext("openView('orders')", context); vm.runInContext('setDrawer(false)', context); nav[2].click(); assert.equal(panel.activeTab, 'orders'); assert.equal(nav[2].attrs['aria-selected'], 'true'); }],
  ['close click does not reopen through tabs', () => { vm.runInContext("setDrawer(true, 'board')", context); ids['drawer-close'].click(); while(timers.length) timers.shift()(); assert.equal(ids.drawer.classList.contains('open'), false); }],
  ...[['lamp-glyph','lamps','lamps'],['needs-chip','workshop','work']].map(([id,tab,destination]) => [id + ' opens and synchronizes navigation', () => { vm.runInContext('setDrawer(false)', context); ids[id].click(); assert.equal(ids.drawer.classList.contains('open'), true); assert.equal(panel.activeTab, tab); assert.deepEqual(nav.filter(el => el.attrs['aria-selected'] === 'true').map(el => el.dataset.destination), [destination]); }]),
  ['closed drawer rejects focus, open drawer accepts it', () => { const control = new Element(ids.drawer); vm.runInContext('setDrawer(false)', context); document.activeElement = null; control.focus(); assert.equal(document.activeElement, null); assert.equal(ids.drawer.attrs['aria-hidden'], 'true'); vm.runInContext('setDrawer(true)', context); control.focus(); assert.equal(document.activeElement, control); assert.equal(ids.drawer.attrs['aria-hidden'], 'false'); }],
  ['feed is a native button with explicit type', () => assert.match(html.match(/<[^>]+class="happening-title"[^>]*>[^<]*<\/[^>]+>/)?.[0] || '', /<button\b[^>]*class="happening-title"[^>]*type="button"[^>]*>Happening now<\/button>/)],
  ['feed button still toggles and remembers collapse', () => { feedButton.click(); assert.equal(ids.happening.classList.contains('collapsed'), true); assert.equal(JSON.parse(prefs.get('hf.drawer')).feed, 'collapsed'); feedButton.click(); assert.equal(ids.happening.classList.contains('collapsed'), false); }],
];
let failed = 0;
for (const [name, run] of cases) { try { run(); console.log('ok:', name); } catch(e) { failed++; console.error('FAIL:', name, e.message); } }
assert.equal(failed, 0, `${failed} GUI navigation regressions`);
