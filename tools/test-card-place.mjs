import assert from 'node:assert/strict';
import { placeCard } from '../public/card-place.js';

const size = { w: 200, h: 100 }, bounds = { left: 0, top: 64, right: 500, bottom: 400 };
const result = placeCard({ above: { x: 250, y: 200 }, below: { x: 250, y: 200 }, size, bounds });
assert.deepEqual(result, { left: 250, top: 200, below: false, docked: false });
assert.equal(placeCard({ above: { x: 250, y: 80 }, below: { x: 250, y: 90 }, size, bounds }).below, true);
assert.equal(placeCard({ above: { x: 250, y: 80 }, below: { x: 250, y: 90 }, size, bounds }).top >= 64, true);
const drawer = placeCard({ above: { x: 400, y: 250 }, below: { x: 400, y: 250 }, size, bounds, obstacles: [{ left: 350, top: 64, right: 500, bottom: 400 }] });
assert.equal(drawer.left + size.w / 2 <= 350, true);
assert.equal(placeCard({ above: { x: 1, y: 200 }, below: { x: 1, y: 200 }, size, bounds }).left, 106);
assert.equal(placeCard({ above: { x: 499, y: 200 }, below: { x: 499, y: 200 }, size, bounds }).left, 394);
const docked = placeCard({ above: { x: 700, y: 200 }, below: { x: 700, y: 200 }, size, bounds });
assert.equal(docked.docked, true);
assert.ok(Number.isFinite(docked.left) && Number.isFinite(docked.top));
assert.deepEqual(placeCard({ above: { x: 250, y: 200 }, below: { x: 250, y: 200 }, size: { w: 0, h: 0 }, bounds }), placeCard({ above: { x: 250, y: 200 }, below: { x: 250, y: 200 }, size: { w: 260, h: 200 }, bounds }));
console.log('card place ok: above, flip, bounds, drawer, clamp, dock, defaults');
