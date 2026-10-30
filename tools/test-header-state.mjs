import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const panel = fs.readFileSync(new URL('../public/panel.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

assert.match(html, /id="needs-chip"/);
assert.doesNotMatch(html, /id="(?:omen-chip|counsel-chip)"/);
assert.match(app, /btn\.textContent = w\.paused \? 'Paused · Resume' : 'Pause'/);
assert.match(app, /btn\.classList\.toggle\('btn-primary', !!w\.paused\)/);
assert.match(app, /b\.hidden = !n; \$\('needs-chip-text'\)\.textContent = `\$\{n\} need you`/);
assert.match(app, /status-text'\)\.textContent = st === 'expired' \? 'Session expired — reload' : st === 'reconnecting' \? 'reconnecting…' : MOCK \? 'live \(mock\)' : 'live'/);
assert.doesNotMatch(app.match(/\$\('status-text'\)\.textContent = ([^\n]+)/)?.[1] || '', /paused/);
assert.match(app, /village-state'\)\.textContent = "Idle — everyone's resting"/);
assert.match(app, /onNeedsCount: \(n\) => \{[\s\S]*needs-chip/);
assert.match(app, /lg\.hidden = guidance === 'normal'/);
assert.match(app, /\$\('pop'\)\.title = `\$\{residents\.length\} residents · \$\{workers\.length\} heroes`/);
console.log('ok: header state and attention source');

// The count is the village's: it holds in the isle view and keeps up while the Temple waits for typing (Themis residual on 4785191).
{
  const { panelDocument } = await import('./panel-dom.mjs'); const { createPanel } = await import('../public/panel.js');
  globalThis.document = panelDocument(); globalThis.window = {}; globalThis.requestAnimationFrame = fn => fn();
  const counts = []; const ui = createPanel({ api: async () => ({}), onNeedsCount: n => counts.push(n) });
  const snap = status => ({ zones: [{ id: 'village' }, { id: 'isle' }], residents: [], posts: [], exhibits: [], sites: [{ id: 'forge', label: 'The Forge' }],
    workers: [{ id: 'hero-a', title: 'Ada', status, needsPermission: true, tool: 'codex', project: 'work', host: 'local', site: 'forge' }] });
  const idle = snap('waiting'); idle.workers[0].needsPermission = false; ui.update(idle); assert.equal(counts.at(-1), 0, 'idle waiting heroes do not count');
  ui.update(snap('waiting')); assert.equal(counts.at(-1), 1, 'a village permission prompt counts');
  ui.setZone('isle'); ui.update(snap('waiting')); assert.equal(counts.at(-1), 1, 'the isle view keeps the village count');
  ui.setZone('village'); ui.update(snap('running'));
  const picker = document.getElementById('workshop').querySelector('select.site-picker'); picker.focus();
  ui.update(snap('waiting')); assert.equal(counts.at(-1), 1, 'the count updates while the Temple waits for typing');
}
