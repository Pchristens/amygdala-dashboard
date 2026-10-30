// The page offers no verdict on omens: the smith checks fixes and the High Priest confirms them.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const src = ['public/panel.js', 'public/app.js'].map(f => fs.readFileSync(f, 'utf8')).join('\n');
for (const s of ['Confirm fixed', "text: 'Decree'", "text: 'Set aside'", 'onFindingStatus', 'onDecreeMode']) assert(!src.includes(s), `page still offers ${s}`);
assert.match(src, /the smith checks the fix and the High Priest confirms it/);
console.log('omen buttons ok');
