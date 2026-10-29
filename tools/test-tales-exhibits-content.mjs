import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../public/panel.js', import.meta.url), 'utf8');
const start = source.indexOf('  let taleControls = null;');
const end = source.indexOf('\n  let ordersKey =', start);
const root = { childNodes: [], append(node) { node.parentNode = this; this.childNodes.push(node); }, contains() { return false; }, addEventListener() {} };
const document = { activeElement: null };
const context = vm.createContext({ state: { taleSettings: { minHours: 1, minFixed: 2, minCommits: 3 }, tales: [{ tale: { title: 'Recorded story', text: 'Story text' } }] }, zone: 'village', document, queueMicrotask, $: () => root, isleLocked: () => false, zoneOf: () => 'village', clearExcept: (r, keep) => { r.childNodes = r.childNodes.filter(child => child === keep); }, h: (tag, props = {}, ...children) => ({ tag, ...props, children, append(...nodes) { this.children.push(...nodes); }, addEventListener() {} }), settingField: () => {}, renderSealedTablet() {} });
vm.runInContext(source.slice(start, end), context);
vm.runInContext('renderTales()', context);
assert.equal(root.childNodes[0].tag, 'article', 'tale content leads the view');
assert.equal(root.childNodes[1].tag, 'details', 'tale settings follow the tales in a fold');
assert.equal(root.childNodes[1].class, 'temple-fold');
assert.equal(root.childNodes[1].children[0].text, 'Tale settings');

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const exhibits = html.slice(html.indexOf('<section class="tab-body" id="tab-exhibits"'), html.indexOf('</section>', html.indexOf('<section class="tab-body" id="tab-exhibits"')));
assert.match(exhibits, /id="exhibit-tabs"/);
assert.match(exhibits, /id="exhibits-list"/);
assert.doesNotMatch(exhibits, /<h[1-6][^>]*>\s*Exhibits\s*<\/h[1-6]>/i, 'exhibits has no repeated inner heading');
console.log('ok: tales and exhibits content lead');
