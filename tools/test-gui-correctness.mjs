// Exercise the real resident renderer and terminal header handlers without a browser, server or xterm connection.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../public/panel.js', import.meta.url), 'utf8');
class Element {
  constructor(tag, props = {}, ...children) { this.tag = tag; Object.assign(this, props); this.className = props.class || ''; this.textContent = props.text || ''; this.children = []; this.parent = null; this.append(...children); }
  append(...children) { for (const child of children.flat()) if (child) this.appendChild(child); }
  appendChild(child) { child.remove?.(); this.children.push(child); child.parent = this; return child; }
  insertBefore(child, before) { child.remove?.(); const i = this.children.indexOf(before); this.children.splice(i < 0 ? this.children.length : i, 0, child); child.parent = this; return child; }
  remove() { if (this.parent) { const siblings = this.parent.children; siblings.splice(siblings.indexOf(this), 1); this.parent = null; } }
  get firstChild() { return this.children[0] || null; }
  get nextSibling() { return this.parent?.children[this.parent.children.indexOf(this) + 1] || null; }
  get isConnected() { return !!this.parent; }
  querySelector(selector) { const match = e => selector.startsWith('.') ? e.className.split(' ').includes(selector.slice(1)) : e.tag === selector; for (const child of this.children) { if (match(child)) return child; const found = child.querySelector(selector); if (found) return found; } return null; }
}
const h = (tag, props, ...children) => new Element(tag, props, ...children);
const failures = [];
async function test(name, run) { try { await run(); console.log('ok:', name); } catch (e) { failures.push(name); console.error('FAIL:', name, e.message); } }
await test('resident empty state clears on arrival and returns once on departure', () => {
  const residents = h('div'), state = { residents: [], world: {} };
  const context = vm.createContext({ state, els: { residents }, h, zoneOf: r => r.zone || 'village', sealed: () => false, makeResidentRow: r => h('div', { class: 'resident-row', text: r.name }), updateResidentRow() {} });
  vm.runInContext(source.slice(source.indexOf('  const residentRows ='), source.indexOf('  function makeResidentRow')), context);
  vm.runInContext('renderResidents()', context);
  assert.equal(residents.querySelector('.empty')?.textContent, 'No residents yet.');
  state.residents = [{ name: 'Test resident', zone: 'village' }];
  vm.runInContext('renderResidents()', context);
  assert.equal(Boolean(residents.querySelector('.empty')), false);
  assert.equal(residents.querySelector('.resident-row')?.textContent, 'Test resident');
  state.residents = [];
  vm.runInContext('renderResidents(); renderResidents()', context);
  assert.equal(residents.children.filter(el => el.className === 'empty').length, 1);
  assert.equal(residents.querySelector('.resident-row'), null);
});
function terminal(fetch, mock = false) {
  const root = h('div'), worker = { id: 'local:test', title: 'Synthetic task', status: 'running' }, closed = [];
  const start = source.indexOf('export function mountHeroTerminal('), end = source.indexOf('  if (mock) {', start);
  // Only mount the real terminal header: the remainder opens xterm/network resources irrelevant to End session.
  const context = vm.createContext({ h, navigator: { platform: 'MacIntel' }, fetch });
  vm.runInContext(source.slice(start, end).replace('export function', 'function') + '\n}', context);
  context.mountHeroTerminal(root, worker, { token: 'synthetic-token', mock, onClose: () => closed.push(true) });
  const header = root.querySelector('.terminal-header'), button = header.children.find(el => el.textContent === 'End session');
  return { root, button, closed, note: root.querySelector('.terminal-end-error') };
}
await test('failed HTTP End session stays open and shows error', async () => {
  const calls = [], ui = terminal(async (...args) => { calls.push(args); return { ok: false, status: 403, json: async () => ({ error: 'Request rejected' }) }; });
  await ui.button.onClick();
  assert.equal(ui.closed.length, 0);
  assert.equal(ui.note.hidden, false);
  assert.equal(ui.note.role, 'alert');
  assert.match(ui.note.textContent, /403|Request rejected/);
  assert.equal(ui.button.disabled, false);
  assert.equal(calls[0][0], '/api/term/local%3Atest/close');
  assert.equal(calls[0][1].method, 'POST');
  assert.equal(calls[0][1].headers['X-Amygdala-Token'], 'synthetic-token');
  assert.equal(calls[0][1].body, '{}');
});
await test('network End session failure stays open and shows error', async () => {
  const ui = terminal(async () => { throw new Error('Synthetic connection failure'); });
  await ui.button.onClick();
  assert.equal(ui.closed.length, 0);
  assert.equal(ui.note.hidden, false);
  assert.match(ui.note.textContent, /fail|reach|connection/i);
  assert.equal(ui.button.disabled, false);
});
await test('End session ignores duplicate clicks while pending, then closes on success', async () => {
  let resolve, calls = 0;
  const response = new Promise(r => { resolve = r; });
  const ui = terminal(() => { calls++; return response; });
  const first = ui.button.onClick();
  const second = ui.button.onClick();
  assert.equal(ui.button.disabled, true);
  assert.equal(calls, 1);
  resolve({ ok: true, status: 200 });
  await Promise.all([first, second]);
  assert.equal(ui.closed.length, 1);
});
await test('failed End session can retry successfully without stale error', async () => {
  let calls = 0;
  const ui = terminal(async () => ({ ok: ++calls > 1, status: calls === 1 ? 503 : 200 }));
  await ui.button.onClick();
  assert.equal(ui.closed.length, 0);
  assert.equal(ui.note.hidden, false);
  await ui.button.onClick();
  assert.equal(calls, 2);
  assert.equal(ui.closed.length, 1);
  assert.equal(ui.note.hidden, true);
});
await test('mock End session still closes without a request', async () => {
  const ui = terminal(() => { throw Error('Mock must not fetch'); }, true);
  await ui.button.onClick();
  assert.equal(ui.closed.length, 1);
});
assert.equal(failures.length, 0, `${failures.length} GUI correctness regressions: ${failures.join('; ')}`);
