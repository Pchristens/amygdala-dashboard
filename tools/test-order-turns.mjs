// v0.56: order turns get 15 minutes (a review needs room to read and answer); every other turn keeps the 6-minute cap.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { turnLimit } from '../lib/conductor.js';

assert.equal(turnLimit('order'), 15 * 60000);
for (const k of ['life', 'priest', 'temple', undefined]) assert.equal(turnLimit(k), 6 * 60000);
// agy's own print timeout follows the turn's limit, a minute short so the CLI ends before the conductor's kill.
const src = fs.readFileSync(new URL('../lib/conductor.js', import.meta.url), 'utf8');
assert.match(src, /'--print-timeout', ctx\.printTimeout \|\| '5m'/);
assert.match(src, /printTimeout: `\$\{turnLimit\(kind\) \/ 60000 - 1\}m`/);
assert.match(src, /Date\.now\(\) - t\.started > turnLimit\(t\.kind\)\) this\.abort\('timed out', t\)/);
console.log('order turns: 15 minutes for orders, 6 for everything else, agy timeout follows');
