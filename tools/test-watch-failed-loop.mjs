// A failing Watch turn must not wake the Watch again at once: turn-failed is one event per resident per two hours.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Watch } from '../lib/watch.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amygdala-watch-loop-'));
const w = { s: {}, changed() {}, actsAs: (n, role) => n === 'Ione' && role === 'watch', dutyHolder: () => ({ name: 'Ione' }), contextTurn: () => null, steward: null };
const duties = [], c = { running: new Map(), turn: null, duty: (...a) => { duties.push(a); return true; } };
const watch = new Watch(w, c, dir, { start: false });
// Each failed Watch turn ends with completed() then turnEnded(), as conductor.finish does; the stub stands in for the CLI failing at once.
let started = Date.now();
for (let i = 0; i < 50; i++) { watch.completed('Ione'); watch.turnEnded({ name: 'Ione', started: started++, zone: 'village' }, 'failed'); }
assert.equal(duties.length, 1, 'fifty failed Watch turns wake the Watch once, not fifty times');
assert.equal(w.s.watch.pending.filter(e => e.key.startsWith('turn-failed:')).length <= 1, true);
// Another resident's failure is still its own event.
watch.completed('Ione'); watch.turnEnded({ name: 'Themis', started: started++, zone: 'village' }, 'error');
assert.equal(duties.length, 2); assert.deepEqual(w.s.watch.pending.map(e => e.key), ['turn-failed:Themis']);
// After the window the same resident can raise again.
watch.raise('turn-failed', 'Ione', 'village', 'x', Date.now() + 2 * 3600000 + 1); assert(w.s.watch.pending.some(e => e.key === 'turn-failed:Ione'));
// Successful turns raise nothing.
const before = w.s.watch.pending.length; watch.turnEnded({ name: 'Wren', started: 1, zone: 'village' }, 'ok'); assert.equal(w.s.watch.pending.length, before);
fs.rmSync(dir, { recursive: true, force: true });
console.log('watch failed-turn loop ok');
