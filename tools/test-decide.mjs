// The human's Decide… button: it shows on offerings awaiting a ruling and on escalations, and sends the final decision.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { panelDocument } from './panel-dom.mjs';
import { h } from '../public/util.js';

globalThis.document = panelDocument();
const { createPanel } = await import('../public/panel.js');
const decided = [];
const panel = createPanel({ onDecide: r => decided.push(r.offeringId) });
const governance = { wakes: { used: 0 }, verified: true, ledger: [],
  pending: [{ offeringId: 'of1', title: 'Synthetic', project: 'p', sha: 'abc', state: 'pending', reasons: [] }],
  digest: [{ offeringId: 'of2', project: 'p', sha: 'def', text: 'only you can override it', escalation: true }, { offeringId: 'of3', project: 'p', sha: '012', text: 'asked for evidence', escalation: false }] };
panel.update({ workers: [], residents: [], counsel: [], sites: [], world: {}, governance });
const buttons = document.getElementById('workshop').querySelectorAll('.gov-decide');
assert.equal(buttons.length, 2, 'one for the pending offering, one for the escalation, none for a plain note');
for (const b of buttons) b.dispatchEvent({ type: 'click', stopPropagation() {} });
assert.deepEqual(decided.sort(), ['of1', 'of2']);

// The dialog: a reason is required, then one call to the override route with the chosen verdict.
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const els = { 'decide-dialog': h('dialog'), 'decide-reason': h('textarea'), 'decide-error': h('div'), 'decide-title': h('h2'), 'decide-sub': h('div') };
const accept = h('button'), reject = h('button'); accept.dataset.verdict = 'accept'; reject.dataset.verdict = 'reject';
let shown = 0, closed = 0; Object.assign(els['decide-dialog'], { showModal() { shown++; }, close() { closed++; }, querySelectorAll: () => [reject, accept] });
els['decide-reason'].focus = () => {};
const calls = [], toasts = [];
const ctx = vm.createContext({ $: id => els[id], api: async (...a) => { calls.push(a); return { ok: true }; }, okResult: r => r === true || (r && r.ok !== false), toast: t => toasts.push(t) });
vm.runInContext(app.slice(app.indexOf('function openDecide('), app.indexOf('function updateEndLabour(')), ctx);
ctx.openDecide({ offeringId: 'of1', title: 'Synthetic', project: 'p', sha: 'abc' });
assert.equal(shown, 1);
els['decide-reason'].value = 'too short'; await accept.onclick();
assert.equal(calls.length, 0, 'no decision without a reason'); assert.equal(els['decide-error'].hidden, false);
els['decide-reason'].value = 'Reviewed it myself; ship it.'; await accept.onclick();
assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['/api/governance/override', { offeringId: 'of1', verdict: 'accept', reason: 'Reviewed it myself; ship it.' }]]);
assert.equal(closed, 1); assert.match(toasts[0], /Accepted/);
assert(fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8').includes('id="decide-dialog"'));
// v0.75: a Wake button for the High Priest sits on the box, counts what waits for her, and calls the wake route.
const woken = [], wakePanel = createPanel({ api: async (path, body) => { woken.push(path); return { ok: true, resident: 'Themis', offerings: 1 }; } });
wakePanel.update({ workers: [], residents: [], counsel: [], sites: [], world: {}, offerings: [{ id: 'of1', title: 'Synthetic', project: 'p', status: 'open', zone: 'village', createdAt: 1 }], governance: { ...governance, priest: 'Themis', wakes: { used: 0, autoAt: 5, maxWaitHours: 12 } } });
const bar = [...document.getElementById('workshop').querySelectorAll('.gov-wake-bar')].at(-1); assert(bar, 'the Wake button sits under the Offerings heading'); const wake = bar.querySelector('button');
assert.equal(wake.textContent, 'Wake Themis (1)'); await wake.onclick?.() ?? wake.dispatchEvent({ type: 'click', stopPropagation() {} }); await new Promise(setImmediate);
assert.deepEqual(woken, ['/api/governance/wake']);
console.log('decide ok');
