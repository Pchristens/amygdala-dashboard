import assert from 'node:assert/strict';
import { panelDocument } from './panel-dom.mjs';
import { createPanel } from '../public/panel.js';
import { readFileSync } from 'node:fs';

globalThis.document = panelDocument(); globalThis.window = {}; globalThis.requestAnimationFrame = fn => fn();
const panel = createPanel({ api: async () => ({}) });
panel.update({ zones: [{ id: 'village' }], residents: [], posts: [], exhibits: [], sites: [
  { id: 'temple', label: 'The Temple' }, { id: 'library', label: 'The Great Library' }, { id: 'forge', label: 'The Forge' },
], workers: [
  { id: 'hero-a', title: 'Ada', status: 'waiting', needsPermission: true, tool: 'claude', project: 'work', host: 'local', site: 'library' },
  { id: 'hero-b', title: 'Bela', status: 'running', tool: 'codex', project: 'work', host: 'local', site: 'forge' },
], counsel: [{ id: 'c1', workerId: 'hero-a', status: 'new' }] });
const workshop = document.getElementById('workshop');
const groups = workshop.querySelectorAll('.site-group');
assert.deepEqual(groups.map(g => g.querySelector('.host-title').textContent.replace(/^[^A-Za-z]+/, '')), ['The Great Library', 'The Forge'], 'occupied sites come first and empty site groups are omitted');
assert.match(workshop.textContent, /Empty: The Temple/);
assert.equal(workshop.querySelectorAll('.site-empty').length, 1);
assert(!workshop.textContent.includes('nobody here'));
const needs = workshop.querySelector('.needs-you'), row = needs.querySelector('button.need-hero');
assert(row, 'permission prompt attention entry is a compact button');
assert.match(row.textContent, /1 counsel/);
assert.equal(row.querySelector('.worker-row'), null, 'needs-you does not duplicate the full hero card');
const canonical = groups[0].querySelector('.worker-row');
row.dispatchEvent({ type: 'click', bubbles: true });
assert(canonical.classList.contains('flash'), 'attention entry flashes the canonical card');
assert(/\.worker-row\.flash/.test(readFileSync(new URL('../public/style.css', import.meta.url), 'utf8')), 'the flash is styled on hero cards, not only resident rows');
console.log('temple sites: active sites first, empty sites compact, waiting hero links to canonical card');
