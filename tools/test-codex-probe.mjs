// The Codex reading is probed every minute: it reads the newest session log's tail, falls back to the whole file when the
// tail holds no rate_limits record, and skips a log that hasn't changed. Synthetic logs in a temporary HOME only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'amygdala-codex-')); process.env.HOME = home; process.env.USERPROFILE = home;
const { probeCodex } = await import('../lib/fleet.js');
const dir = path.join(home, '.codex/sessions/2026/10/29'); fs.mkdirSync(dir, { recursive: true });
const rec = pct => JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', rate_limits: { primary: { used_percent: pct, window_minutes: 300, resets_at: 1893456000 }, secondary: { used_percent: 40, window_minutes: 10080, resets_at: 1893999000 } } } });
const log = path.join(dir, 'rollout-a.jsonl');
try {
  fs.writeFileSync(log, [rec(10), rec(37)].join('\n') + '\n');
  const a = await probeCodex(); assert.equal(a.windows[0].used_percentage, 37); assert.equal(a.windows[1].used_percentage, 40);
  assert.equal(await probeCodex(), a); // unchanged log: the cached reading, no re-read
  // The newest record wins even past a megabyte of other events, and an older record alone (pushed out of the tail) is still found.
  fs.appendFileSync(log, 'x'.repeat(2 << 20) + '\n' + rec(64) + '\n'); fs.utimesSync(log, new Date(), new Date(Date.now() + 1000));
  assert.equal((await probeCodex()).windows[0].used_percentage, 64);
  fs.appendFileSync(log, JSON.stringify({ type: 'big', text: 'y'.repeat(2 << 20) }) + '\n'); fs.utimesSync(log, new Date(), new Date(Date.now() + 2000));
  assert.equal((await probeCodex()).windows[0].used_percentage, 64);
  // Both schedulers probe every minute.
  assert.match(fs.readFileSync(new URL('../lib/usage.js', import.meta.url), 'utf8'), /probeCodex, p => this\.mergeCodex\(p\)\), 60000\)/);
  assert.match(fs.readFileSync(new URL('./amygdala-node.mjs', import.meta.url), 'utf8'), /Date\.now\(\) - lastCodex > 60000/);
  console.log('codex probe ok: tail read, whole-file fallback, unchanged log cached, probed every minute');
} finally { fs.rmSync(home, { recursive: true, force: true }); }
