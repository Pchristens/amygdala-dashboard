import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
// The preview fixture generator builds a synthetic human snapshot: the requested number of resting heroes reach `hall`,
// nothing in it belongs to the isle, and no real session or path leaks in (every hero is invented under /tmp).
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amygdala-mock-test-')), out = path.join(dir, 'mock-state.json');
try {
  execFileSync(process.execPath, [new URL('./mock-state.mjs', import.meta.url).pathname, '--hall', '7', '--out', out], { stdio: 'pipe' });
  const s = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(s.hall.length, 7); assert.equal(s.workers.length, 3);
  assert(s.hall.every(w => w.status === 'stopped' && w.site && ['forge', 'library', 'quarry', 'temple'].includes(w.site)));
  assert(!s.workers.some(w => w.status === 'stopped' || w.archived));
  for (const k of ['hall', 'workers', 'residents']) assert(!s[k].some(x => x.zone === 'isle' || x.isleTagged || x.sealed || x.quarantined), `${k} stays off the isle`);   // places keep the default isle landmarks
  assert(s.places.some(p => p.id === 'hall' && p.kind === 'hall')); assert.equal(s.world.sun, null);
  // The Temple fixture: open and closed offerings, findings in every state, counsel and audits, all invented and all in the village.
  assert(s.offerings.some(o => o.status === 'open') && s.offerings.some(o => o.status === 'closed') && s.offerings.some(o => o.kind === 'scroll'));
  for (const st of ['open', 'omen', 'decreed', 'fixed', 'rejected']) assert(s.findings.some(f => f.status === st), `a ${st} finding`);
  assert(s.counsel.some(c => c.status === 'new') && s.audits.length && s.steward && s.auditSettings);
  for (const k of ['offerings', 'findings', 'counsel']) assert(s[k].every(x => x.zone === 'village' && !x.path?.startsWith('/home')), `${k} invented, in the village`);
  console.log('mock-state: synthetic fixture shape, hall count and isle filtering passed');
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
