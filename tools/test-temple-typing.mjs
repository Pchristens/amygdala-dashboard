import assert from 'node:assert/strict';
import { panelDocument } from './panel-dom.mjs';
import { createPanel } from '../public/panel.js';

// A live update must not rebuild the Temple under an open site picker; it applies once focus leaves (B06).
globalThis.document = panelDocument(); globalThis.window = {}; globalThis.requestAnimationFrame = fn => fn();
const panel = createPanel({ api: async () => ({}) });
const snap = title => ({ zones: [{ id: 'village' }], residents: [], posts: [], exhibits: [], sites: [{ id: 'forge', label: 'The Forge' }, { id: 'library', label: 'The Great Library' }],
  workers: [{ id: 'hero-a', title, status: 'running', tool: 'codex', project: 'work', host: 'local', site: 'forge' }] });
panel.update(snap('Ada'));
const workshop = document.getElementById('workshop');
const picker = workshop.querySelector('select.site-picker');
assert(picker, 'the hero card has a site picker');
picker.focus();
panel.update(snap('Ada renamed'));
assert(workshop.contains(picker), 'an update while the picker has focus keeps it in place');
assert.equal(document.activeElement, picker, 'focus stays on the picker');
assert(!workshop.textContent.includes('Ada renamed'), 'the update waits');
picker.blur();
await new Promise(resolve => setImmediate(resolve));
assert(workshop.textContent.includes('Ada renamed'), 'leaving the picker applies the latest update');
const button = workshop.querySelector('button'); button.focus();
panel.update(snap('Ada again'));
assert(workshop.textContent.includes('Ada again'), 'a focused button does not hold back an update');
console.log('temple typing: an open site picker survives live updates; leaving it applies the latest');
