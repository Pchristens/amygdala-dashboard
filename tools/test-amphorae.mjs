// Oil amphorae: Antigravity's pools are separate allowances, one amphora each (a spent Claude-and-GPT pool used by no
// resident once showed Antigravity at 0% while Gemini had 85% left); single-pool providers keep one amphora.
import assert from 'node:assert/strict';
import { amphorae } from '../public/util.js';
const agy = { id: 'antigravity', label: 'Antigravity', windows: [
  { pool: 'Gemini Models', label: 'Gemini Models · Weekly', kind: 'seven_day', used_percentage: 15 },
  { pool: 'Gemini Models', label: 'Gemini Models · Five Hour', kind: 'five_hour', used_percentage: 12 },
  { pool: 'Claude and GPT models', label: 'Claude and GPT models · Weekly', kind: 'seven_day', used_percentage: 100 },
  { pool: 'Gemini 4 Argon', label: 'Gemini 4 Argon · Gemini 4 Argon Weekly Limit', kind: 'seven_day', used_percentage: 89 }] };
const a = amphorae(agy);
assert.deepEqual(a.map(x => [x.label, x.remaining]), [['Antigravity · Gemini Models', 85], ['Antigravity · Claude and GPT models', 0], ['Antigravity · Gemini 4 Argon', 11]]);
assert.deepEqual(a[0].windows.map(w => w.label), ['Weekly', 'Five Hour']);
// One pool: the fullest window sets the level, labels untouched; missing or bad readings are skipped.
const claude = amphorae({ id: 'claude', label: 'Claude', windows: [{ kind: 'five_hour', label: '5h', used_percentage: 10 }, { kind: 'seven_day', label: '7d', used_percentage: 42 }, { kind: 'x', used_percentage: null }] });
assert.deepEqual(claude.map(x => [x.label, x.remaining, x.windows.length]), [['Claude', 58, 2]]);
assert.deepEqual(amphorae({ id: 'grok', windows: [] }), [{ label: 'grok', remaining: null, windows: [] }]);
console.log('amphorae ok');
