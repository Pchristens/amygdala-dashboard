// Check the feed's empty state and accessible disclosure state without a browser.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const panel = fs.readFileSync(new URL('../public/panel.js', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const residents = panel.slice(panel.indexOf('  function renderResidents()'), panel.indexOf('  function makeResidentRow', panel.indexOf('  function renderResidents()')));
assert.match(residents, /if \(list\.length\) els\.residents\.querySelector\('\.empty'\)\?\.remove\(\)/);
assert.match(residents, /else if \(!els\.residents\.querySelector\('\.empty'\)\) els\.residents\.appendChild/);
assert.match(html.match(/<button[^>]*class="happening-title"[^>]*>/)?.[0] || '', /aria-controls="happening-list"/);
assert.match(html, /<ol id="happening-list"/);
const button = { attrs: { 'aria-controls': 'happening-list' }, listeners: {}, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(k, f) { this.listeners[k] = f; } };
const classes = new Set();
const hp = { querySelector: () => button, classList: { toggle(k) { classes.has(k) ? classes.delete(k) : classes.add(k); }, contains: k => classes.has(k), add: k => classes.add(k) } };
const prefs = { feed: 'collapsed' };
const context = vm.createContext({
  $: id => id === 'happening' ? hp : null,
  loadPref: () => prefs,
  savePref: value => Object.assign(prefs, value),
  button,
});
const start = app.indexOf('// ---------- Happening now ----------')
const end = app.indexOf('const happeningList =', start);
vm.runInContext(app.slice(start, end), context);
assert.equal(button.attrs['aria-controls'], 'happening-list');
assert.equal(button.attrs['aria-expanded'], 'false');
button.listeners.click();
assert.equal(button.attrs['aria-expanded'], 'true');
assert.equal(prefs.feed, 'open');
button.listeners.click();
assert.equal(button.attrs['aria-expanded'], 'false');
assert.equal(prefs.feed, 'collapsed');
