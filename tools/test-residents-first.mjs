// Residents tab (C04): open petitions, then people, then one fold for visitors and passes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8'), panel = fs.readFileSync(new URL('../public/panel.js', import.meta.url), 'utf8');
const tab = html.slice(html.indexOf('id="tab-residents"'), html.indexOf('id="tab-workshop"'));
assert(tab.indexOf('id="petitions"') < tab.indexOf('id="residents"') && tab.indexOf('id="residents"') < tab.indexOf('id="gate"'), 'petitions, then residents, then visitor administration');
const petitions = panel.slice(panel.indexOf('  function renderPetitions('), panel.indexOf('  function renderGate()'));
// Petitions still get their decision: nothing shows when there are none, and Allow/Deny stay with each pending one.
assert.match(petitions, /if \(!petitions\.length\) return;/); assert.match(petitions, /text: 'Allow…', onClick: \(\) => petitionDecision\(p\)/); assert.match(petitions, /petitionDecision\(p, true\)/);
assert.doesNotMatch(petitions, /No petitions yet/);
// Finished petitions fold into one closed 'Earlier petitions' fold; only live ones show as full cards.
assert.match(petitions, /for \(const p of active\) root\.append\(petitionCard\(p\)\)/); assert.match(petitions, /`Earlier petitions \(\$\{history\.length\}\)`/);
assert.match(panel, /let petitionFoldOpen = false/); assert.match(petitions, /const live = \['pending', 'dispatching',/); assert.doesNotMatch(petitions, /\[\.\.\.active, \.\.\.history\]/);
const gate = panel.slice(panel.indexOf('  function renderGate()'), panel.indexOf('  let exhibitView'));
assert.match(gate, /summary', \{ text: 'Visitors & passes' \}/); assert.match(gate, /fold\.open = visitorFoldOpen/); assert.match(gate, /'Notify me'/);
assert(!/p\.question|p\.answer|p\.note/.test(gate), 'the visitors fold never shows petition text');
console.log('ok: residents first and administration folded');
