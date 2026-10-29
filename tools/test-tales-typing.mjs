import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../public/panel.js', import.meta.url), 'utf8');
const start = source.indexOf('  let taleControls = null;');
const end = source.indexOf('\n  let ordersKey =', start);
const root = { childNodes: [], append(node) { node.parentNode = this; this.childNodes.push(node); }, contains(node) { const inside = child => child === node || child?.children?.some(inside); return node != null && (this === node || this.childNodes.some(inside)); }, querySelectorAll(selector) { return selector === 'input,textarea,select' ? this.childNodes.flatMap(child => child.children || []).filter(child => child?.value !== undefined) : []; }, addEventListener(type, fn) { this[type] = fn; } };
const document = { activeElement: null }; let locked = false; let sealedShown = 0;
const context = vm.createContext({ get locked() { return locked; },
  state: { taleSettings: null, tales: [{ hero: 'Hero', workedMs: 1000 }] }, zone: 'village', document, queueMicrotask,
  $: () => root, isleLocked: () => locked, zoneOf: () => 'village',
  clearExcept: (r, keep) => { for (const child of [...r.childNodes]) if (child !== keep) { r.childNodes.splice(r.childNodes.indexOf(child), 1); child.parentNode = null; } },
  h: (tag, props = {}, ...children) => ({ tag, ...props, children, append(...nodes) { this.children.push(...nodes); } }),
  renderSealedTablet() { sealedShown++; },
});
vm.runInContext(source.slice(start, end), context);
const run = code => vm.runInContext(code, context);

run('renderTales()');
const original = root.childNodes[0];
const button = { tag: 'button', matches: () => false, parentNode: original }; original.children.push(button); document.activeElement = button;
context.state.tales = [{ hero: 'Button update', workedMs: 2000 }];
run('renderTales()');
assert.notEqual(root.childNodes[0], original, 'a focused button does not defer a snapshot');
const typingView = root.childNodes[0];
const input = { value: 'typed', matches: selector => selector === 'input,textarea,select,[contenteditable="true"]', parentNode: typingView };
typingView.children.push(input);
document.activeElement = input;
context.state.tales = [{ hero: 'Updated Hero', workedMs: 3000 }];
run('renderTales()');
assert.equal(root.childNodes[0], typingView, 'snapshot keeps the current tales view while typing');
document.activeElement = null;
root.focusout({ relatedTarget: null });
await new Promise(resolve => setImmediate(resolve));
assert.notEqual(root.childNodes[0], typingView, 'blur applies the latest snapshot');
assert.equal(root.childNodes[0].children[1].text, 'Bard: awaiting a bard · Updated Hero · — · —');
// A sealed isle never waits for focus to leave: it applies at once.
const view = root.childNodes[0]; const field = { value: 'typed', parentNode: view }; view.children.push(field); document.activeElement = field;
locked = true; run('renderTales()'); assert.equal(sealedShown, 1, 'sealing applies even while typing'); locked = false;
console.log('ok: tales typing');
