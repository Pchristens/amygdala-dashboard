// The shared trees in 3D (round 2): The Almond — a gnarled forked trunk, broad horizontal limbs and
// seven to eleven asymmetric blossom masses with gaps to see life beneath — and the Salt Pine.
// Same data rules as trees.js: stage sets size, one bough per branch seeded by id, bloom cohorts
// fade toward fallsAt, fruit and keepsakes hang on boughs.
import * as THREE from 'three';
import { mulberry, hashStr, zoneOf } from './svg-util.js';
import { stageOf, isPine, treeSignature } from './trees.js';
import { Builder, P } from './scene3d.js';

const STAGE = [ // h: fork height, r: canopy radius, limb: main limb length, w: trunk radius, masses
  { h: 26, r: 44, limb: 34, w: 3.6, masses: 6 },
  { h: 32, r: 56, limb: 44, w: 5, masses: 7 },
  { h: 40, r: 72, limb: 56, w: 7, masses: 9 },
  { h: 48, r: 86, limb: 68, w: 9.5, masses: 11 },
  { h: 56, r: 100, limb: 84, w: 12, masses: 13 },
];
const PINK = ['#F8DEE3', '#FDEFF0', '#E0A0B2'];
const PINK_LIGHT = '#FFF4F4';
const SEAGLOW = ['#BFEADB', '#D8F5EA', '#A9DED0'];
const PINE = ['#5F8273', '#73968A', '#4E7266'];
const TRUNK = '#6B4A3A', TRUNK_DARK = '#4F3528';
const fade = (c, now) => { const o = +c.opensAt || 0, f = +c.fallsAt || 0; if (!f || f <= o) return 1; return Math.max(0.12, Math.min(1, (f - now) / (f - o))); };

// a bent limb: chain of tapered cylinders along a curve from `from` in direction `dir`, drooping/lifting
function limb(b, from, dir, len, r0, r1, color, bend = 0.25, segs = 4) {
  let p = from.clone(); const d = dir.clone().normalize(); const pts = [p.clone()];
  for (let i = 1; i <= segs; i++) { const t = i / segs; const q = p.clone().addScaledVector(d, len / segs); q.y += bend * len * (t * t - t) * -1; pts.push(q); p = q; }
  for (let i = 0; i < segs; i++) {
    const a = pts[i], c = pts[i + 1]; const mid = a.clone().lerp(c, 0.5); const seg = c.clone().sub(a); const L = seg.length();
    if (!(L > 1e-3)) continue;
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), seg.normalize());
    const ra = r0 + (r1 - r0) * (i / segs), rb = r0 + (r1 - r0) * ((i + 1) / segs);
    b.add(new THREE.CylinderGeometry(rb, ra, L + 0.4, 7), color, new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)));
  }
  return pts[pts.length - 1];
}

function layout(t) {
  const stage = stageOf(t), S = STAGE[stage], pine = isPine(t);
  const rnd = mulberry(hashStr(`${zoneOf(t)}:${t.species || ''}`));
  const branches = (Array.isArray(t.branches) ? t.branches : []).filter((b) => b && b.id).slice(0, 24);
  const lean = pine ? S.h * 0.3 : 0;
  const fork = new THREE.Vector3(lean, S.h, 0);
  // main limbs (3 for almond, 2 for pine), spreading wide and low
  const mains = [];
  const nMain = pine ? 2 : stage >= 2 ? 3 : 2;
  for (let i = 0; i < nMain; i++) {
    const az = (i / nMain) * Math.PI * 2 + 0.6 + rnd() * 0.5;
    const el = pine ? 0.25 + rnd() * 0.15 : 0.35 + rnd() * 0.25;
    const dir = new THREE.Vector3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
    if (pine) { dir.x += 0.8; dir.normalize(); }
    mains.push({ dir, len: S.limb * (0.85 + rnd() * 0.3), az });
  }
  const boughs = branches.map((b, i) => {
    const br = mulberry(hashStr(b.id));
    const main = mains[i % mains.length];
    const credits = Math.max(0, +b.credits || 0), strength = 0.5 + 0.5 * Math.min(1, credits / 15);
    const t0 = 0.35 + 0.5 * br();
    const start = fork.clone().addScaledVector(main.dir, main.len * t0);
    const side = i % 2 ? 1 : -1;
    const az = main.az + side * (0.6 + br() * 0.5);
    const el = pine ? 0.1 + br() * 0.15 : 0.15 + br() * 0.3;
    const dir = new THREE.Vector3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
    const len = S.limb * 0.6 * (0.6 + 0.4 * strength) * (0.9 + br() * 0.2);
    return { b, i, start, dir, len, width: Math.max(0.6, S.w * 0.28 * strength), strength, br, end: start.clone().addScaledVector(dir, len) };
  });
  return { stage, S, pine, lean, fork, mains, boughs, rnd };
}

export function createTree3D(t, mats) {
  const g = new THREE.Group(); g.name = 'shared-tree';
  g.userData = { type: 'tree', id: zoneOf(t), petals: [], mats };
  return g;
}

export function drawTree3D(g, t, now) {
  const L = layout(t);
  const { stage, S, pine, fork, mains, boughs, rnd } = L;
  for (const c of [...g.children]) g.remove(c);
  const b = new Builder(), e = new Builder(), bl = new Builder();
  const trunkC = pine ? '#6B5A4E' : TRUNK, trunkD = pine ? '#54463C' : TRUNK_DARK;
  // a gnarled, tapering, multi-forked trunk: limbs wander sideways as they thin
  const rr = mulberry(hashStr('limbs:' + zoneOf(t)));
  const wob = (p0, dir, len, r0, r1, color, bend, segs) => {
    let p = p0.clone(); const d = dir.clone().normalize(); const pts = [p.clone()]; const side = new THREE.Vector3(-d.z, 0, d.x).normalize();
    for (let i = 1; i <= segs; i++) { const tt = i / segs; const q = p.clone().addScaledVector(d, len / segs); q.y += bend * len * (tt * tt - tt) * -1; q.addScaledVector(side, (rr() - 0.5) * len / segs * 0.9); pts.push(q); p = q; }
    for (let i = 0; i < segs; i++) { const a = pts[i], c = pts[i + 1]; const mid = a.clone().lerp(c, 0.5); const seg = c.clone().sub(a); const Ls = seg.length(); if (!(Ls > 1e-3)) continue; const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), seg.normalize()); const ra = r0 + (r1 - r0) * (i / segs), rb = r0 + (r1 - r0) * ((i + 1) / segs); b.add(new THREE.CylinderGeometry(rb, ra, Ls + 0.5, 7), color, new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1))); }
    return pts[pts.length - 1];
  };
  b.cyl(0, 0, 0, S.w * 1.15, S.w * 1.7, S.h * 0.22, trunkC, 9);
  for (let i = 0; i < 5; i++) { const a = i * 1.26 + 0.3; b.lying(Math.cos(a) * S.w * 1.5, 0, Math.sin(a) * S.w * 1.5, S.w * 0.3, S.w * 2.4, trunkD, -a + Math.PI / 2, 6); }
  const top = wob(new THREE.Vector3(0, S.h * 0.2, 0), new THREE.Vector3(L.lean * 0.4 + 0.08, 1, 0.1), S.h * 0.82, S.w * 1.1, S.w * 0.62, trunkC, 0.15, 4);
  if (stage >= 2) for (let i = 0; i < 3; i++) { const a = i * 2.1 + 0.4; b.sphere(Math.cos(a) * S.w * 0.75, S.h * (0.3 + i * 0.2), Math.sin(a) * S.w * 0.75, S.w * 0.5, trunkC, 1); } // burls
  if (!pine) {
    const pr = S.w * 2.2 + 6; b.cyl(0, 0, 0, pr + 3, pr + 3.4, 3.4, P.marbleShade, 22); b.cyl(0, 3.4, 0, pr + 3.4, pr + 3.4, 0.6, P.marble, 22); b.cyl(0, 0.2, 0, pr, pr, 3.6, '#6E5A4A', 22);
    const pr2 = mulberry(hashStr('petals' + zoneOf(t))); for (let k = 0; k < 40; k++) { const a = pr2() * 6.28, d = pr + 5 + pr2() * S.r * 0.75; b.cyl(Math.cos(a) * d, 0.55, Math.sin(a) * d, 1.1, 1.1, 0.25, k % 3 ? PINK[1] : PINK[0], 6); }   // fallen petals
  }
  // main limbs fork once into thinner sub-limbs; every end carries blossom
  const limbEnds = [];
  for (const m of mains) {
    const end = wob(top, m.dir, m.len, S.w * 0.6, S.w * 0.22, trunkC, pine ? 0.1 : 0.5, 6);
    limbEnds.push(end);
    for (const sgn of [-1, 1]) { const sub = m.dir.clone(); sub.y += 0.45 + rr() * 0.3; sub.x += sgn * 0.5 * Math.sin(m.az); sub.z -= sgn * 0.5 * Math.cos(m.az); sub.normalize(); limbEnds.push(wob(top.clone().addScaledVector(m.dir, m.len * (0.45 + rr() * 0.2)), sub, m.len * 0.55, S.w * 0.24, S.w * 0.07, trunkD, 0.35, 4)); }
  }
  for (const bo of boughs) wob(bo.start, bo.dir, bo.len, bo.width, bo.width * 0.3, trunkC, 0.25, 3);
  // crown (round-9 construction): an umbrella of eleven to seventeen smaller ivory-pink clusters with rose undersides,
  // every fourth left open, raised a little so the forked trunk shows beneath it at default zoom
  const masses = [];
  if (!pine) {
    const n = Math.max(11, S.masses + 4), R = S.r;
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2 + rnd() * 0.5, rad = R * (i % 3 === 0 ? 0.3 : 0.52 + rnd() * 0.3);
      const c = new THREE.Vector3(fork.x + Math.cos(a) * rad, fork.y + R * (0.26 + 0.3 * (1 - (rad / R) ** 2)) + (rnd() - 0.5) * R * 0.16, fork.z + Math.sin(a) * rad * 0.9);
      const rx = R * (0.22 + rnd() * 0.1), ry = rx * 0.6, rz = rx * (0.85 + rnd() * 0.25);
      masses.push({ c, rx, ry, rz });
      bl.blob(c.x, c.y - ry * 0.3, c.z, rx * 0.92, ry * 0.75, rz * 0.92, PINK[2], rnd() * 3);                          // rose underside (slightly smaller)
      if (i % 4 !== 3) bl.blob(c.x + rx * 0.1, c.y + ry * 0.1, c.z, rx * 0.95, ry * 0.85, rz * 0.95, PINK[0], rnd() * 3);   // body (every fourth cluster stays open)
      bl.blob(c.x - rx * 0.1, c.y + ry * 0.6, c.z - rz * 0.1, rx * 0.7, ry * 0.6, rz * 0.7, PINK_LIGHT, rnd() * 3);   // lit top
    }
    const ct = fork.clone().add(new THREE.Vector3(0, R * 0.54, 0)); bl.blob(ct.x, ct.y, ct.z, R * 0.3, R * 0.17, R * 0.28, PINK[1], 0.4); bl.blob(ct.x, ct.y + R * 0.1, ct.z, R * 0.26, R * 0.14, R * 0.24, PINK_LIGHT, 1.2); masses.push({ c: ct, rx: R * 0.3, ry: R * 0.17, rz: R * 0.28 });
  } else {
    const tuft = (p, s, c) => b.blob(p.x, p.y + s * 0.3, p.z, s * 1.6, s * 0.7, s * 1.3, c, rnd() * 3);
    for (const end of limbEnds) tuft(end, Math.max(5, S.r * 0.22), PINE[0]);
    for (const bo of boughs) { tuft(bo.end, Math.max(4, S.r * 0.16) * (0.8 + 0.4 * bo.strength), PINE[(bo.i + 1) % 3]); tuft(bo.start.clone().lerp(bo.end, 0.5), Math.max(3, S.r * 0.12), PINE[bo.i % 3]); }
    tuft(fork.clone().add(new THREE.Vector3(2, S.r * 0.25, 0)), Math.max(5, S.r * 0.24), PINE[2]);
    masses.push(...limbEnds.map((c) => ({ c, rx: S.r * 0.22, ry: S.r * 0.12, rz: S.r * 0.2 })));
  }
  // blossom cohorts: small bright flowers sprinkled on the masses near their branch; fade shrinks them
  const cohorts = (Array.isArray(t.blooms) ? t.blooms : []).filter((c) => c && +c.count > 0);
  const totalOpen = Math.max(0, +t.blossoms || 0);
  let placed = 0;
  const sprinkle = (m, n, op, seed) => { const r2 = mulberry(hashStr(seed)); for (let k = 0; k < n; k++) { const a = r2() * 6.28, d = Math.sqrt(r2()); bl.sphere(m.c.x + Math.cos(a) * d * m.rx, m.c.y + (r2() - 0.2) * m.ry, m.c.z + Math.sin(a) * d * m.rz, (1.1 + r2() * 1.1) * (0.5 + 0.5 * op), (pine ? SEAGLOW : [PINK_LIGHT, '#FFFFFF', PINK[0]])[k % 3], 0); } };
  for (const c of cohorts) {
    const bo = boughs.find((x) => x.b.id === c.branchId);
    const m = bo ? (masses.find((mm) => mm.c.distanceTo(bo.end) < S.r * 0.6) || masses[0]) : masses[masses.length - 1];
    if (m) { const n = Math.min(24, Math.ceil(+c.count)); sprinkle(m, n, fade(c, now), `${c.branchId}|${c.opensAt}`); placed += n; }
  }
  if (totalOpen > placed && masses.length) sprinkle(masses[masses.length - 1], Math.min(24, totalOpen - placed), 1, 'crown');
  // fruit & keepsakes
  for (const bo of boughs) {
    const p = bo.start.clone().lerp(bo.end, 0.85);
    if (bo.b.fruit) for (let k = 0; k < 3; k++) b.sphere(p.x + (k - 1) * 2, p.y - 3 - (k % 2), p.z + (k % 2) * 2, 1.4, pine ? '#8A6A4A' : '#C9344A', 0);
    if (bo.b.keepsake) { const m = bo.start.clone().lerp(bo.end, 0.5); b.cyl(m.x, m.y - 5, m.z, 0.15, 0.15, 5, '#8A6A4A', 4); e.add(new THREE.OctahedronGeometry(1.8), P.gold, new THREE.Matrix4().setPosition(m.x, m.y - 6.5, m.z)); }
  }
  // lanterns under the canopy
  if (stage >= 1) for (const m of mains.slice(0, 2)) { const p = fork.clone().addScaledVector(m.dir, m.len * 0.6); b.cyl(p.x, p.y - 7, p.z, 0.15, 0.15, 7, '#5A4231', 4); e.box(p.x, p.y - 10.5, p.z, 2.6, 3.4, 2.6, P.terracotta); }
  if (stage >= 2) for (const sx of [-1, 1]) { const x = sx * (S.r * 0.8 + 6); b.cyl(x, 0, 8, 0.5, 0.7, 7, '#4A3A2A', 6); b.box(x, 7, 8, 2.6, 1.2, 2.6, P.terracotta); e.sphere(x, 8.6, 8, 0.9, P.gold); }
  const mats = g.userData.mats;
  const body = b.mesh(mats.toon); if (body) g.add(body);
  const blooms = bl.mesh(mats.toon); if (blooms) { blooms.castShadow = true; g.add(blooms); }
  const lit = e.mesh(mats.emissive); if (lit) { lit.castShadow = false; g.add(lit); }
  const hit = new THREE.Mesh(new THREE.CylinderGeometry(S.r * 0.85 + 6, S.w * 2 + 6, S.h + S.r * 0.9, 10), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.set(0, (S.h + S.r * 0.9) / 2, 0); hit.userData = { pick: { type: 'tree', id: zoneOf(t) } }; g.add(hit);
  g.userData.layout = L; g.userData.sig = treeSignature(t, now) + (t.sealed ? '#sealed' : ''); g.userData.swayPhase = Math.random() * 6.28;
}

export function tickTree3D(g, t, dt, time) {
  const L = g.userData.layout; if (!L) return false;
  const open = Math.max(0, +t.blossoms || 0);
  g.rotation.z = Math.sin(time * 0.5 + g.userData.swayPhase) * 0.01;
  let active = false;
  const petals = g.userData.petals;
  const maxAlive = t.sealed ? 0 : (L.pine ? (open > 0 ? 4 + L.stage * 4 : 0) : Math.max(3, open > 0 ? 4 + L.stage * 4 : 0));
  if (petals.length < maxAlive && Math.random() < Math.max(open > 0 ? 0 : 0.25, Math.min(1, open / 30)) * (dt / 1200)) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.4), new THREE.MeshBasicMaterial({ color: (L.pine ? SEAGLOW : PINK)[Math.floor(Math.random() * 3)], side: THREE.DoubleSide, transparent: true }));
    const a = Math.random() * 6.28, d = Math.random() * L.S.r * 0.7;
    m.position.set(L.fork.x + Math.cos(a) * d, L.fork.y + L.S.r * 0.3 + Math.random() * L.S.r * 0.3, L.fork.z + Math.sin(a) * d);
    m.userData = { vx: 4 + Math.random() * 6, vy: -(5 + Math.random() * 5), vz: (Math.random() - 0.5) * 4, ph: Math.random() * 6.28, life: 0, ttl: 4 + Math.random() * 3 };
    g.add(m); petals.push(m);
  }
  const ds = dt / 1000;
  for (let i = petals.length - 1; i >= 0; i--) {
    const p = petals[i], u = p.userData; u.life += ds;
    if (u.life > u.ttl || p.position.y < 1) { g.remove(p); p.geometry.dispose(); p.material.dispose(); petals.splice(i, 1); continue; }
    p.position.x += (u.vx + Math.sin(time * 2.2 + u.ph) * 5) * ds; p.position.y += u.vy * ds * 0.6; p.position.z += (u.vz + Math.cos(time * 1.7 + u.ph) * 3) * ds;
    p.rotation.set(time * 2 + u.ph, time * 1.5, u.ph); p.material.opacity = Math.min(1, (u.ttl - u.life) / 1.2) * 0.95;
    active = true;
  }
  return active || open > 0 || (!L.pine && !t.sealed);
}
