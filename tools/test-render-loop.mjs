// The 3D loop: a redraw the fps cap skips must keep the RAF chain alive, or a click on a still map waits for the
// ambient timer (up to Q.ambientMs) instead of the next frame.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../public/map3d.js', import.meta.url), 'utf8');
const tick = src.slice(src.indexOf('  function tick('), src.indexOf('  let viewAnim = null'));
assert(/render\(frameMotion \|\| needsRender\); needsRender = false;/.test(tick), 'needsRender clears only when a frame renders');
const chain = tick.match(/if \(([^)]*)\) requestAnimationFrame\(tick\);\s*else \{ running = false;/);
assert(chain, 'the loop ends its RAF chain in one place');
assert(chain[1].split('||').map(s => s.trim()).includes('needsRender'), 'a pending redraw keeps the RAF chain alive');
console.log('render loop ok');
