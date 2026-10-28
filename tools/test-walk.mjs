// Walkable surfaces (public/walk3d.js): stairs, podiums, roofs and props, from hand-built boxes (no three.js needed).
import assert from 'node:assert/strict';
import { WalkSurface, settle } from '../public/walk3d.js';

// A box as 12 world-space triangles, the shape Builder.box hands to the bake (non-indexed positions).
function box(x, y, z, w, h, d) {
  const X = [x - w / 2, x + w / 2], Y = [y, y + h], Z = [z - d / 2, z + d / 2], v = (i, j, k) => [X[i], Y[j], Z[k]];
  const quads = [[v(0, 1, 0), v(1, 1, 0), v(1, 1, 1), v(0, 1, 1)], [v(0, 0, 0), v(0, 0, 1), v(1, 0, 1), v(1, 0, 0)], [v(0, 0, 0), v(1, 0, 0), v(1, 1, 0), v(0, 1, 0)],
    [v(0, 0, 1), v(0, 1, 1), v(1, 1, 1), v(1, 0, 1)], [v(0, 0, 0), v(0, 1, 0), v(0, 1, 1), v(0, 0, 1)], [v(1, 0, 0), v(1, 0, 1), v(1, 1, 1), v(1, 1, 0)]];
  const out = []; for (const [a, b, c, e] of quads) out.push(...a, ...b, ...c, ...a, ...c, ...e);
  return { attributes: { position: { array: new Float32Array(out) } } };
}
const ground = () => 0;
const parts = [
  // A podium 6 high with three 2-high treads on its south side (z 20..26), each box rising from the ground.
  box(0, 0, 0, 40, 6, 40), box(0, 0, 22, 10, 4, 4), box(0, 0, 24, 10, 2, 4),
  // A stoa on the podium: a roof slab 20 above the floor over x -20..-10.
  box(-15, 26, 0, 10, 1, 40),
  // A low table on the podium (top 3 above the floor) and a low kerb on open ground.
  box(10, 6, 10, 4, 3, 4), box(60, 0, 0, 2, 1.2, 20),
];
const walk = new WalkSurface(ground, { clear: 8 }).addGeometries(parts);

// Climbing the stair: each tread in turn, then the podium.
assert.equal(walk.heightAt(0, 30), 0);                 // in front of the stair
assert.equal(walk.heightAt(0, 25), 2);                 // first tread
assert.equal(walk.heightAt(0, 21), 4);                 // second tread
assert.equal(walk.heightAt(0, 10), 6);                 // podium top
// Under the roof: the floor, never the roof, whatever height it was near.
assert.equal(walk.heightAt(-15, 0), 6); assert.equal(walk.heightAt(-15, 0, 27), 27); // a figure already on the roof stays there
assert.equal(walk.heightAt(-15, 0, 6), 6);
// Buried ground under the podium is never chosen, even from below.
assert.equal(walk.heightAt(5, 5, 0), 6);
// A table on the floor: there's no headroom to stand on the floor under it, so the figure stands on it.
assert.equal(walk.heightAt(10, 10, 6), 9);
// A low kerb on open ground is stepped onto; open ground elsewhere is the terrain.
assert(Math.abs(walk.heightAt(60, 0, 0) - 1.2) < 1e-6); assert.equal(walk.heightAt(100, 100), 0);
// Off any building, the terrain function is used as is.
assert.equal(new WalkSurface((x, z) => x * 0.1).addGeometries([]).heightAt(30, 0), 3);

// Settling: a first placement snaps; then the height eases at a bounded rate both ways.
const rec = {};
assert.equal(settle(rec, 6, 0.016), 6);
const up = settle(rec, 8, 0.016); assert(up > 6 && up < 8);
for (let i = 0; i < 60; i++) settle(rec, 8, 0.016); assert.equal(rec.wy, 8);
assert.equal(settle(rec, 100, 0.016), 100);           // a teleport (zone change, sail) snaps
console.log('walk surfaces ok');
