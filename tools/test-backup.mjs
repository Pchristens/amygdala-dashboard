import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { World } from '../lib/world.js';
import { Usage } from '../lib/usage.js';
// No external provider processes in this unit test.
Usage.prototype.pollDeck = () => {};
Usage.prototype.probe = () => {};
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearthfield-backup-'));
let w;
try {
  const config = [{ name: 'Lyra', agent: 'antigravity', model: 'gemini-4-argon-medium', backup: 'claude-opus-5-5-medium', persona: 'p' }, { name: 'Iris', agent: 'claude', model: 'claude-haiku-5-5', persona: 'p' }];
  const file = path.join(dir, 'residents.json');
  fs.writeFileSync(file, JSON.stringify(config));
  w = new World(dir, config, file);
  // Real window labels: Argon's own pool, and agy's separate Claude/GPT pool.
  const pools = { argon: 0, claude: 0 };
  const set = () => w.usage.setProvider({ id: 'antigravity', windows: [
    { kind: 'seven_day', label: 'Gemini 4 Argon · Weekly', used_percentage: pools.argon },
    { kind: 'seven_day', label: 'Claude and GPT models · Weekly', used_percentage: pools.claude }] });
  set();
  assert.equal(w.usage.providerPressure('google', 'claude-opus-5-5-medium'), 0);
  assert(!w.isHibernating('Lyra')); assert.equal(w.cfg('Lyra').model, 'gemini-4-argon-medium');

  // Argon hot: Opus (via agy) takes the wheel; lineage follows it, the allowance stays Antigravity's.
  pools.argon = 85; set();
  assert(!w.isHibernating('Lyra'));
  assert.equal(w.cfg('Lyra').model, 'claude-opus-5-5-medium');
  assert.equal(w.temple.providerOf('Lyra'), 'anthropic');
  assert.match(w.s.feed.at(-1).text, /hands the wheel to claude-opus-5-5-medium/);
  const snap = w.snapshot().residents.find(r => r.name === 'Lyra');
  assert.equal(snap.model, 'claude-opus-5-5-medium'); assert.equal(snap.primaryModel, 'gemini-4-argon-medium'); assert(snap.onBackup);

  // Never mid-turn.
  w.beginTurn('Lyra', 't'); pools.argon = 10; set(); w.isHibernating('Lyra');
  assert.equal(w.cfg('Lyra').model, 'claude-opus-5-5-medium');
  w.endTurn('Lyra');

  // Hysteresis: Argon at 77 stays resting; below 75 it takes the wheel back.
  pools.argon = 77; set(); w.isHibernating('Lyra'); assert.equal(w.cfg('Lyra').model, 'claude-opus-5-5-medium');
  pools.argon = 70; set(); w.isHibernating('Lyra'); assert.equal(w.cfg('Lyra').model, 'gemini-4-argon-medium');
  assert.equal(w.temple.providerOf('Lyra'), 'google');
  assert.match(w.s.feed.at(-1).text, /takes back the wheel/);

  // Both pools hot: she hibernates.
  pools.argon = 90; pools.claude = 90; set();
  assert(w.isHibernating('Lyra'));

  // A rename never persists the backup as the primary model.
  pools.argon = 85; pools.claude = 0; set(); w.isHibernating('Lyra');
  assert.equal(w.cfg('Lyra').model, 'claude-opus-5-5-medium');
  w.s.residents.Lyra.pendingNaming = true;
  w.chooseName('Lyra', { name: 'Lyria', reason: 'test' });
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.find(c => c.name === 'Lyria').model, 'gemini-4-argon-medium');
  console.log('PASS: backup model takes the wheel when the primary pool is hot, lineage follows it, not mid-turn, hysteresis, both hot hibernates, renames keep the primary');
} finally {
  if (w) { clearTimeout(w.saveTimer); clearInterval(w.seal.timer); }
  fs.rmSync(dir, { recursive: true, force: true });
}
