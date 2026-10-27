// Seals made before the rename carry the 'hearthfield' check value and must still unlock.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { Seal } from '../lib/seal.js';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amygdala-seal-'));
const world = () => ({ s: { residents: {} }, activeTurn: null, zoneOf: () => 'village', addFeed() {}, changed() {}, refreshWorkers() {}, trees: { ensure() {} }, temple: { migrateSnapshots() {} } });
const make = ok => {
  const s = new Seal(world(), dir), salt = 'c2FsdHNhbHRzYWx0c2FsdA==', key = s.derive('correct horse', salt);
  fs.writeFileSync(path.join(dir, 'seal.json'), JSON.stringify({ v: 1, salt, check: s.encrypt({ ok }, key) })); clearInterval(s.timer);
};
for (const ok of ['hearthfield', 'amygdala']) {
  make(ok); const s = new Seal(world(), dir); clearInterval(s.timer);
  assert.throws(() => s.unlock('wrong pass!'), /does not break/);
  s.unlock('correct horse'); assert.ok(!s.locked, `${ok} seal unlocks`);
}
make('something-else'); { const s = new Seal(world(), dir); clearInterval(s.timer); assert.throws(() => s.unlock('correct horse'), /does not break/); }
fs.rmSync(dir, { recursive: true, force: true });
console.log('seal legacy ok');
