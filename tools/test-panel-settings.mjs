import assert from 'node:assert/strict';
import { panelDocument } from './panel-dom.mjs';
import { createPanel } from '../public/panel.js';

globalThis.document = panelDocument();
globalThis.window = {};
globalThis.requestAnimationFrame = fn => fn();
const calls = [], panel = createPanel({ api: async (path, body) => { calls.push({ path, body }); return { ok: true }; } });
const initial = { zones: [{ id: 'village' }], residents: [], workers: [], posts: [], exhibits: [], tales: [], audits: [],
  steward: { enabled: true, festivalEnabled: false, idleHours: 2, sevenDayHours: 3, sevenDaySpare: 25, fiveHourHours: 1, fiveHourSpare: 15 },
  auditSettings: { enabled: true, tier1: '', tier2: '', dailyCap: 10, optOut: [] }, taleSettings: { minHours: 4, minFixed: 3, minCommits: 2 } };
const field = name => document.querySelector(`[aria-label="${name}"]`);
// Number inputs do not expose a browser selection API. The harness models the caret reset caused by value assignment;
// retaining the same mounted element without assigning its value also retains the browser's native numeric draft.
const edit = (input, value) => { input.focus(); input.value = value; input.dispatchEvent({ type: 'input', bubbles: true }); input.setSelectionRange(1, 2); };
panel.update(structuredClone(initial));
const idle = field('Human idle hours');
edit(idle, '12.5');
const updated = structuredClone(initial); updated.steward.idleHours = 6; updated.steward.sevenDayHours = 8; updated.auditSettings.dailyCap = 12;
panel.update(updated);
assert.ok(field('Human idle hours') === idle, 'snapshot must retain the edited Settings element');
assert.ok(document.activeElement === idle, 'snapshot must retain Settings focus');
assert.equal(idle.value, '12.5', 'snapshot must retain the Settings draft');
assert.deepEqual([idle.selectionStart, idle.selectionEnd], [1, 2], 'snapshot must not assign the draft value or move its caret');
assert.equal(field('Weekly hours left').value, '8', 'untouched Steward setting must update');
assert.equal(field('Daily audit run cap').value, '12', 'untouched Watchtower setting must update');
assert.equal(calls.length, 0, 'rendering a snapshot must not save settings');
idle.dispatchEvent({ type: 'change' });
assert.deepEqual(calls.at(-1), { path: '/api/steward/settings', body: { idleHours: 12.5 } }, 'retained handler must save the edited value');
idle.blur(); panel.update(updated);
assert.equal(idle.value, '6', 'server value must resume after editing ends');
idle.focus();
const untouched = structuredClone(updated); untouched.steward.idleHours = 9; panel.update(untouched);
assert.ok(document.activeElement === idle, 'focused but untouched setting must keep focus');
assert.equal(idle.value, '9', 'focused but untouched setting must receive server updates');
idle.blur();

const hours = field('Hours worked'); edit(hours, '10.5');
const latest = structuredClone(updated); latest.taleSettings.minHours = 7; latest.taleSettings.minCommits = 9;
panel.update(latest);
assert.ok(field('Hours worked') === hours, 'Tales settings must retain edited element');
assert.ok(document.activeElement === hours);
assert.equal(hours.value, '10.5');
assert.deepEqual([hours.selectionStart, hours.selectionEnd], [1, 2]);
assert.equal(field('Commits').value, '9', 'untouched Tales threshold must update');
hours.dispatchEvent({ type: 'change' });
assert.deepEqual(calls.at(-1), { path: '/api/tales/settings', body: { minHours: 10.5 } });
hours.blur(); panel.update(latest); assert.equal(hours.value, '7');

const cap = field('Daily audit run cap'); edit(cap, '25'); panel.update(latest);
assert.ok(document.activeElement === cap); assert.equal(cap.value, '25');
cap.dispatchEvent({ type: 'change' });
assert.deepEqual(calls.at(-1), { path: '/api/audit/settings', body: { dailyCap: 25 } });
cap.blur(); panel.update(latest); assert.equal(cap.value, '12');

// Live sections, logs and selector choices must still refresh around a mounted editor.
const roster = [{ name: 'Reviewer A', role: 'examiner', model: 'test', agent: 'codex', zone: 'village' }, { name: 'Reviewer B', role: 'smith', model: 'test', agent: 'claude', zone: 'village' }];
const withRoster = { ...latest, residents: roster, auditSettings: { ...latest.auditSettings, tier1: 'Reviewer A', tier2: 'smith' } };
panel.update(withRoster);
const reviewer = field('First reviewer'); assert.equal(reviewer.value, 'examiner', 'stored name must still resolve to its unique role');
reviewer.focus();
const changedReviewer = { ...withRoster, auditSettings: { ...withRoster.auditSettings, tier1: 'smith' } };
panel.update(changedReviewer);
assert.ok(field('First reviewer') === reviewer && document.activeElement === reviewer);
assert.equal(reviewer.value, 'smith', 'focused untouched select must update');
reviewer.value = 'examiner'; reviewer.dispatchEvent({ type: 'input' }); panel.update(changedReviewer);
assert.equal(reviewer.value, 'examiner', 'focused edited select must retain its selection');
reviewer.dispatchEvent({ type: 'change' });
assert.deepEqual(calls.at(-1), { path: '/api/audit/settings', body: { tier1: 'examiner' } });
reviewer.blur();
const checkboxes = document.getElementById('fold-settings').querySelectorAll('[type="checkbox"]');
checkboxes[0].checked = false; checkboxes[0].dispatchEvent({ type: 'change' });
assert.deepEqual(calls.at(-1), { path: '/api/steward/settings', body: { enabled: false } });
panel.update({ ...withRoster, steward: { ...withRoster.steward, enabled: true } }); assert.equal(checkboxes[0].checked, true);
edit(cap, '30');
const partial = { ...withRoster, steward: null, audits: [{ zone: 'village', severity: 'low', rule: 'test', status: 'pending', excerpt: 'Synthetic audit update' }] };
panel.update(partial);
assert.ok(field('Daily audit run cap') === cap && document.activeElement === cap);
assert.equal(field('Human idle hours'), null);
assert.match(document.getElementById('workshop').textContent, /Synthetic audit update/);
panel.update(withRoster);
assert.ok(document.activeElement === cap, 'restoring a sibling settings section must not detach the focused field');
assert.equal(document.getElementById('workshop').lastChild.getAttribute('id'), 'fold-settings');
assert.equal(document.querySelectorAll('[aria-label="Daily audit run cap"]').length, 1);
cap.blur();
const noSettings = { ...latest, steward: null, auditSettings: null, taleSettings: null };
panel.update(noSettings);
assert.equal(field('Human idle hours'), null); assert.equal(field('Hours worked'), null);
console.log('panel settings: snapshot retains edited focus, draft and caret; untouched fields update; save payloads unchanged');
