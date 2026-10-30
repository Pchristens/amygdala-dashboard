// The page offers no verdict on omens: the smith checks fixes and the High Priest confirms them.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Temple } from '../lib/temple.js';
const src = ['public/panel.js', 'public/app.js'].map(f => fs.readFileSync(f, 'utf8')).join('\n');
for (const s of ['Confirm fixed', "text: 'Decree'", "text: 'Set aside'", 'onFindingStatus', 'onDecreeMode']) assert(!src.includes(s), `page still offers ${s}`);
assert.match(src, /the smith checks the fix and the High Priest confirms it/);
// With no approve button, a saved approve mode or a parked decree must not strand anything (fi6569).
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amygdala-omens-'));
try {
  const world = { s: { decreeMode: 'approve', findings: [{ id: 'fi1', status: 'decreed', delivery: { state: 'awaiting approval', ts: 1 } }] }, changed() {} };
  const t = new Temple(world, dir);
  assert.equal(world.s.decreeMode, 'auto');
  assert.equal(world.s.findings[0].delivery.state, 'failed');
  assert.throws(() => t.setDecreeMode('approve'));
  t.setDecreeMode('auto');
  assert(!fs.readFileSync('lib/temple.js', 'utf8').includes("state: 'awaiting approval'"));
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
console.log('omen buttons ok');
