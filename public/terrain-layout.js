// Shared terrain/road contract. Heights are world units; y is map north/south.
// The NW massif is a continuous heightfield (an eroded limestone block: sheer south face toward the village, a
// gentler east shoulder carrying the switchback road, a flat summit mesa for the Temple, the Quarry bitten into the
// east flank). Everything that stands on it — figures, buildings, trees, mist — reads mountainHeight(x,y).
export const mountainRoute = [
  {x:300,y:300,h:18}, {x:390,y:290,h:18}, {x:390,y:250,h:54},
  {x:294,y:250,h:54}, {x:294,y:210,h:90}, {x:254,y:210,h:90},
  {x:254,y:170,h:126}, {x:140,y:170,h:126},
];
export const quarryRoute = [{x:390,y:250,h:54},{x:390,y:210,h:54},{x:345,y:210,h:54}];
export const SUMMIT = { x0: 60, x1: 225, z0: 38, z1: 182, h: 126 };   // flat mesa under the Temple
export const QUARRY_SHELF = { x: 350, z: 160, rx: 78, rz: 58, h: 54 }; // flat shelf under the Quarry
export const MOUNTAIN_BOUNDS = { x0: 0, x1: 540, z0: 0, z1: 330 };     // heightfield extent (beyond it the ground is 18)
const PATH_W = 12;                                                      // walkable half-width (exact ramp height)

// ---- deterministic value noise (no textures, no libraries) ----
const hash2 = (i, j) => { let n = Math.imul(i, 374761393) + Math.imul(j, 668265263) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
export function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x, y, oct = 3) { let s = 0, a = 0.5, f = 1, n = 0; for (let i = 0; i < oct; i++) { s += a * vnoise(x * f + 7.3 * i, y * f - 4.1 * i); n += a; a *= 0.5; f *= 2.1; } return s / n; }
const smooth = (a, b, t) => { const u = Math.max(0, Math.min(1, (t - a) / (b - a))); return u * u * (3 - 2 * u); };

// nearest point on the road network: { d, h } for any distance
export function routeNear(x, y) {
  let best = null;
  for (const path of [mountainRoute, quarryRoute]) for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], dx = b.x - a.x, dy = b.y - a.y, l = dx * dx + dy * dy;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l));
    const d = Math.hypot(x - a.x - t * dx, y - a.y - t * dy);
    if (!best || d < best.d) best = { d, h: a.h + (b.h - a.h) * t };
  }
  return best;
}
export function rampHeight(x, y) { const r = routeNear(x, y); return r && r.d <= PATH_W ? r.h : null; }

// The raw massif (before the road is cut in): max of the summit block, a north ridge, the SE shoulder and the crest.
// Designed limestone: a few broad bands. The raw massif is smooth (long-wavelength meander only); mountainHeight then
// terraces it into 21-unit strata with near-vertical risers, and a handful of deliberate fissures cut the faces.
const FISSURES = [[118, 228, 152, 296], [204, 196, 232, 262], [48, 150, 36, 205], [300, 232, 318, 264]];
export function fissureAt(x, y) {
  let f = 0;
  for (const [ax, az, bx, bz] of FISSURES) { const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - az) * dz) / (dx * dx + dz * dz))); f = Math.max(f, 1 - smooth(2.5, 8, Math.hypot(x - ax - t * dx, y - az - t * dz))); }
  return f;
}
function massifRaw(x, y) {
  const S = SUMMIT;
  const dxE = Math.max(0, x - S.x1), dxW = Math.max(0, S.x0 - x), dzS = Math.max(0, y - S.z1), dzN = Math.max(0, S.z0 - y);
  const east = dxE * 0.47 + Math.max(0, dxE - 130) * 0.9;                    // gentle east shoulder (the road), then it drops off
  const d = Math.hypot(east, dxW * 0.9, dzS * 1.67, dzN * 1.2);             // anisotropic: steep south face toward the village
  const fade = smooth(0, 26, d);                                           // the mesa itself stays dead flat
  const warp = (fbm(x / 150, y / 150, 2) - 0.5) * 56 * fade;               // long, calm meander of the bands
  const h = S.h - (d + warp) * 0.63;
  // north ridge running east from the summit; the Quarry's back wall
  const ax = 230, az = 50, bx = 380, bz = 55, dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - az) * dz) / (dx * dx + dz * dz)));
  const rd = Math.hypot(x - ax - t * dx, y - az - t * dz) + (fbm(x / 80 + 9, y / 80, 1) - 0.5) * 12;
  const ridge = (124 - 30 * t) - rd * 0.6;
  // south-east shoulder the first stair climbs onto
  const sd = Math.hypot(x - 375, y - 235) + (fbm(x / 60 + 2, y / 60 + 5, 1) - 0.5) * 8;
  const shoulder = 60 - sd * 0.6;
  // a rocky crest on the western brow beside the Temple, the true summit tooth
  const cx0 = 30, cz0 = 100, cx1 = 40, cz1 = 165, cdx = cx1 - cx0, cdz = cz1 - cz0, ct = Math.max(0, Math.min(1, ((x - cx0) * cdx + (y - cz0) * cdz) / (cdx * cdx + cdz * cdz)));
  const cd = Math.hypot(x - cx0 - ct * cdx, y - cz0 - ct * cdz) + (fbm(x / 40, y / 40, 1) - 0.5) * 6;
  const crest = 150 - cd * 1.6;
  return { h: Math.max(18, h, ridge, shoulder, crest), fade };
}
const STEP = 21;
// the sea cliffs: the massif keeps falling beyond the coastline in the same strata until it meets the water
export function seaCliffHeight(x, y, dOut) { const raw = massifRaw(x, y); const h = terrace(Math.max(18, raw.h) - 6 - 2.4 * dOut, 1); return h < -6 ? -14 : h; }
const terrace = (h, w) => { const s = (h - 18) / STEP, fr = s - Math.floor(s); const t = 18 + (Math.floor(s) + smooth(0.4, 0.6, fr)) * STEP; return h + (t - h) * 0.92 * w; };
// signed "inside the Quarry shelf" measure: <1 inside
const quarryU = (x, y) => Math.hypot((x - QUARRY_SHELF.x) / QUARRY_SHELF.rx, (y - QUARRY_SHELF.z) / QUARRY_SHELF.rz);

export function mountainHeight(x, y) {
  const B = MOUNTAIN_BOUNDS;
  if (x < B.x0 || x > B.x1 || y < B.z0 || y > B.z1) return 18;
  const r = routeNear(x, y);
  if (r && r.d <= PATH_W) return r.h;
  const raw = massifRaw(x, y); let h = raw.h;
  const qu = quarryU(x, y);                                                // the Quarry: a flat shelf cut into the flank
  if (qu < 1) h = QUARRY_SHELF.h; else if (qu < 1.3) h = QUARRY_SHELF.h + (h - QUARRY_SHELF.h) * smooth(1, 1.3, qu);
  if (r && r.d < 44) {                                                     // the road: a cut on the uphill side, an embankment downhill
    const w = h > r.h ? smooth(PATH_W, 24, r.d) : smooth(PATH_W, 44, r.d);
    h = r.h + (h - r.h) * w;
  }
  // broad strata everywhere but the mesa, the road band and the shelf floor; then the fissures
  const wT = raw.fade * (r ? smooth(PATH_W, 30, r.d) : 1) * (qu < 1 ? 0 : smooth(1, 1.15, qu));
  h = terrace(h, wT);
  h -= fissureAt(x, y) * 9 * raw.fade * smooth(28, 60, h - 18) * (r ? smooth(14, 30, r.d) : 1);
  return Math.max(18, h);
}
// terrain classification for colouring and scatter: 'summit' | 'crest' | 'quarry' | 'quarrywall' | 'road' | 'slope' | 'flat'
export function mountainZone(x, y) {
  const S = SUMMIT, h = mountainHeight(x, y);
  if (h > S.h + 0.5) return 'crest';
  if (x >= S.x0 && x <= S.x1 && y >= S.z0 && y <= S.z1) return 'summit';
  const qu = quarryU(x, y);
  if (qu < 1) return 'quarry';
  const r = routeNear(x, y); if (r && r.d <= PATH_W + 4) return 'road';
  if (qu < 1.32) return 'quarrywall';
  return h > 18.5 ? 'slope' : 'flat';
}
