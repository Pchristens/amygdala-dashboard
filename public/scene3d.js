// Terrain and procedural architecture for the 2.5D map (round 2): a composed landform — organic
// outline on a dark base with stepped terraces and visible cliff faces — and ruins as the village's
// structural fabric. Everything is built from primitives with vertex colours, merged, and shaded with
// a three-band toon ramp (ivory / warm mid / lavender shadow).
import * as THREE from 'three';
import { mountainRoute, quarryRoute, mountainHeight, mountainZone, MOUNTAIN_BOUNDS, routeNear, fbm, vnoise, fissureAt, seaCliffHeight } from './terrain-layout.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry, hashStr, zoneOf, pointInPoly } from './svg-util.js';
import { ISLE, isleLandAt } from './isle.js';

export const P = {
  ivory: '#F8F0E1', plaster: '#F2E7D1', sage: '#9FB585', sageDark: '#86A070', sageLight: '#B6C79C', terracotta: '#C4633F', red: '#B4473B',
  olive: '#6E8A5C', oliveLight: '#8DA878', oliveSilver: '#9DB08A', cypress: '#4A644E', cypressLight: '#5F7A5F',
  turquoise: '#4F9DB3', turqDeep: '#3F879E', sea: '#4F9DB3', shallows: '#8ED0D6',
  marble: '#F7F1E4', marbleShade: '#E8DFCB', marbleDark: '#CEC4AE', stone: '#CDC3B3', stoneDark: '#A89E90', ancient: '#D3C7B0', ancientDark: '#AFA38C',
  rock: '#B8A585', rockDark: '#7A6C58', base: '#6B5F52', baseDark: '#574C41', ink: '#3B2F26', wood: '#A58A6A', woodDark: '#7D6650',
  gold: '#F2C14E', blue: '#6FA2BD', rose: '#E7C7C9', lilac: '#C7BDD6', sand: '#E9DEC6', ember: '#F0742E', vine: '#6F8A64', vineLight: '#8CA47E',
};
const col = (hex) => new THREE.Color(hex);

// ---------- geometry builder with vertex colours ----------
export class Builder {
  constructor() { this.parts = []; }
  add(geo, color, m) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (m) g.applyMatrix4(m);
    const pa = g.attributes.position.array;
    for (let i = 0; i < pa.length; i++) if (!Number.isFinite(pa[i])) { console.warn('NaN part dropped', color, geo.type, m ? Array.from(m.elements).map((v) => +v.toFixed(2)).join(',') : ''); return; }
    const c = col(color);
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    this.parts.push(g);
  }
  box(x, y, z, w, h, d, color, ry = 0) { this.add(new THREE.BoxGeometry(w, h, d), color, new THREE.Matrix4().makeRotationY(ry).setPosition(x, y + h / 2, z)); }
  cyl(x, y, z, rt, rb, h, color, seg = 10, ry = 0) { this.add(new THREE.CylinderGeometry(rt, rb, h, seg), color, new THREE.Matrix4().makeRotationY(ry).setPosition(x, y + h / 2, z)); }
  lying(x, y, z, r, len, color, ry = 0, seg = 8) { const m = new THREE.Matrix4().makeRotationY(ry).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2)).setPosition(x, y + r, z); this.add(new THREE.CylinderGeometry(r, r, len, seg), color, m); }
  dome(x, y, z, r, color, seg = 12) { this.add(new THREE.SphereGeometry(r, seg, 7, 0, Math.PI * 2, 0, Math.PI / 2), color, new THREE.Matrix4().setPosition(x, y, z)); }
  sphere(x, y, z, r, color, detail = 1) { this.add(new THREE.IcosahedronGeometry(r, detail), color, new THREE.Matrix4().setPosition(x, y, z)); }
  blob(x, y, z, rx, ry, rz, color, rot = 0) { // flattened icosahedron (blossom mass / shrub)
    const g = new THREE.IcosahedronGeometry(1, 1); g.scale(rx, ry, rz);
    this.add(g, color, new THREE.Matrix4().makeRotationY(rot).setPosition(x, y, z));
  }
  cone(x, y, z, r, h, color, seg = 8) { this.cyl(x, y, z, 0, r, h, color, seg); }
  prism(x, y, z, w, h, d, color, ry = 0) {
    const shape = new THREE.Shape(); shape.moveTo(-w / 2, 0); shape.lineTo(w / 2, 0); shape.lineTo(0, h); shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false }); g.translate(0, 0, -d / 2);
    this.add(g, color, new THREE.Matrix4().makeRotationY(ry).setPosition(x, y, z));
  }
  column(x, y, z, r, h, color, capColor, broken = 0) {
    const hh = broken ? h * broken : h;
    this.cyl(x, y, z, r * 0.88, r, hh, color, 10);
    if (!broken) { this.cyl(x, y + hh - r * 0.6, z, r * 1.3, r * 0.95, r * 0.6, capColor, 10); this.box(x, y + hh, z, r * 2.7, r * 0.7, r * 2.7, capColor); }
    else this.cyl(x, y + hh, z, r * 0.95, r * 0.9, r * 0.3, capColor, 10);
  }
  stairs(x, y, z, w, steps, rise, run, color, dir = 0) {
    for (let i = 0; i < steps; i++) { const g = new THREE.BoxGeometry(w, rise, run); g.translate(0, rise * (i + 0.5), -run * (i + 0.5)); this.add(g, color, new THREE.Matrix4().makeRotationY(dir).setPosition(x, y, z)); }
  }
  arch(x, y, z, w, h, depth, color, ry = 0, pw = 5) {
    const m = new THREE.Matrix4().makeRotationY(ry).setPosition(x, y, z);
    const l = new THREE.BoxGeometry(pw, h - w / 2, depth); l.translate(-w / 2 + pw / 2, (h - w / 2) / 2, 0);
    const r = new THREE.BoxGeometry(pw, h - w / 2, depth); r.translate(w / 2 - pw / 2, (h - w / 2) / 2, 0);
    this.add(l, color, m); this.add(r, color, m);
    const t = new THREE.TorusGeometry(w / 2 - pw / 2, pw / 2, 6, 14, Math.PI); t.scale(1, 1, depth / pw); t.translate(0, h - w / 2, 0);
    this.add(t, color, m);
  }
  vines(x, y, z, w, h, d, seed, n = 6) {
    const r = mulberry(seed);
    for (let i = 0; i < n; i++) this.blob(x + (r() - 0.5) * w, y + r() * h, z + (r() - 0.5) * d, 2 + r() * 2.8, 1.4 + r() * 1.2, 2 + r() * 2.5, i % 2 ? P.vine : P.vineLight, r() * 3);
  }
  // an oversized ancient wall: eroded top course, sometimes a doorway gap
  ancientWall(x, y, z, len, h, ry, seed, color = P.ancient) {
    const r = mulberry(seed);
    const segs = Math.max(2, Math.round(len / 14));
    const sw = len / segs;
    for (let i = 0; i < segs; i++) {
      const hh = h * (0.55 + r() * 0.5) * (i === 0 || i === segs - 1 ? 0.8 : 1);
      const lx = -len / 2 + sw * (i + 0.5);
      const g = new THREE.BoxGeometry(sw + 0.2, hh, 6); g.translate(lx, hh / 2, 0);
      this.add(g, i % 3 === 1 ? P.ancientDark : color, new THREE.Matrix4().makeRotationY(ry).setPosition(x, y, z));
      if (r() < 0.4) { const c = new THREE.BoxGeometry(sw * 0.6, 1.4, 7.2); c.translate(lx, hh + 0.7, 0); this.add(c, P.ancientDark, new THREE.Matrix4().makeRotationY(ry).setPosition(x, y, z)); }
    }
    const base = new THREE.BoxGeometry(len + 6, 2.2, 9); base.translate(0, 1.1, 0);
    this.add(base, P.ancientDark, new THREE.Matrix4().makeRotationY(ry).setPosition(x, y, z));
    if (r() < 0.7) this.vines(x, y + 2, z, len * 0.6, h * 0.5, 8, seed + 1, 5);
  }
  giantColumn(x, y, z, broken = 0) { this.column(x, y, z, 4.6, 46, P.ancient, P.ancientDark, broken); }
  mesh(material) {
    if (!this.parts.length) return null;
    const g = BufferGeometryUtils.mergeGeometries(this.parts, false);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, material); m.castShadow = true; m.receiveShadow = true; return m;
  }
}

// ---------- materials: three-band toon ramp (thresholds at NdotL −0.15 and 0.55) ----------
function toonRamp() {
  const n = 64, data = new Uint8Array(n * 4);
  const shadow = [0.46, 0.44, 0.56], mid = [0.76, 0.73, 0.72], hi = [1.0, 0.99, 0.96];
  for (let i = 0; i < n; i++) {
    const coord = (i + 0.5) / n; const dot = coord * 2 - 1;
    const c = dot < -0.15 ? shadow : dot < 0.55 ? mid : hi;
    data[i * 4] = c[0] * 255; data[i * 4 + 1] = c[1] * 255; data[i * 4 + 2] = c[2] * 255; data[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, n, 1, THREE.RGBAFormat); t.minFilter = THREE.NearestFilter; t.magFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; return t;
}
export function makeMaterials() {
  const ramp = toonRamp();
  return {
    toon: new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: ramp }),
    decal: new THREE.MeshToonMaterial({ vertexColors:true, gradientMap:ramp, polygonOffset:true, polygonOffsetFactor:-2, polygonOffsetUnits:-2, depthWrite:false }),
    flat: new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: ramp }),
    emissive: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, emissive: new THREE.Color('#F2C14E'), emissiveIntensity: 0, roughness: 0.6 }),
    ember: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, emissive: new THREE.Color('#FF7A2E'), emissiveIntensity: 1.6, roughness: 0.8 }),
    pool: new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset:true, polygonOffsetFactor:-3, polygonOffsetUnits:-3 }),
    ao: new THREE.MeshBasicMaterial({ color: new THREE.Color('#3E3550'), transparent: true, opacity: 0.13, depthWrite: false, polygonOffset:true, polygonOffsetFactor:-3, polygonOffsetUnits:-3 }),
    water: new THREE.MeshStandardMaterial({ color: new THREE.Color(P.turquoise), roughness: 0.3, metalness: 0.05 }),
    shallows: new THREE.MeshStandardMaterial({ color: new THREE.Color(P.shallows), roughness: 0.4, transparent: true, opacity: 0.42, depthWrite: false }),
    foam: new THREE.MeshBasicMaterial({ color: new THREE.Color('#F4FAF8'), transparent: true, opacity: 0.5, depthWrite: false }),
  };
}

// ---------- landform ----------
export const BRIDGE = { x: 752, y: 381 }; // legacy import compatibility
export function isRiverAt() { return false; }
export const VILLAGE_OUTLINE = [[18,90],[80,18],[260,12],[440,25],[610,12],[800,24],[976,20],[1012,62],[1028,104],[1000,150],[966,196],[952,236],[978,292],[1005,460],[990,650],[940,722],[830,725],[710,750],[612,742],[560,738],[520,746],[478,770],[452,806],[422,798],[404,772],[378,760],[300,766],[190,740],[150,706],[118,716],[86,694],[65,724],[18,620],[30,470],[8,310]].map(([x,y])=>({x,y}));
export const HEADLANDS = [[1012, 84], [446, 788], [102, 704], [960, 222]];
export const LEVELS = { shore:4,village:18,highland:54,temple:126,isle:15,isleTop:30 };
export function groundHeight(x,y) {
  if (x >= ISLE.bounds.x) { if (!isleLandAt(x,y)) return -8; const c=ISLE.center; return isleLandAt(c.x+(x-c.x)/0.55,c.y+(y-c.y)/0.55)?30:15; }
  if (!pointInPoly({x,y},VILLAGE_OUTLINE)) return -8;
  return mountainHeight(x,y);
}
function shapeFrom(pts) { const s = new THREE.Shape(); pts.forEach((p, i) => (i ? s.lineTo(p.x, p.y) : s.moveTo(p.x, p.y))); s.closePath(); return s; }
function extrudeLand(shapePts, thickness, y = 0) { const g = new THREE.ExtrudeGeometry(shapeFrom(shapePts), { depth: thickness, bevelEnabled: false }); g.rotateX(Math.PI / 2); g.translate(0, y + thickness, 0); return g; }
const inset = (pts, cx, cy, k) => pts.map((p) => ({ x: cx + (p.x - cx) * k, y: cy + (p.y - cy) * k }));

// ---------- the massif: a vertex-coloured heightfield (flat-shaded), the road cut into it, scree and scrub ----------
const smooth01 = (a, b, t) => { const u = Math.max(0, Math.min(1, (t - a) / (b - a))); return u * u * (3 - 2 * u); };
const PLATE = 18, TUCK = 17.4;
function pushColored(b, pos, cols) { // raw triangles with per-vertex colour, merged like any Builder part
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(pos.length), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  b.parts.push(g);
}
const CUT = ['#ECE2CC', '#DACEB4'], CREVICE = '#7A6C58';
const TREAD = ['#D9CEB8', '#D0C5AE'], RISER = ['#9E8F75', '#A89A80'];
function massifColor(cx, cz, h, ny, zone, span = 0) {
  const n1 = fbm(cx / 60, cz / 60, 2);
  if (span > 18 && ny < 0.35) return h > 60 ? '#B9A685' : '#9A8A70';                   // sea cliffs: one calm face, darker at the waterline
  if (zone === 'road') return '#D6C7A2';
  if (zone === 'quarry') return '#E4DAC4';                                                // dusty cut floor
  if (zone === 'quarrywall') return ny < 0.8 ? CUT[Math.abs(Math.floor(h / STEP_C)) % 2] : '#D6CCB6';
  if (fissureAt(cx, cz) > 0.45) return CREVICE;                                           // the fissures
  const band = Math.abs(Math.floor((h - 18) / STEP_C)) % 2, nearTemple = cx < 250 && cz > 30 && cz < 275;   // rock behind/below the Temple reads darker so the marble separates
  if (ny < 0.5) return nearTemple ? '#857660' : RISER[band];                                // riser: ochre shadow
  if (ny < 0.8) return '#BCAE92';                                                         // the lip
  if (zone === 'summit' || zone === 'crest' || h > 118) return nearTemple ? '#C3B497' : '#DDD3BF';   // summit mesa
  if (h < 76 && n1 > 0.58) return P.sage;                                                 // grass on the low ledges
  return nearTemple ? (band ? '#BFAE8F' : '#B8A788') : TREAD[band];                        // tread: cream limestone
}
const STEP_C = 21;
function buildMountain(b) {
  const B = MOUNTAIN_BOUNDS, cs = 8, nx = Math.ceil((B.x1 - B.x0) / cs), nz = Math.ceil((B.z1 - B.z0) / cs);
  const H = new Float32Array((nx + 1) * (nz + 1));
  const IN = new Uint8Array((nx + 1) * (nz + 1));
  const dOut = (x, z) => { let best = 1e9; for (let k = 0; k < VILLAGE_OUTLINE.length; k++) { const a = VILLAGE_OUTLINE[k], c = VILLAGE_OUTLINE[(k + 1) % VILLAGE_OUTLINE.length], dx = c.x - a.x, dz = c.y - a.y, l2 = dx * dx + dz * dz || 1; const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.y) * dz) / l2)); best = Math.min(best, Math.hypot(x - a.x - t * dx, z - a.y - t * dz)); } return best; };
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) { const x = B.x0 + i * cs, z = B.z0 + j * cs, inside = pointInPoly({ x, y: z }, VILLAGE_OUTLINE); IN[j * (nx + 1) + i] = inside ? 1 : 0; H[j * (nx + 1) + i] = inside ? mountainHeight(x, z) : (x < 300 || z < 60 ? seaCliffHeight(x, z, dOut(x, z)) : -14); }
  const pos = [], cols = [], c = new THREE.Color();
  let occl = 0;
  const tri = (ax, ay, az, bx, by, bz, qx, qy, qz) => {
    const cx = (ax + bx + qx) / 3, cz = (az + bz + qz) / 3, h = (ay + by + qy) / 3, span = Math.max(ay, by, qy) - Math.min(ay, by, qy);
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = qx - ax, vy = qy - ay, vz = qz - az;
    const nX = uy * vz - uz * vy, nY = uz * vx - ux * vz, nZ = ux * vy - uy * vx, nl = Math.hypot(nX, nY, nZ) || 1;
    c.set(massifColor(cx, cz, h, nY / nl, mountainZone(cx, cz), span));
    if (occl > 5 && nY / nl > 0.6) c.multiplyScalar(0.8);                                                    // the shaded foot of a riser
    pos.push(ax, ay, az, bx, by, bz, qx, qy, qz); for (let k = 0; k < 3; k++) cols.push(c.r, c.g, c.b);
  };
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x0 = B.x0 + i * cs, x1 = x0 + cs, z0 = B.z0 + j * cs, z1 = z0 + cs;
    let h00 = H[j * (nx + 1) + i], h10 = H[j * (nx + 1) + i + 1], h01 = H[(j + 1) * (nx + 1) + i], h11 = H[(j + 1) * (nx + 1) + i + 1];
    if (h00 <= PLATE + 0.2 && h10 <= PLATE + 0.2 && h01 <= PLATE + 0.2 && h11 <= PLATE + 0.2) continue;   // the plate shows here
    const t = (h, k) => (IN[k] && h <= PLATE + 0.2 && h > 0 ? TUCK : h);                                   // feet tuck under the plate top (inland only)
    h00 = t(h00, j * (nx + 1) + i); h10 = t(h10, j * (nx + 1) + i + 1); h01 = t(h01, (j + 1) * (nx + 1) + i); h11 = t(h11, (j + 1) * (nx + 1) + i + 1);
    let around = -1e9; for (let dj = -1; dj <= 2; dj++) for (let di = -1; di <= 2; di++) { const jj = j + dj, ii = i + di; if (jj < 0 || jj > nz || ii < 0 || ii > nx) continue; around = Math.max(around, H[jj * (nx + 1) + ii]); }
    occl = around - Math.max(h00, h10, h01, h11);
    if (Math.abs(h00 - h11) <= Math.abs(h10 - h01)) { tri(x0, h00, z0, x0, h01, z1, x1, h11, z1); tri(x0, h00, z0, x1, h11, z1, x1, h10, z0); }
    else { tri(x0, h00, z0, x0, h01, z1, x1, h10, z0); tri(x1, h10, z0, x0, h01, z1, x1, h11, z1); }
  }
  pushColored(b, pos, cols);
  // planting only on the ledges: clumps of olive scrub on flat treads, nothing on the faces, the summit bare
  const r = mulberry(77);
  const grad = (x, z) => Math.hypot(mountainHeight(x + 2, z) - mountainHeight(x - 2, z), mountainHeight(x, z + 2) - mountainHeight(x, z - 2)) / 4;
  const ok = (x, z) => { if (!pointInPoly({ x, y: z }, VILLAGE_OUTLINE)) return false; const zone = mountainZone(x, z); if (zone !== 'slope') return false; const rn = routeNear(x, z); return (!rn || rn.d > 16) && fissureAt(x, z) < 0.2; };
  let shrubs = 0, outcrops = 0;
  for (let k = 0; k < 3000 && (shrubs < 56 || outcrops < 12); k++) {
    const x = B.x0 + 20 + r() * (B.x1 - B.x0 - 40), z = B.z0 + 14 + r() * (B.z1 - B.z0 - 28);
    if (!ok(x, z)) continue;
    const h = mountainHeight(x, z); if (h > 110 || grad(x, z) > 0.12) continue;
    if (outcrops < 12 && r() < 0.35 && z > 150) { outcrops++; const w = 7 + r() * 7; b.box(x, h + 1.2, z, w, 3.5 + r() * 4, w * 0.6, r() < 0.5 ? RISER[1] : TREAD[1], r() * 3); continue; }   // angular outcrops interrupt the long ledges
    if (shrubs >= 56) continue;
    const n = 2 + Math.floor(r() * 3); shrubs += n;
    for (let i = 0; i < n; i++) { const sx = x + (r() - 0.5) * 12, sz = z + (r() - 0.5) * 9; if (!ok(sx, sz) || grad(sx, sz) > 0.15) continue; const s2 = 3 + r() * 3; b.blob(sx, mountainHeight(sx, sz) + s2 * 0.25, sz, s2, s2 * 0.5, s2 * 0.85, r() < 0.5 ? P.olive : r() < 0.65 ? '#A9A674' : '#62745A', r() * 3); }
  }
}
function buildMountainRoad(b) {
  const side = (a, c, len) => [-(c.y - a.y) / len, (c.x - a.x) / len];
  for (const path of [mountainRoute, quarryRoute]) for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], c = path[i], len = Math.hypot(c.x - a.x, c.y - a.y), ang = -Math.atan2(c.y - a.y, c.x - a.x), [nx, nz] = side(a, c, len);
    const climbs = Math.abs(c.h - a.h) > 0.5, main = path === mountainRoute;                       // the processional way is broad and marble; the quarry spur narrow
    if (!climbs) b.box((a.x + c.x) / 2, a.h + 0.1, (a.y + c.y) / 2, len + 4, 0.5, main ? 18 : 10, main ? '#E6DABE' : '#C9B994', ang);  // paving on the level stretches
    else { const n = Math.ceil(len / 2.6); for (let j = 0; j < n; j++) { const t = (j + 0.5) / n, h = a.h + (c.h - a.h) * t; b.box(a.x + (c.x - a.x) * t, h - 1.1, a.y + (c.y - a.y) * t, len / n + 0.05, 1.5, main ? 22 : 12, main ? (j % 2 ? P.marble : P.marbleShade) : (j % 2 ? P.stone : '#C4BAA8'), ang); } }
    // kerb stones on the downhill side; a drystone parapet where the drop is real
    const lowSide = mountainHeight(a.x + nx * 18, a.y + nz * 18) + mountainHeight(c.x + nx * 18, c.y + nz * 18) < mountainHeight(a.x - nx * 18, a.y - nz * 18) + mountainHeight(c.x - nx * 18, c.y - nz * 18) ? 1 : -1;
    { const mx = (a.x + c.x) / 2 + nx * lowSide * 10.5, mz = (a.y + c.y) / 2 + nz * lowSide * 10.5, mh = (a.h + c.h) / 2;
      const g = new THREE.BoxGeometry(len + 2, 2.0, 2.2); if (climbs) g.applyMatrix4(new THREE.Matrix4().makeShear(0, 0, (c.h - a.h) / len, 0, 0, 0));
      b.add(g, '#D9D0BE', new THREE.Matrix4().makeRotationY(ang).setPosition(mx, mh + 0.6, mz)); }   // a clean low parapet on the drop side
  }
  for (const p of mountainRoute.slice(2, 7)) b.cyl(p.x, p.h - 0.6, p.y, 9, 9, 1.0, P.stone, 10);        // landings at the turns
  b.lying(404, 18, 300, 3, 12, P.ancientDark, 0.7); b.lying(300, 18, 318, 2.6, 10, P.ancient, 2.1); for (const [bx, bz, br] of [[412, 306, 4], [300, 326, 3.2], [288, 314, 2.6]]) b.sphere(bx, 18 + br * 0.4, bz, br, TREAD[1], 1);   // fallen drums and boulders at the stair foot
  { const qr = mulberry(19);                                                                                // the Quarry's rim toward the village: stacked cut-stone benches
    for (const [k, top] of [[0, 44], [1, 32]]) for (let i = 0; i < 7; i++) {
      const a = 0.1 + i * 0.17 + (qr() - 0.5) * 0.04, rx = 78 + 22 + 18 * k, rz = 58 + 16 + 14 * k, x = 350 + Math.cos(a) * rx, z = 160 + Math.sin(a) * rz;
      if (routeNear(x, z).d < 17 || mountainHeight(x, z) > top + 3) continue;
      b.box(x, top - 12, z, 24 + qr() * 6, 12, 16, k ? CUT[1] : CUT[0], -a + Math.PI / 2); b.box(x, top, z, 20, 1.4, 11, P.rockDark, -a + Math.PI / 2);
    } }
}
// the Green's theatre: travertine tiers wrapped around the Almond's northern half, rising from the tree to the
// plaza's outer rim; the arc stops short of the two lanes that clip the Green's south-west and south-east edges
export const THEATRE = { x: 440, z: 420, f0: Math.PI * 1.13, f1: Math.PI * 1.96, R0: 34, W: 7, N: 6, TIER: 1.9 };
THEATRE.open = (THEATRE.f0 + THEATRE.f1) / 2 - Math.PI; THEATRE.half = (THEATRE.f1 - THEATRE.f0) / 2;
function buildAmphitheatre(b) {
  const { x, z, f0, f1, R0, W, N, TIER } = THEATRE, y = PLATE, face = (f0 + f1) / 2, RN = R0 + N * W;
  // solid annular sectors (proper treads and inward risers), built like the land plate
  const sector = (ri, ro, h, color, y0 = y, a = f0, c = f1) => { const sh = new THREE.Shape(); sh.absarc(x, z, ro, a, c, false); sh.absarc(x, z, ri, c, a, true); const g = new THREE.ExtrudeGeometry(sh, { depth: h, bevelEnabled: false }); g.rotateX(Math.PI / 2); g.translate(0, y0 + h, 0); b.add(g, color); };
  for (let i = 0; i < N; i++) sector(R0 + i * W, R0 + (i + 1) * W, TIER * (i + 1), i % 2 ? '#EBDBBB' : '#D5C19C');   // stepped travertine seating
  sector(RN - 1.2, RN + 0.4, TIER * N + 1.6, P.stoneDark, y, f0 - 0.01, f1 + 0.01);                                   // low parapet on the rim
  for (const da of [-0.55, 0, 0.55]) { const ang = face + da * (f1 - f0) / 2; for (let i = 0; i < N; i++) { const rr = R0 + i * W + W / 2; b.box(x + Math.cos(ang) * rr, y + TIER * i, z + Math.sin(ang) * rr, W + 0.2, TIER + 0.15, 3.2, '#CFC3AD', -ang); } }   // three stepped aisles
  const nc = 17; for (let i = 0; i < nc; i++) { const ang = f0 + (i + 0.5) * (f1 - f0) / nc, rr = RN - 0.4; b.box(x + Math.cos(ang) * rr, y + TIER * N + 1.6, z + Math.sin(ang) * rr, 3.4, 0.9, 2.4, P.marbleDark, -ang); }   // coping
}
// subtle Aegean variation on the flat ground: broad, soft blotches of dry gold / sage / deeper olive (per-vertex
// colour, low-frequency noise only — no speckle), plus a faint worn-earth halo where the lanes run.
function buildGroundPatches(g) {
  const cs = 14, pos = [], cols = [], base = new THREE.Color(P.sage), dry = new THREE.Color('#B9BC86'), gold = new THREE.Color('#C9B57A'), deep = new THREE.Color('#7E9670'), earth = new THREE.Color('#BDB497');
  const c = new THREE.Color();
  const tone = (x, z) => {
    const n = fbm(x / 160 + 11, z / 160 + 3, 2) * 0.7 + fbm(x / 55 + 4, z / 55, 1) * 0.3;
    c.copy(base);
    if (n < 0.42) c.lerp(dry, Math.min(1, (0.42 - n) / 0.12) * 0.8); else if (n > 0.58) c.lerp(deep, Math.min(1, (n - 0.58) / 0.12) * 0.7);
    const n2 = fbm(x / 90 + 23, z / 90 + 17, 1); if (n2 > 0.7) c.lerp(gold, Math.min(1, (n2 - 0.7) / 0.08) * 0.75);   // sun-baked patches only as accents
    const dg = Math.hypot(x - 440, z - 420); if (dg > 78 && dg < 190) c.lerp(deep, 0.55 * (1 - Math.abs(dg - 125) / 65));
    if (x < 560 && z < 340) { const near = Math.max(mountainHeight(x - 10, z), mountainHeight(x, z - 10), mountainHeight(x - 7, z - 7)); if (near > 20) c.lerp(deep, 0.5); }   // shade at the cliff foot
    return c;
  };
  const vert = (x, z) => { const t = tone(x, z); pos.push(x, PLATE + 0.12, z); cols.push(t.r, t.g, t.b); };
  for (let z = 0; z < 760; z += cs) for (let x = 0; x < 1010; x += cs) {
    const pts = [[x, z], [x + cs, z], [x, z + cs], [x + cs, z + cs]];
    if (!pts.every(([px, pz]) => pointInPoly({ x: px, y: pz }, VILLAGE_OUTLINE) && mountainHeight(px, pz) <= PLATE + 0.2)) continue;
    vert(x, z); vert(x, z + cs); vert(x + cs, z + cs); vert(x, z); vert(x + cs, z + cs); vert(x + cs, z);
  }
  pushColored(g, pos, cols); void earth;
}

// a pale shallow shelf and a thin foam line hugging every shore (aerial depth: shallows pale, open sea deep)
function shoreRings(outline, cx, cy, mats) {
  const group = new THREE.Group();
  const ring = (k, y, mat) => { const m = new THREE.Mesh(extrudeLand(inset(outline, cx, cy, k), 0.2, y), mat); m.receiveShadow = false; group.add(m); return m; };
  const wide = new THREE.MeshStandardMaterial({ color: new THREE.Color(P.shallows), roughness: 0.4, transparent: true, opacity: 0.22, depthWrite: false });
  const wider = new THREE.MeshStandardMaterial({ color: new THREE.Color(P.shallows), roughness: 0.4, transparent: true, opacity: 0.1, depthWrite: false });
  ring(1.2, -7.95, wider); ring(1.11, -7.9, wide); ring(1.045, -7.7, mats.shallows);
  const soft = new THREE.MeshBasicMaterial({ color: new THREE.Color('#F4FAF8'), transparent: true, opacity: 0.2, depthWrite: false });
  ring(1.024, -7.6, soft);
  const foam = ring(1.011, -7.5, mats.foam);
  return { group, foam };
}
export function buildTerrain(scene, mats) {
  const group = new THREE.Group();
  const b = new Builder();
  b.add(extrudeLand(VILLAGE_OUTLINE,50,-46),P.base);
  b.add(extrudeLand(VILLAGE_OUTLINE,13.6,4),P.ancientDark);
  b.add(extrudeLand(VILLAGE_OUTLINE,0.4,17.6),P.sage);
  buildMountain(b);
  buildMountainRoad(b);
  buildAmphitheatre(b);
  buildGroundPatches(b);
  { const wr = mulberry(41); for (const [wx, wz, wl, wa] of [[660, 72, 60, 0.2], [782, 62, 50, -0.3], [945, 330, 46, 1.2], [905, 548, 56, 0.9], [596, 128, 40, -0.6]]) {   // dry-stone field walls: three rough courses, seated on the ground
    const gy = groundHeight(wx, wz); if (gy < 17) continue; const cs = Math.cos(wa), sn = -Math.sin(wa);
    for (let k = 0; k < 3; k++) { const segs = Math.max(2, Math.round(wl / 12)); for (let q = 0; q < segs; q++) { if (k === 2 && wr() < 0.3) continue; const t = (q + 0.5) / segs - 0.5, len = wl / segs - 0.6; b.box(wx + cs * t * wl, gy + k * 1.6, wz + sn * t * wl, len, 1.7, 5 - k * 0.6, k % 2 ? '#B9AA8E' : '#A99A7E', wa); } } } }
  for (const [dx, dz, da] of [[700, 95, 0.4], [760, 128, 1.9], [950, 365, 0.8], [880, 575, 2.6], [630, 150, 1.1]]) { const gy = groundHeight(dx, dz); if (gy >= 17) b.lying(dx, gy, dz, 3.4, 11, '#CFC4AE', da); }   // column drums left where they fell
  { const hr = mulberry(5); for (const [hx, hz] of HEADLANDS) for (let i = 0; i < 6; i++) { const x = hx + (hr() - 0.5) * 34, z = hz + (hr() - 0.5) * 30, inland = pointInPoly({ x, y: z }, VILLAGE_OUTLINE); const rr = 3 + hr() * 5; b.sphere(x, inland ? 18 + rr * 0.3 : -4 + rr * 0.5, z, rr, i % 2 ? '#C9BBA0' : '#A89A80', 1); } }   // rocky limestone headlands
  const mosaic=new Builder();
  // Nested mosaic courses have separate top surfaces.
  mosaic.cyl(440, 18.4, 420, 78, 78, 0.3, '#F5EEDC', 36); mosaic.cyl(440, 18.75, 420, 52, 52, 0.3, '#ECE3D0', 36); mosaic.cyl(440, 19.1, 420, 46, 46, 0.3, '#E8DBCE', 36); mosaic.cyl(440, 19.45, 420, 40, 40, 0.3, '#F5EEDC', 36);
  for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2; mosaic.box(440 + Math.cos(a) * 76, 18.9, 420 + Math.sin(a) * 76, 5, 0.5, 2.2, '#CFC5AC', -a); }   // flagstone rim
  const land = b.mesh(mats.toon); land.name = 'land'; group.add(land);
  const plaza=mosaic.mesh(mats.decal); plaza.castShadow=false;group.add(plaza);
  // water (river + the sea around the landforms), with a pale shallows glint near shores
  const water = new THREE.Mesh(new THREE.PlaneGeometry(9000, 6000), mats.water); water.rotation.x = -Math.PI / 2; water.position.set(850, -8, 380); water.receiveShadow = true; water.name = 'water'; group.add(water);
  const glint = shoreRings(VILLAGE_OUTLINE, 500, 380, mats); group.add(glint.group);
  scene.add(group);
  return { group, water, glint: glint.foam };
}

export function buildIsleTerrain(scene, mats) {
  const b = new Builder();
  const c = ISLE.center;
  scene.add(shoreRings(ISLE.shore, c.x, c.y, mats).group);
  b.add(extrudeLand(ISLE.shore, 46, -46), P.baseDark);
  b.add(extrudeLand(ISLE.shore, 15, 0), P.rockDark);
  b.add(extrudeLand(inset(ISLE.shore, c.x, c.y, 0.97), 1.2, 14.6), '#B9B48F');
  b.add(extrudeLand(inset(ISLE.shore, c.x, c.y, 0.55), 11, 15), P.rock);
  b.add(extrudeLand(inset(ISLE.shore, c.x, c.y, 0.52), 1.2, 25.6), '#C2BC96');
  b.stairs(c.x - 150, 15, c.y + 60, 30, 7, 2.2, 4, P.stoneDark, -Math.PI / 2);
  b.ancientWall(c.x + 40, 30, c.y - 120, 150, 58, 0.15, 71);                       // one broken high wall
  for (let i = 0; i < 5; i++) { const dx = c.x - 90 + i * 26; b.cyl(dx, 30, c.y + 90, 5, 5.4, 6 + (i % 3) * 7, P.ancient, 10); if (i % 2) b.lying(dx + 8, 30, c.y + 104, 5, 14, P.ancientDark, 0.3 + i * 0.4); } // drum stacks
  for (let i = 0; i < 4; i++) if (i !== 2) b.arch(c.x - 220 + i * 34, 15, c.y - 40 + i * 10, 28, 36, 8, P.ancient, 0.3, 6); b.lying(c.x - 152, 15, c.y - 10, 4, 24, P.ancientDark, 0.9); // fallen arcade
  b.box(c.x + 120, 15, c.y + 160, 90, 8, 30, P.ancientDark, -0.2); b.box(c.x + 170, 15, c.y + 140, 40, 8, 30, P.ancientDark, -0.2); // interrupted terraces
  // a broken skyline, clustered around a conspicuous central absence (the empty plinth ring at Tide Hall)
  for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; b.box(c.x + Math.cos(a) * 70, 26, c.y + Math.sin(a) * 60, 8, 1.6, 8, P.ancientDark, -a); }
  // collapsed rotunda (north-east)
  const rx = 1560, rz = 300;
  for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2; const broken = [2, 5, 6].includes(i) ? 0.3 + (i % 3) * 0.15 : 0; b.column(rx + Math.cos(a) * 30, 15, rz + Math.sin(a) * 30, 3.2, 34, P.ancient, P.ancientDark, broken); }
  for (let i = 0; i < 3; i++) { const a0 = (i / 9) * Math.PI * 2, a1 = ((i + 1) / 9) * Math.PI * 2; const mx = rx + Math.cos((a0 + a1) / 2) * 30, mz = rz + Math.sin((a0 + a1) / 2) * 30; b.box(mx, 49, mz, 22, 4, 7, P.ancient, -(a0 + a1) / 2 + Math.PI / 2); }
  b.add(new THREE.SphereGeometry(30, 14, 8, 0, Math.PI * 0.7, 0, Math.PI / 2), P.ancientDark, new THREE.Matrix4().setPosition(rx, 50, rz));
  b.cyl(rx, 15, rz, 26, 27, 2, P.marbleShade, 18);
  // fractured aqueduct (west side), two arches missing
  for (let i = 0; i < 6; i++) { if (i === 2 || i === 3) { b.box(1240 + i * 30, 15, 420 + i * 6, 8, 12 + (i % 2) * 6, 8, P.ancientDark); continue; } b.arch(1240 + i * 30, 15, 420 + i * 6, 26, 40, 8, P.ancient, -0.2, 5); }
  b.box(1255, 55, 423, 60, 4, 9, P.ancient, -0.2); b.box(1375, 55, 447, 36, 4, 9, P.ancient, -0.2);
  // exposed foundations (south)
  for (let i = 0; i < 4; i++) b.box(1300 + i * 24, 15, 600, 2.5, 4 + (i % 2) * 2, 70, P.ancientDark);
  for (let i = 0; i < 3; i++) b.box(1336, 15, 572 + i * 28, 72, 3.5, 2.5, P.ancientDark);
  // leaning stair tower (east)
  const tg = new THREE.Group(); void tg;
  const towerM = new THREE.Matrix4().makeRotationZ(-0.1).setPosition(1640, 15, 480);
  const tw = new THREE.BoxGeometry(22, 48, 22); tw.translate(0, 24, 0); b.add(tw, P.ancient, towerM);
  for (let i = 0; i < 6; i++) { const s = new THREE.BoxGeometry(8, 2.5, 6); s.translate(-16, 6 + i * 6, 10 - i * 4); b.add(s, P.ancientDark, towerM); }
  const r = mulberry(47);
  for (let i = 0; i < 26; i++) { const x = 1160 + r() * 540, z = 30 + r() * 720; if (!isleLandAt(x, z, 6) || isleLandAt(x, z, 60)) continue; b.sphere(x, 16, z, 3 + r() * 5, i % 2 ? P.rock : P.rockDark); }
  // half-sunk temple in the shallows off the south-west shore
  const tx = 1178, tz = 712;
  b.box(tx, -8, tz, 60, 4, 36, P.marbleShade, -0.3);
  [-20, -7, 7, 20].forEach((dx, i) => b.column(tx + dx * Math.cos(-0.3), -5, tz - dx * Math.sin(-0.3) + 10, 2.8, 24, P.ancient, P.ancientDark, i === 1 ? 0.45 : i === 3 ? 0.7 : 0));
  b.lying(tx - 30, -6, tz - 26, 2.6, 18, P.ancientDark, 0.6); b.box(tx - 2, 17, tz + 10, 40, 3, 6, P.ancient, -0.3);
  for (let i = 0; i < 26; i++) { const a = (i / 26) * Math.PI * 2; const x = c.x + Math.cos(a) * 335, z = c.y + Math.sin(a) * 440; if (x < 1080 || x > 1700 || z < 14 || z > 748 || isleLandAt(x, z)) continue; b.cyl(x, -8, z, 1.6, 2.4, 5, P.red, 6); }
  const m = b.mesh(mats.toon); m.name = 'isle'; scene.add(m); return m;
}

// ---------- architecture ----------
// a soft pool of lamplight on the ground: an additive radial fan whose ramp is steep in linear light, so the sRGB
// result reads as a glow fading to nothing (never a hard disc)
const lightPool = (pool, x, y, z, r, k = 1) => {
  if (!pool) return; const N = 20, pos = [], cols = [];
  const stops = [[0, 0.75], [0.28, 0.32], [0.52, 0.11], [0.76, 0.03], [1, 0]].map(([f, i]) => [f * r, [1.0 * i * k, 0.66 * i * k, 0.26 * i * k]]);
  const jr = mulberry(Math.floor(x * 7 + z * 13)), spokes = Array.from({ length: N + 1 }, () => 0.78 + jr() * 0.42); spokes[N] = spokes[0]; const sq = jr() * Math.PI;
  const P2 = (f, a) => { const i = Math.round(a / (Math.PI * 2) * N) % (N + 1), rf = spokes[i] * (1 + 0.22 * Math.cos(2 * (a - sq))); return [x + Math.cos(a) * f * rf, y + 0.3, z + Math.sin(a) * f * rf]; };
  for (let i = 0; i < N; i++) {
    const a0 = i / N * Math.PI * 2, a1 = (i + 1) / N * Math.PI * 2;
    pos.push(x, y + 0.3, z, ...P2(stops[1][0], a1), ...P2(stops[1][0], a0)); cols.push(...stops[0][1], ...stops[1][1], ...stops[1][1]);
    for (let q = 1; q < stops.length - 1; q++) {
      const [r0, c0] = stops[q], [r1, c1] = stops[q + 1];
      pos.push(...P2(r0, a0), ...P2(r0, a1), ...P2(r1, a1)); cols.push(...c0, ...c0, ...c1);
      pos.push(...P2(r0, a0), ...P2(r1, a1), ...P2(r1, a0)); cols.push(...c0, ...c1, ...c1);
    }
  }
  pushColored(pool, pos, cols);
};
const lampPost = (b, e, pool, x, y, z, h = 8) => { b.cyl(x, y, z, 0.5, 0.7, h, P.woodDark, 6); b.box(x, y + h, z, 2.4, 1.2, 2.4, P.terracotta); e.sphere(x, y + h + 1.6, z, 0.9, P.gold); lightPool(pool, x, y, z, 20); };
const brazier = (b, e, pool, x, y, z) => { b.cyl(x, y, z, 2.2, 1.4, 5, P.marbleDark, 8); b.cyl(x, y + 5, z, 3.2, 2.2, 2, P.stone, 8); e.sphere(x, y + 7.8, z, 1.5, P.gold); lightPool(pool, x, y, z, 24, 1.1); };
const amphora = (b, x, y, z, s = 1) => { b.cyl(x, y, z, 1.2 * s, 0.8 * s, 1.5 * s, P.terracotta, 8); b.cyl(x, y + 1.5 * s, z, 1.9 * s, 1.2 * s, 3 * s, P.terracotta, 8); b.cyl(x, y + 4.5 * s, z, 1.1 * s, 1.9 * s, 1.4 * s, P.terracotta, 8); };
const door = (b, x, y, z, w, h, color, ry = 0) => b.box(x, y, z, w, h, 0.8, color, ry);
const bougainvillea = (b, x, y, z) => { b.blob(x, y, z, 3.5, 2.4, 3, '#D9627A'); b.blob(x - 2.5, y + 2.4, z - 1.5, 2.6, 1.8, 2.4, '#E88AA5'); };
const arcBlock = (b, x, z, ri, ro, h, y0, a0, a1, color) => { const sh = new THREE.Shape(); sh.absarc(x, z, ro, a0, a1, false); sh.absarc(x, z, ri, a1, a0, true); const g = new THREE.ExtrudeGeometry(sh, { depth: h, bevelEnabled: false }); g.rotateX(Math.PI / 2); g.translate(0, y0 + h, 0); b.add(g, color); };
const aoDisc = (ao, x, y, z, rx, rz = rx) => { const g = new THREE.CircleGeometry(1, 18); g.rotateX(-Math.PI / 2); g.scale(rx * 0.68, 1, rz * 0.68); ao.add(g, '#3E3550', new THREE.Matrix4().setPosition(x, y + 0.65, z)); };
const homeBlock = (b, e, x, y, z, w, h, d, seed) => { // whitewashed Cycladic block with a flat terracotta-trimmed roof
  const r = mulberry(seed);
  b.box(x, y, z, w, h, d, P.ivory); b.box(x, y + h, z, w + 3, 1.8, d + 3, P.terracotta); b.box(x, y + h + 1.8, z, w - 1, 0.8, d - 1, P.plaster);
  if (r() < 0.6) { b.box(x - w * 0.2, y + h + 2.6, z - d * 0.1, w * 0.5, 9, d * 0.6, P.plaster); b.box(x - w * 0.2, y + h + 11.6, z - d * 0.1, w * 0.5 + 3, 1.6, d * 0.6 + 3, P.terracotta); }
  door(b, x + 2, y, z + d / 2 + 0.5, 9, 13, P.blue);
  e.box(x - w * 0.3, y + 8, z + d / 2 + 0.5, 7, 7, 0.6, P.shallows); e.box(x + w * 0.32, y + 8, z + d / 2 + 0.5, 7, 7, 0.6, P.shallows);
  b.box(x - w * 0.3 - 5, y + 8, z + d / 2 + 0.8, 2, 7, 0.8, P.blue); b.box(x + w * 0.32 + 5, y + 8, z + d / 2 + 0.8, 2, 7, 0.8, P.blue);
  amphora(b, x + w / 2 + 6, y, z + d / 2 - 4); bougainvillea(b, x - w / 2 - 4, y + 3, z + d / 2 - 3);
};

// Every builder: (b static, e emissive, pool night pools, ao contact discs, x, y0 ground, z, seed) → { h, hit, ... }
export const BUILDERS = {
  plaza(b, e, pool, ao, x, y, z) {
    for (const a of [Math.PI * 0.72, Math.PI * 0.28]) arcBlock(b, x, z, 60, 64, 2.6, y, a - 0.24, a + 0.24, P.marbleShade);   // curved stone benches on the open side (the tiers seat the rest)
    for (const a of [Math.PI * 0.72, Math.PI * 0.28]) arcBlock(b, x, z, 61, 63, 0.8, y + 2.6, a - 0.22, a + 0.22, P.marble);
    lampPost(b, e, pool, x - 42, y, z + 48); lampPost(b, e, pool, x + 42, y, z + 48);
    for (const a of [Math.PI * 0.72, Math.PI * 0.28]) aoDisc(ao, x + Math.cos(a) * 62, y, z + Math.sin(a) * 62, 14, 8);
    for (const [cx, cz, s] of [[x - 82, z - 20, 1.1], [x - 70, z - 44, 0.9], [x + 12, z - 90, 1.0], [x + 34, z - 82, 0.85]]) { b.cyl(cx, y, cz, 0.7, 1, 4, P.woodDark, 5); b.cone(cx, y + 3, cz, 4 * s, 28 * s, '#3C5240', 7); b.cone(cx, y + 11 * s, cz, 2.8 * s, 17 * s, '#4A644E', 7); aoDisc(ao, cx, y, cz, 7, 7); }   // dark cypresses behind the Almond
    amphora(b, x - 62, y, z + 24, 1.2); amphora(b, x + 62, y, z + 24, 1.2);
    return { h: 4, hit: [130, 10, 110] };
  },
  library(b, e, pool, ao, x, y, z, seed) { // the Archive: a home set inside a ruined colonnade
    b.ancientWall(x + 22, y, z - 26, 80, 44, 0, seed + 2);   // kept east of the Green's theatre rim
    [-40, -14, 14, 40].forEach((dx, i) => b.giantColumn(x + dx, y, z + 30, i === 1 ? 0.5 : i === 3 ? 0.78 : 0));
    b.box(x - 13, y + 46, z + 30, 56, 4, 8, P.ancient);
    homeBlock(b, e, x, y, z, 60, 22, 34, seed); b.box(x, y + 24.4, z - 6, 24, 9, 18, P.plaster); b.box(x, y + 33.4, z - 6, 27, 1.6, 21, P.terracotta);
    b.arch(x - 20, y, z + 2, 30, 40, 7, P.ancient, 0, 6); b.lying(x + 42, y, z + 20, 3, 12, P.ancientDark, 1.2);     // the house threads through a ruined arch
    aoDisc(ao, x, y, z + 2, 70, 44);
    return { h: 50, hit: [120, 52, 70] };
  },
  hall(b, e, pool, ao, x, y, z) {
    b.box(x, y, z, 78, 2, 44, P.marbleShade); b.box(x, y + 2, z, 72, 2, 38, P.marble);
    b.box(x, y + 4, z - 15, 66, 22, 3, P.ivory);
    for (const dx of [-28, -14, 0, 14, 28]) {
      b.box(x + dx, y + 4, z + 12, 6, 2, 6, P.marbleShade);
      b.cyl(x + dx, y + 6, z + 12, 2, 2.4, 19, P.ivory, 8);
      b.box(x + dx, y + 25, z + 12, 6, 2, 6, P.marble);
    }
    b.box(x, y + 27, z, 74, 3, 38, P.marble); b.prism(x, y + 30, z, 76, 7, 40, P.terracotta, 0);
    aoDisc(ao, x, y, z, 43, 27); return { h: 37, hit: [80, 40, 46] };
  },
  garden(b, e, pool, ao, x, y, z) { // walled sun garden on ancient foundations
    b.box(x, y, z - 24, 74, 5, 3, P.ancientDark); b.box(x - 22, y, z + 24, 30, 5, 3, P.ancientDark); b.box(x + 26, y, z + 24, 22, 5, 3, P.ancientDark);
    b.box(x - 37, y, z, 3, 5, 48, P.ancientDark); b.box(x + 37, y, z + 8, 3, 5, 32, P.ancientDark);
    b.cyl(x - 18, y, z - 6, 1.2, 1.8, 8, P.woodDark, 5); b.blob(x - 18, y + 11, z - 6, 9, 6, 8, P.oliveSilver); b.blob(x - 22, y + 14, z - 9, 6, 4, 5, P.oliveLight);
    b.cyl(x + 14, y, z - 2, 1.2, 1.8, 9, P.woodDark, 5); b.blob(x + 14, y + 12, z - 2, 10, 6.5, 9, P.oliveSilver); b.blob(x + 10, y + 15, z - 5, 6, 4, 5, P.oliveLight);
    for (let i = 0; i < 14; i++) b.sphere(x - 28 + i * 4.3, y + 1.5, z + 12 + (i % 2) * 4, 1.2, ['#E88AA5', P.gold, '#FFFFFF', P.lilac][i % 4]);
    b.box(x + 26, y, z - 12, 7, 3.5, 7, P.ancientDark, 0.6); b.lying(x - 28, y, z + 4, 2.4, 10, P.ancient, 1.1);
    b.box(x + 4, y, z + 24, 10, 7, 2, P.blue); aoDisc(ao, x, y, z, 42, 30);
    return { h: 16, hit: [80, 18, 54] };
  },
  workshop(b, e, pool, ao, x, y, z, seed) {
    b.ancientWall(x + 34, y, z, 46, 36, Math.PI / 2, seed + 7);
    b.box(x, y, z, 48, 18, 32, P.ivory); b.prism(x, y + 18, z, 52, 12, 36, P.terracotta, 0);
    door(b, x, y, z + 16.5, 12, 13, P.red); e.box(x + 16, y + 8, z + 16.5, 6, 6, 0.6, P.shallows);
    b.box(x - 30, y, z + 10, 8, 2, 8, P.wood); amphora(b, x - 30, y, z + 20); aoDisc(ao, x, y, z, 36, 26);
    return { h: 32, hit: [70, 36, 42] };
  },
  observatory(b, e, pool, ao, x, y, z) { // blue dome on the highland
    b.cyl(x, y, z, 28, 36, 6, P.stone, 14);
    b.cyl(x, y + 6, z, 17, 18, 20, P.ivory, 14); b.cyl(x, y + 26, z, 19, 17, 2, P.marbleShade, 14); b.dome(x, y + 28, z, 18, P.blue, 14);
    b.cyl(x, y + 45.5, z, 4.2, 5.2, 1.6, P.marbleShade, 10); b.cyl(x, y + 47, z, 1.4, 2.2, 5, '#8C6B3F', 8);   // the armillary's plinth (rings are live, see map3d)
    door(b, x, y + 6, z + 17.6, 8, 12, P.red); e.box(x - 10, y + 13, z + 15, 5, 5, 0.6, P.shallows, 0.4);
    aoDisc(ao, x, y, z, 38, 38);
    arcBlock(b, x, z, 38, 41.5, 3.2, y, Math.PI * 0.85, Math.PI * 1.55, P.ancientDark);                                 // a drystone wall around the old precinct
    for (let i = 0; i < 4; i++) { const a = Math.PI * (0.9 + i * 0.2), rr = 46; b.cyl(x + Math.cos(a) * rr, y, z + Math.sin(a) * rr, 2.6, 2.9, 4 + (i % 3) * 4, i % 2 ? P.ancient : P.ancientDark, 8); }   // column stubs
    return { h: 78, hit: [96, 80, 96], armillary: { x, y: y + 52, z } };
  },
  studio(b, e, pool, ao, x, y, z, seed) {
    b.ancientWall(x - 44, y, z - 4, 52, 40, Math.PI / 2, seed + 3);
    homeBlock(b, e, x, y, z, 60, 20, 34, seed);
    b.arch(x + 22, y, z + 4, 28, 36, 7, P.ancient, 0, 6); b.lying(x - 34, y, z + 24, 3, 11, P.ancientDark, 0.2);     // built through an old arch; a drum for a bench
    e.box(x - 12, y + 25, z + 4.6, 16, 7, 0.6, P.shallows); b.box(x - 22, y + 25, z + 4.9, 3, 7, 0.8, P.blue);
    b.box(x + 40, y, z + 14, 1, 14, 1, P.wood); b.box(x + 40, y + 6, z + 14, 9, 8, 0.8, P.ivory, 0.3); aoDisc(ao, x, y, z, 42, 28);
    return { h: 38, hit: [90, 42, 48] };
  },
  market(b, e, pool, ao, x, y, z, seed) { // inhabited broken arcade
    b.box(x, y, z, 120, 2, 50, P.sand);
    for (let i = 0; i < 4; i++) { const ax = x - 45 + i * 30; if (i === 2) { b.box(ax - 11, y + 2, z - 16, 7, 18, 8, P.ancient); b.box(ax + 11, y + 2, z - 16, 7, 10, 8, P.ancientDark); continue; } b.arch(ax, y + 2, z - 16, 26, 38, 8, P.ancient, 0, 7); }
    b.box(x - 45, y + 40, z - 16, 60, 5, 10, P.ancient); b.vines(x + 20, y + 10, z - 16, 60, 24, 8, seed + 5, 7);
    b.box(x - 10, y + 2, z + 12, 100, 2, 30, P.plaster); b.box(x - 10, y + 24, z + 10, 96, 2.5, 34, P.terracotta);
    [-48, -24, 0, 24, 48].forEach((dx, i) => b.column(x - 10 + dx, y + 4, z + 24, 2.4, 20, P.red, P.ink, i === 3 ? 0.5 : 0));
    [-34, -4, 26].forEach((dx, i) => { b.box(x + dx, y + 4, z + 6, 22, 8, 10, P.wood); for (let k = 0; k < 4; k++) b.sphere(x + dx - 7 + k * 4.5, y + 13, z + 6, 1.5, ['#7a4f8a', P.red, P.gold, P.olive][(i + k) % 4]); });
    amphora(b, x - 56, y + 2, z + 18, 1.2); amphora(b, x + 56, y + 2, z + 18, 1.2); lampPost(b, e, pool, x - 60, y, z + 30, 9); lampPost(b, e, pool, x + 60, y, z + 30, 9);
    aoDisc(ao, x, y, z, 70, 36);
    return { h: 46, hit: [130, 48, 60] };
  },
  islePier(b,e,pool,ao,x,y,z) {
    b.stairs(x-16,y,z,16,3,1.4,4,P.stone,Math.PI/2);
    b.box(x+22,-4,z,76,2.5,14,P.wood);
    for(const dx of [-4,12,28,44,58]) for(const dz of [-8,8]) b.cyl(x+dx,-9,z+dz,1,1,10,P.woodDark,6);
    b.box(x+66,-6,z+18,22,4,9,P.blue,.2);b.box(x+66,-2.2,z+18,18,1.2,6,P.ivory,.2);b.cyl(x+66,-2,z+18,.5,.5,16,P.woodDark,5);
    lampPost(b,e,pool,x+56,-4,z-7,9);return {h:10,hit:[96,14,40]};
  },
  pier(b, e, pool, ao, x, y, z) { // the sheltered landing: stone steps down, a timber jetty, a moored boat
    b.box(x,y,z+8,24,2,36,P.ancient);
    b.box(x,y-1,z+39,18,2,44,P.wood);
    for(let dz=24;dz<=60;dz+=9) { b.box(x,y+1.1,z+dz,18,0.5,1,P.woodDark); for(const dx of [-9,9]) b.cyl(x+dx,-9,z+dz,0.8,1,y+12,P.woodDark,6); }
    lampPost(b,e,pool,x+9,y,z+57,9);
    return {h:12,hit:[30,16,105]};
  },
  house(b, e, pool, ao, x, y, z, seed) { // homes built into the ruins
    const r = mulberry(seed);
    const w = 50 + r() * 16, d = 34 + r() * 8, h = 18 + r() * 5;
    const kind = Math.floor(r() * 3);
    if (kind === 0) b.ancientWall(x, y, z - d / 2 - 6, w + 50, 40 + r() * 8, 0, seed + 11);            // against an oversized wall
    else if (kind === 1) { b.giantColumn(x - w / 2 - 10, y, z + 4, r() < 0.5 ? 0.6 : 0); b.giantColumn(x + w / 2 + 10, y, z + 4, 0.45); b.box(x, y + 46, z + 4, w + 20, 4, 8, P.ancient); } // between giant columns
    else { b.ancientWall(x - w / 2 - 8, y, z, d + 30, 34, Math.PI / 2, seed + 13); b.box(x + w / 2 + 12, y, z - 10, 8, 4, 8, P.ancientDark, r()); }
    homeBlock(b, e, x, y, z, w, h, d, seed);
    aoDisc(ao, x, y, z, w * 0.7 + 10, d * 0.7 + 8);
    return { h: h + 14, hit: [w + 30, h + 20, d + 20] };
  },
  tower(b, e, pool, ao, x, y, z) { // bell tower on a ruined square base
    b.box(x, y, z, 34, 6, 34, P.ancientDark); b.ancientWall(x - 24, y, z, 40, 30, Math.PI / 2, 41);
    b.cyl(x, y + 6, z, 10, 11.5, 54, P.ivory, 12); b.cyl(x, y + 60, z, 12, 11, 2, P.marbleShade, 12); b.dome(x, y + 62, z, 11.5, P.blue, 12);
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; b.box(x + Math.cos(a) * 10.6, y + 46, z + Math.sin(a) * 10.6, 4, 9, 1, P.ink, -a); }
    e.sphere(x, y + 51, z, 2.2, P.gold); door(b, x, y + 6, z + 11.4, 7, 11, P.red); aoDisc(ao, x, y, z, 24, 24);
    return { h: 76, hit: [40, 78, 40] };
  },
  shrine(b, e, pool, ao, x, y, z) {
    b.cyl(x, y, z, 16, 18, 1.5, P.sand, 12);
    b.cyl(x, y + 1.5, z, 3, 5, 12, P.marbleShade, 10); b.sphere(x, y + 14, z, 4.2, P.marbleShade);
    b.box(x + 14, y + 1.5, z - 2, 4, 16, 4, P.marble); b.sphere(x + 14, y + 19, z - 2, 2.6, P.marble);
    b.cyl(x - 16, y + 1.5, z + 6, 5, 3.5, 2, P.terracotta, 10); e.cyl(x - 16, y + 3.5, z + 6, 3.6, 3.6, 0.6, P.gold, 10);
    b.cyl(x - 30, y, z - 6, 0.8, 1.2, 6, P.woodDark, 5); b.cone(x - 30, y + 5, z - 6, 5, 24, P.cypress, 7); b.cone(x - 36, y + 3, z + 4, 4, 18, P.cypressLight, 7);
    lampPost(b, e, pool, x + 26, y, z + 10, 7);
    return { h: 22, hit: [60, 26, 40] };
  },
  cafe(b, e, pool, ao, x, y, z, seed) { // café on a fractured ancient terrace; a stair that ends in air
    b.box(x - 10, y, z + 6, 76, 6, 44, P.ancientDark); b.box(x + 34, y, z + 16, 30, 3.5, 24, P.ancientDark, 0.08);
    b.stairs(x + 50, y + 6, z - 12, 12, 6, 2.4, 4, P.ancient, 0.4);
    b.box(x - 8, y + 6, z - 10, 58, 16, 24, P.ivory); b.box(x - 8, y + 22, z - 10, 62, 1.8, 28, P.terracotta);
    door(b, x - 8, y + 6, z + 2.5, 11, 13, P.red); e.box(x - 28, y + 14, z + 2.5, 8, 7, 0.6, P.shallows); e.box(x + 12, y + 14, z + 2.5, 8, 7, 0.6, P.shallows);
    [[-36, 20], [20, 20], [-36, 6], [20, 6]].forEach(([dx, dz]) => b.cyl(x + dx, y + 6, z + dz, 0.8, 1, 13, P.wood, 6));
    b.box(x - 8, y + 19, z + 13, 60, 1.2, 1.4, P.wood); b.box(x - 8, y + 19, z + 6, 60, 1.2, 1.4, P.wood); b.box(x - 8, y + 19, z + 20, 60, 1.2, 1.4, P.wood);
    for (let i = 0; i < 7; i++) b.box(x - 35 + i * 9, y + 19.5, z + 13, 1.2, 1, 16, P.woodDark);
    b.vines(x - 8, y + 18, z + 13, 56, 4, 16, seed + 29, 8);
    [[-26, 24], [8, 24]].forEach(([dx, dz]) => { b.cyl(x + dx, y + 6, z + dz, 0.8, 0.8, 5, P.wood, 5); b.cyl(x + dx, y + 11, z + dz, 5, 5, 0.8, P.plaster, 10); });
    amphora(b, x - 44, y + 6, z + 18, 1.1); lampPost(b, e, pool, x + 26, y + 6, z + 26, 7); aoDisc(ao, x, y, z, 50, 32);
    b.ancientWall(x - 50, y, z - 2, 46, 30, Math.PI / 2, seed + 17);                                                   // the old wall it leans on
    b.arch(x - 30, y + 6, z - 10, 24, 34, 7, P.ancient, Math.PI / 2, 6);                                                 // the roof beam rests on a ruined arch
    b.cyl(x + 44, y + 6, z - 6, 4.2, 4.6, 6, P.ancient, 10); b.cyl(x + 44, y + 12, z - 6, 3.9, 4.2, 5, P.ancientDark, 10); b.lying(x + 36, y + 6, z + 4, 3.4, 10, P.ancientDark, 0.5);   // column drums
    for (const [dx, dz] of [[-26, 24], [8, 24]]) { b.cyl(x + dx - 2, y + 11.8, z + dz + 1, 0.9, 0.7, 1.3, P.terracotta, 6); b.cyl(x + dx + 2, y + 11.8, z + dz - 1, 0.9, 0.7, 1.3, P.blue, 6); b.cyl(x + dx, y + 11.8, z + dz - 2.5, 1.3, 1.1, 2.2, P.terracotta, 6); }   // cups and a jug on each table
    return { h: 30, hit: [100, 36, 60] };
  },
  works(b, e, pool, ao, x, y, z) { // river gate: two giant columns carry a lintel fragment
    b.giantColumn(x - 22, y, z); b.giantColumn(x + 22, y, z); b.box(x, y + 48, z, 62, 6, 10, P.ancient);
    for (let i = -2; i <= 2; i++) b.box(x + i * 6, y, z, 1.2, 30, 1.2, '#8a6a3a');
    brazier(b, e, pool, x - 22, y, z - 10); brazier(b, e, pool, x + 22, y, z - 10);
    return { h: 56, hit: [64, 58, 24] };
  },
  temple(b, e, pool, ao, x, y, z) { // high stepped podium, deep open portico, cella set back
    const W = 124, D = 92;
    for (let i = 0; i < 5; i++) b.box(x, y + i * 3, z + i * 0, W + 36 - i * 7, 3, D + 40 - i * 7, i % 2 ? P.marbleShade : P.marble);
    const y0 = y + 15;
    b.box(x, y0, z - 8, W - 46, 36, D - 50, P.marbleShade); b.box(x, y0, z + 4, 20, 14, 10, P.ink);
    const cols = [];
    for (let i = 0; i < 7; i++) cols.push([-W / 2 + 8 + i * ((W - 16) / 6), D / 2 - 8]);
    for (let i = 1; i < 4; i++) cols.push([-W / 2 + 8, D / 2 - 8 - i * ((D - 16) / 5)], [W / 2 - 8, D / 2 - 8 - i * ((D - 16) / 5)]);
    for (let i = 0; i < 7; i++) cols.push([-W / 2 + 8 + i * ((W - 16) / 6), -D / 2 + 8]);
    for (const [dx, dz] of cols) b.column(x + dx, y0, z + dz, 3.4, 40, P.marble, P.marbleShade);
    b.box(x, y0 + 40, z, W + 4, 6, D + 4, P.marble); b.box(x, y0 + 46, z, W + 6, 1.6, D + 6, '#D9A441');
    b.prism(x, y0 + 47.6, z, W + 8, 22, D + 8, P.marble, 0); b.prism(x, y0 + 47.6, z + D / 2 + 4.1, W, 20, 1.5, P.marbleShade, 0);
    e.cyl(x, y0 + 56, z + D / 2 + 5.4, 4, 4, 1, P.gold, 12);
    b.stairs(x, y, z + D / 2 + 40, 70, 6, 2.5, 5, P.marbleShade, 0);
    for (const dx of [-W / 2 + 10, -W / 6, W / 6, W / 2 - 10]) e.box(x + dx, y0 - 1.4, z + D / 2 - 2, 3.2, 0.9, 1.8, P.gold);   // uplights at the stylobate
    brazier(b, e, pool, x - W / 2 - 16, y + 12, z + D / 2 + 18); brazier(b, e, pool, x + W / 2 + 16, y + 12, z + D / 2 + 18);
    aoDisc(ao, x, y, z + 4, W * 0.9 + 18, D * 0.9 + 16);
    return { h: 96, hit: [W + 50, 98, D + 60] };
  },
  greatlibrary(b, e, pool, ao, x, y, z) { // split-level courtyard with a monumental stair up to the stoa
    const W = 116;
    b.box(x, y, z + 26, W + 20, 2, 40, P.marbleShade);                                // lower court
    b.box(x, y, z - 14, W + 8, 12, 44, P.marbleDark); b.box(x, y + 12, z - 14, W + 4, 1.2, 40, P.marble);  // upper podium
    b.stairs(x, y, z + 10, 60, 5, 2.4, 4, P.marble, 0);
    b.box(x, y + 13, z - 30, W, 34, 14, P.marbleShade);
    for (let i = 0; i < 8; i++) for (let k = 0; k < 2; k++) { b.box(x - W / 2 + 9 + i * ((W - 18) / 7), y + 19 + k * 13, z - 22.5, 8, 7, 1.2, P.ink); for (let s = 0; s < 3; s++) b.cyl(x - W / 2 + 6.5 + i * ((W - 18) / 7) + s * 2.6, y + 20 + k * 13, z - 22.8, 0.8, 0.8, 1.5, P.plaster, 6); }
    for (let i = 0; i < 9; i++) b.column(x - W / 2 + 4 + i * ((W - 8) / 8), y + 13, z + 2, 2.8, 32, P.marble, P.marbleShade);
    b.box(x, y + 45, z - 12, W + 6, 4, 42, P.marble); b.box(x, y + 49, z - 12, W + 8, 1, 44, '#D9A441'); b.prism(x, y + 50, z - 12, W + 10, 8, 46, P.marbleShade, 0);
    brazier(b, e, pool, x - W / 2 - 4, y, z + 40); brazier(b, e, pool, x + W / 2 + 4, y, z + 40);
    for (let i = 0; i < 4; i++) e.box(x - W / 2 + 14 + i * ((W - 28) / 3), y + 12.2, z + 7, 3.2, 0.9, 1.8, P.gold);   // uplights along the stoa
    aoDisc(ao, x, y, z, W * 0.8, 50); aoDisc(ao, x, y, z - 10, W * 0.9 + 2, 50);
    return { h: 60, hit: [W + 40, 62, 100] };
  },
  forge(b, e, pool, ao, x, y, z) { // recessed furnace in a marble block; a sculptural tapered chimney
    b.box(x, y, z, 96, 3, 76, P.marbleShade); b.box(x, y + 3, z, 86, 2, 66, P.marble);
    b.box(x - 12, y + 5, z - 10, 56, 30, 40, P.marbleDark); b.box(x - 12, y + 5, z + 10.5, 24, 16, 2, P.ink);
    e.box(x - 12, y + 6, z + 11.6, 16, 10, 1.4, P.ember); e.box(x - 12, y + 6, z + 12.5, 10, 6, 1, P.gold);
    for (let i = 0; i < 5; i++) b.cyl(x - 22, y + 35 + i * 9, z - 18, 4.2 - i * 0.55, 5.2 - i * 0.55, 9, i % 2 ? P.marbleDark : P.marbleShade, 8);
    b.box(x + 28, y + 5, z + 8, 12, 6, 6, '#B87333'); b.box(x + 28, y + 5, z + 8, 6, 8, 5, '#3E3835');
    b.box(x + 30, y + 5, z - 14, 10, 2, 8, P.wood); amphora(b, x - 40, y + 5, z + 26, 1.2);
    for (let k = 0; k < 3; k++) for (let c = 0; c < 2 - (k > 1 ? 1 : 0); c++) b.box(x + 34 + c * 9, y + 5 + k * 5, z - 24 + (k % 2) * 1.5, 8.5, 5, 7, k % 2 ? P.marbleShade : P.marble, 0.05 * k);   // stacked marble blocks
    for (let k = 0; k < 3; k++) b.lying(x - 36, y + 5 + k * 2.4, z - 20 + (k % 2) * 1.2, 1.2, 16, P.woodDark, 0.1, 6);                                              // timber
    for (let k = 0; k < 4; k++) b.box(x - 34 + k * 3.2, y + 5, z + 14, 0.8, 9 - (k % 2) * 2, 0.8, '#3E3835'); b.box(x - 29, y + 12, z + 14, 12, 0.8, 1.2, P.woodDark);   // a rack of tongs and hammers
    b.cyl(x - 26, y + 5, z - 6, 3.2, 3.6, 4, '#3E3835', 8); b.box(x - 26, y + 9, z - 6, 1, 1.2, 1, P.ember);                                                       // the slack tub
    for (let i = 0; i < 3; i++) b.column(x + 20 + i * 14, y + 5, z + 30, 2.2, 18, P.marble, P.marbleShade); b.box(x + 34, y + 23, z + 30, 40, 3, 8, P.marble);
    aoDisc(ao, x, y, z, 60, 48);
    return { h: 80, hit: [110, 82, 90], ember: { x: x - 22, y: y + 82, z: z - 18 } };
  },
  quarry(b, e, pool, ao, x, y, z) { // rectangular cut terraces rising to the north, pale fresh faces under dark bedrock caps
    for (let i = 0; i < 3; i++) { b.box(x - 8 + i * 8, y + i * 9, z - 26 - i * 15, 128 - i * 22, 9, 30, i % 2 ? CUT[1] : CUT[0]); b.box(x - 8 + i * 8, y + i * 9 + 9, z - 38 - i * 15, 128 - i * 22, 3, 8, P.rockDark); }
    b.box(x, y, z + 8, 124, 1.2, 54, '#E6DDC8');                                                                        // the dusty floor
    for (let i = 0; i < 2; i++) b.box(x - 46 + i * 92, y + 1, z - 2, 10, 10, 26, P.rockDark);                           // unworked bedrock at the edges
    const r = mulberry(31);
    for (let row = 0; row < 2; row++) for (let c = 0; c < 3; c++) for (let k = 0; k < 2 - row; k++) b.box(x - 42 + c * 13.5, y + 1.2 + k * 7, z + 16 + row * 11, 12, 7, 8.5, k ? CUT[0] : CUT[1], 0.04 * c);   // stacked blocks
    for (let i = 0; i < 4; i++) b.box(x + 10 + r() * 40, y + 1.2, z + 10 + r() * 18, 7 + r() * 5, 4 + r() * 3, 6 + r() * 4, CUT[i % 2], r());   // loose blocks
    const cx = x + 36, cz = z + 2;
    b.cyl(cx - 12, y + 1, cz + 10, 1.2, 1.5, 50, P.woodDark, 6); b.cyl(cx + 12, y + 1, cz + 10, 1.2, 1.5, 50, P.woodDark, 6);
    b.box(cx, y + 50, cz + 2, 2.4, 2.4, 46, P.woodDark, 0); b.cyl(cx, y + 24, cz - 18, 0.3, 0.3, 26, '#6b5a44', 4); b.box(cx, y + 18, cz - 18, 9, 6, 7, CUT[0], 0.2);
    brazier(b, e, pool, x - 56, y, z + 28); aoDisc(ao, x, y, z, 70, 36);
    return { h: 60, hit: [136, 62, 80] };
  },
  lighthouse(b, e, pool, ao, x, y, z) { // whitewash tower with blue bands on a broken mole
    b.box(x, y, z + 10, 40, 6, 30, P.rockDark); b.lying(x + 24, y, z + 20, 3, 16, P.ancientDark, 0.4);
    for (let i = 0; i < 6; i++) b.cyl(x, y + 6 + i * 9, z, 7 - i * 0.4, 7.3 - i * 0.4, 9, i % 2 ? P.blue : P.ivory, 12);
    b.cyl(x, y + 60, z, 7.5, 7, 2, P.marbleShade, 12); e.cyl(x, y + 62, z, 5, 5, 7, P.gold, 10); b.dome(x, y + 69, z, 6, P.blue, 10);
    b.giantColumn(x - 20, y, z + 14, 0.5);
    return { h: 78, hit: [44, 80, 44], beam: { x, y: y + 65, z } };
  },
};
const SCALE_OF = { hall:0.9, temple:0.85, greatlibrary:1.05, forge:0.85, quarry:0.8, market:0.9, library:0.85, cafe:0.85, house:0.8, studio:0.9, workshop:0.85, garden:1, tower:1, observatory:1, shrine:0.8, pier:1, works:1, plaza:1, lighthouse:1.2 };
function scaleParts(builder, from, x, y, z, s) { // scale new parts of `builder` about (x,y,z)
  const m = new THREE.Matrix4().makeTranslation(x, y, z).multiply(new THREE.Matrix4().makeScale(s, s, s)).multiply(new THREE.Matrix4().makeTranslation(-x, -y, -z));
  for (let i = from; i < builder.parts.length; i++) builder.parts[i].applyMatrix4(m);
}
export function buildPlace(place, b, e, pool, ao) {
  const kind = place.kind === 'tower' && zoneOf(place) === 'isle' ? 'lighthouse' : place.kind;
  const fn = zoneOf(place)==='isle'&&kind==='pier'?BUILDERS.islePier:BUILDERS[kind] || BUILDERS.house;
  const y0 = groundHeight(place.x, place.y);
  const isleScale={temple:1.6,greatlibrary:1.8,forge:1.6,quarry:1.6,market:1.45,library:1.5,cafe:1.5,house:1.5,studio:1.5,workshop:1.5,garden:1.4,tower:1.3,observatory:1.4,shrine:1.3,pier:1.2,works:1.3,plaza:1.15,lighthouse:1.2};
  const s = zoneOf(place)==='isle' ? isleScale[kind] || 1.4 : SCALE_OF[kind] || 0.85;
  const marks = [b.parts.length, e.parts.length, pool.parts.length, ao.parts.length];
  const info = fn(b, e, pool, ao, place.x, y0, place.y, hashStr(place.id)) || { h: 20, hit: [60, 30, 50] };
  [b, e, pool, ao].forEach((bb, i) => scaleParts(bb, marks[i], place.x, y0, place.y, s));
  info.h = (info.h || 20) * s; info.hit = (info.hit || [60, 30, 50]).map((v) => v * s);
  if (info.ember) info.ember = { x: place.x + (info.ember.x - place.x) * s, y: y0 + (info.ember.y - y0) * s, z: place.y + (info.ember.z - place.y) * s };
  if (info.beam) info.beam = { x: place.x, y: y0 + (info.beam.y - y0) * s, z: place.y };
  if (info.armillary) info.armillary = { x: place.x, y: y0 + (info.armillary.y - y0) * s, z: place.y, s };
  if (zoneOf(place) === 'isle' && kind !== 'lighthouse') { const r = mulberry(hashStr(place.id) + 9); for (let i = 0; i < 3; i++) { const cx = place.x + 30 + (r() - 0.5) * 50, cz = place.y + 34 + (r() - 0.5) * 20; if (r() < 0.4) b.lying(cx, y0, cz, 3, 14, P.ancientDark, r() * 3); else b.column(cx, y0, cz, 3, 16 + r() * 14, P.ancient, P.ancientDark, 0.4 + r() * 0.5); } }
  info.y0 = y0;
  return info;
}
export function buildIsleWorkshop(w, b, e, pool, ao) {
  const { x, y: z } = w; const y = groundHeight(x, z);
  b.box(x, y, z + 14, 86, 4, 30, P.rockDark); b.box(x, y + 4, z + 14, 78, 2, 24, P.rock);
  b.box(x, y + 6, z, 60, 16, 20, P.plaster); b.box(x, y + 22, z, 66, 2.5, 26, P.marbleShade); b.prism(x, y + 24.5, z, 68, 10, 28, P.terracotta, 0);
  [-30, -10, 10, 30].forEach((dx) => b.column(x + dx, y + 6, z + 16, 2.2, 18, P.ivory, P.marbleShade));
  b.box(x, y + 6, z + 10.5, 16, 9, 1, P.ink); e.box(x, y + 8, z + 11.2, 10, 5, 0.6, P.shallows);
  brazier(b, e, pool, x - 44, y + 6, z + 18); brazier(b, e, pool, x + 44, y + 6, z + 18);
  for (let i = -5; i <= 5; i++) b.box(x + i * 9, y + 6, z + 36, 1, 7, 1, P.rockDark); b.box(x, y + 11, z + 36, 92, 0.8, 0.8, P.rockDark);
  b.box(x - 48, y + 6, z + 20, 1, 7, 34, P.rockDark); b.box(x + 48, y + 6, z + 20, 1, 7, 34, P.rockDark);
  aoDisc(ao, x, y, z + 8, 50, 30);
  return { h: 38, hit: [100, 40, 60], smoke: { x: x - 44, y: y + 16, z: z + 18 }, y0: y };
}

// ---------- props (gifts) ----------
export function buildObject(o, b, e, pool) {
  const { x, y: z } = o; const y = groundHeight(x, z);
  switch (o.kind) {
    case 'tree': b.cyl(x, y, z, 1, 1.4, 8, P.woodDark, 5); b.blob(x, y + 11, z, 8, 5.5, 7, P.oliveSilver); b.blob(x - 3, y + 14, z - 2, 5, 3.5, 4.5, P.oliveLight); break;
    case 'flowers': for (let i = 0; i < 3; i++) { b.cyl(x - 3 + i * 3, y, z, 0.2, 0.2, 4, P.olive, 4); b.sphere(x - 3 + i * 3, y + 4.5, z, 1.4, ['#E88AA5', P.gold, '#FFFFFF'][i]); } break;
    case 'lamp': lampPost(b, e, pool, x, y, z, 8); break;
    case 'bench': b.box(x, y, z, 12, 2.6, 4, P.wood); b.box(x, y + 2.6, z - 1.5, 12, 2.2, 1, P.woodDark); break;
    case 'stone': b.cyl(x, y, z, 2.4, 3.2, 7, P.marbleShade, 8); b.sphere(x, y + 7.5, z, 2.6, P.marbleShade); break;
    case 'artwork': b.box(x, y, z, 0.8, 10, 0.8, P.wood); b.box(x, y + 5, z + 0.6, 9, 7, 0.6, P.ivory); b.box(x, y + 6, z + 1.0, 6, 4, 0.3, P.shallows); break;
    case 'lantern': b.cyl(x, y, z, 0.4, 0.5, 11, P.woodDark, 5); b.box(x, y + 11, z, 5, 0.6, 1, P.woodDark); e.cyl(x + 2, y + 6, z, 1.6, 1.6, 4, P.terracotta, 8); lightPool(pool, x, y, z, 16, 0.8); break;
    case 'sign': b.box(x, y, z, 0.8, 9, 0.8, P.wood); b.box(x, y + 6, z, 12, 6, 1, P.plaster); break;
    default: b.sphere(x, y + 2, z, 2.5, P.marbleShade);
  }
}

// ---------- ambient trees (instanced): crooked silver olives, cypress groups, Aleppo pines ----------
export function makeTreeInstances(items, mats) {
  const groups = { olive: [], cypress: [], pine: [] };
  for (const it of items) (groups[it.kind] || groups.olive).push(it);
  const out = [];
  const geoFor = (kind) => {
    const b = new Builder();
    if (kind === 'olive') {
      b.cyl(0, 0, 0, 1.1, 2.0, 5, P.woodDark, 6); const m = new THREE.Matrix4().makeRotationZ(0.35).setPosition(1.2, 7.2, 0); b.add(new THREE.CylinderGeometry(0.8, 1.1, 5, 6), P.woodDark, m);
      b.blob(2.2, 11.5, 0, 8, 4.8, 7, P.oliveSilver, 0.3); b.blob(-2.5, 12.5, -2, 5.5, 3.6, 5, P.oliveLight, 1.1); b.blob(4.5, 13.5, 2.5, 4.6, 3, 4.2, P.olive, 2.1);

    } else if (kind === 'cypress') {
      b.cyl(0, 0, 0, 0.7, 1, 4, P.woodDark, 5); b.cone(0, 3, 0, 4.2, 28, P.cypress, 7); b.cone(0, 11, 0, 3, 18, P.cypressLight, 7);
      b.cyl(6, 0, 3, 0.6, 0.9, 3, P.woodDark, 5); b.cone(6, 2, 3, 3.2, 20, P.cypress, 7);

    } else { b.cyl(0, 0, 0, 0.9, 1.4, 8, P.woodDark, 5); b.blob(1, 11, 0, 7, 3.6, 6, '#5F8273', 0.4); b.blob(3, 13.5, 1, 4.5, 2.6, 4, '#73968A', 1.3); }
    const g = BufferGeometryUtils.mergeGeometries(b.parts, false); g.computeVertexNormals(); return g;
  };
  for (const kind of Object.keys(groups)) {
    const list = groups[kind]; if (!list.length) continue;
    const mesh = new THREE.InstancedMesh(geoFor(kind), mats.toon, list.length);
    const m = new THREE.Matrix4();
    list.forEach((it, i) => { m.makeRotationY(it.ry || 0); m.scale(new THREE.Vector3(it.s, it.s, it.s)); m.setPosition(it.x, it.y || 0, it.z); mesh.setMatrixAt(i, m); });
    mesh.instanceMatrix.needsUpdate = true; mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = `trees-${kind}`;
    out.push(mesh);
  }
  return out;
}
