// Articulated low-poly figures: living statuettes built from each resident's `appearance`
// (material = skin, modular hair/garment/headwear/held item/accessory), procedural walk/idle/
// gesture animation, CSS2D name labels and speech bubbles. Gods are 1.25× marble with a gold halo;
// sealed figures wear a hooded cloak; an unsculpted resident is a plain clay figure.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/CSS2DRenderer.js';
import { laGlyphs } from './svg-util.js';

export const FIGURE_H = 11; // world units, head to sandal
const MATERIALS = {
  marble: { color: '#EFEAE0', roughness: 0.45, metalness: 0.02 },
  alabaster: { color: '#F7F2E8', roughness: 0.35, metalness: 0.0 },
  terracotta: { color: '#C9754F', roughness: 0.85, metalness: 0.0 },
  bronze: { color: '#8C6B3E', roughness: 0.35, metalness: 0.75 },
  basalt: { color: '#3C3A3C', roughness: 0.6, metalness: 0.1 },
  sandstone: { color: '#D9B98B', roughness: 0.9, metalness: 0.0 },
  clay: { color: '#B8865B', roughness: 0.95, metalness: 0.0 },
  'olive-wood': { color: '#8A6A4A', roughness: 0.7, metalness: 0.0 },
};
const HEX = /^#[0-9a-f]{6}$/i;
const matCache = new Map();
function mat(key, spec) {
  const k = `${key}|${spec.color}|${spec.roughness}|${spec.metalness}|${spec.emissive || ''}`;
  if (matCache.has(k)) return matCache.get(k);
  const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(spec.color), roughness: spec.roughness ?? 0.7, metalness: spec.metalness ?? 0, flatShading: true });
  if (spec.emissive) { m.emissive = new THREE.Color(spec.emissive); m.emissiveIntensity = spec.emissiveIntensity ?? 1; }
  matCache.set(k, m);
  return m;
}
const geoCache = new Map();
const geo = {
  box: (w, h, d) => new THREE.BoxGeometry(w, h, d),
  cyl: (rt, rb, h, s = 8) => new THREE.CylinderGeometry(rt, rb, h, s),
  sph: (r) => new THREE.IcosahedronGeometry(r, 1),
  torus: (r, t) => new THREE.TorusGeometry(r, t, 5, 12),
};
for (const key of Object.keys(geo)) { const make = geo[key]; geo[key] = (...args) => { const id = `${key}:${args.join(',')}`; if (!geoCache.has(id)) geoCache.set(id, make(...args)); return geoCache.get(id); }; }
function mesh(g, m, x = 0, y = 0, z = 0) { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = true; return o; }
function addR(parent, o, rx = 0, ry = 0, rz = 0) { o.rotation.set(rx, ry, rz); parent.add(o); return o; }

// Resolve an appearance (or null) + role into a concrete recipe.
export function recipe(spec) {
  const a = spec.appearance && typeof spec.appearance === 'object' ? spec.appearance : null;
  const god = spec.kind === 'god';
  const skinKey = god ? 'marble' : a ? (MATERIALS[a.material] ? a.material : 'clay') : 'clay';
  const garmentColor = god ? '#EFEAE0' : a && HEX.test(a.garment_color_hex) ? a.garment_color_hex : spec.color && HEX.test(spec.color) ? spec.color : '#B8A48A';
  const trimColor = god ? (spec.toolColor || '#F2C14E') : a && HEX.test(a.trim_color_hex) ? a.trim_color_hex : '#F2C14E';
  const hairColor = a && HEX.test(a.hair_color_hex) ? a.hair_color_hex : '#3B2F26';
  const build = a && ['slight', 'average', 'sturdy', 'tall'].includes(a.build) ? a.build : 'average';
  return {
    god, you: spec.kind === 'you', priest: spec.rank === 'priest', hooded: !!spec.hooded, unsculpted: !a && !god && spec.kind !== 'you',
    skin: MATERIALS[skinKey], skinKey, garment: a?.garment || (spec.kind === 'you' ? 'tunic-and-cloak' : 'chiton'), garmentColor, trimColor,
    hair: a?.hair || (spec.kind === 'you' ? 'short' : 'none'), hairColor,
    headwear: spec.rank === 'priest' ? 'laurel-wreath' : a?.headwear || (spec.kind === 'you' ? 'petasos-hat' : 'none'),
    held: spec.rank === 'priest' ? 'staff' : a?.held || 'none', accessory: a?.accessory || 'none',
    gait: a?.gait || (spec.rank === 'priest' ? 'stately' : 'ambling'), build,
    scale: (god ? 1.25 : 1) * (build === 'tall' ? 1.12 : 1), wide: build === 'sturdy' ? 1.15 : build === 'slight' ? 0.9 : 1,
    sig: JSON.stringify([skinKey, garmentColor, trimColor, hairColor, a?.garment, a?.hair, a?.headwear, a?.held, a?.accessory, build, spec.kind, spec.rank, !!spec.hooded, spec.toolColor]),
  };
}

export function createFigure(spec) {
  const root = new THREE.Group();
  root.name = 'figure';
  root.userData = { type: spec.kind, id: spec.id, pick: { type: spec.kind === 'god' ? 'worker' : spec.kind === 'you' ? 'you' : spec.kind === 'visitor' ? 'visitor' : 'resident', id: spec.id } };
  const F = { root, spec, parts: {}, anim: { phase: Math.random() * 6.28, state: 'idle', gesture: null, gestureT: 0, lookT: 0, look: 0, breathe: Math.random() * 6 }, bubbleQueue: [], bubbleEl: null, bubbleTimer: null };
  // hit volume (enlarged click target)
  const hit = new THREE.Mesh(geo.cyl(6, 6, FIGURE_H * 1.5, 6), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.y = FIGURE_H * 0.75; hit.userData = root.userData; root.add(hit);
  F.hit = hit;
  // label
  const lbl = document.createElement('div');
  lbl.className = 'lbl lbl-name';
  const lblObj = new CSS2DObject(lbl); lblObj.position.set(0, -1.5, 0); root.add(lblObj);
  F.label = lbl; F.labelObj = lblObj;
  // bubble anchor above the head
  const bubbleHost = document.createElement('div');
  bubbleHost.className = 'bubble-host';
  const bubbleObj = new CSS2DObject(bubbleHost); root.add(bubbleObj);
  F.bubbleHost = bubbleHost; F.bubbleObj = bubbleObj;
  // contact shadow
  const shade = new THREE.Mesh(new THREE.CircleGeometry(4.4, 14), new THREE.MeshBasicMaterial({ color: '#2A2238', transparent: true, opacity: 0.26, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
  shade.rotation.x = -Math.PI / 2; shade.position.y = 0.5; shade.scale.set(1.15, 0.9, 1); root.add(shade);
  // status ring on the ground (gods)
  const ring = new THREE.Mesh(new THREE.RingGeometry(6, 7.6, 24), new THREE.MeshBasicMaterial({ color: '#86C98E', transparent: true, opacity: 0, depthWrite:false, polygonOffset:true, polygonOffsetFactor:-4, polygonOffsetUnits:-4 }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.3; ring.renderOrder = 2; root.add(ring);
  F.ring = ring;
  buildBody(F);
  return F;
}

function buildBody(F) {
  const R = recipe(F.spec);
  F.recipe = R;
  if (F.body) F.root.remove(F.body);
  const body = new THREE.Group();
  body.name = 'body';
  const s = R.scale, w = R.wide;
  body.scale.set(s * w, s, s * w);
  F.root.add(body);
  F.body = body;
  const skin = mat(`skin-${R.skinKey}`, R.unsculpted ? MATERIALS.clay : R.skin);
  const garment = mat('garment', { color: R.unsculpted ? '#A97A52' : R.garmentColor, roughness: R.god ? 0.5 : 0.85, metalness: R.god ? 0.02 : 0 });
  const trim = mat('trim', { color: R.trimColor, roughness: 0.6, metalness: 0.1 });
  const hair = mat('hair', { color: R.hairColor, roughness: 0.8 });
  const cloak = mat('cloak', { color: '#2D2A44', roughness: 0.9 });
  const gold = mat('gold', { color: '#F2C14E', roughness: 0.35, metalness: 0.6, emissive: '#F2C14E', emissiveIntensity: 0.35 });
  const leaf = mat('leaf', { color: '#4F8A5B', roughness: 0.8 });
  const P = F.parts;
  const legH = 4, hipY = legH + 0.4, torsoH = 4.6, headR = 1.9;
  // legs (pivot at hip)
  for (const side of [-1, 1]) {
    const leg = new THREE.Group(); leg.position.set(side * 1.05, hipY, 0);
    leg.add(mesh(geo.cyl(0.75, 0.6, legH, 6), skin, 0, -legH / 2, 0));
    leg.add(mesh(geo.box(1.5, 0.5, 2.2), mat('sandal', { color: '#6B5240', roughness: 0.9 }), 0, -legH - 0.1, 0.3));
    body.add(leg); P[side < 0 ? 'legL' : 'legR'] = leg;
  }
  // torso / garment
  const torso = new THREE.Group(); torso.position.y = hipY; body.add(torso); P.torso = torso;
  const long = R.garment === 'robe' || R.priest || R.garment === 'peplos';
  const gH = long ? torsoH + legH - 0.3 : torsoH;
  const gY = long ? -(legH - 0.3) : 0;
  torso.add(mesh(geo.cyl(2.1, long ? 2.9 : 2.5, gH, 8), garment, 0, gY + gH / 2, 0));
  if (R.garment === 'peplos') torso.add(mesh(geo.cyl(2.55, 2.35, 1.6, 8), garment, 0, torsoH - 1.2, 0)); // overfold
  if (R.garment === 'exomis') torso.add(mesh(geo.sph(1.0), skin, 1.7, torsoH - 0.6, 0)); // bare shoulder
  if (R.garment === 'himation' || R.garment === 'tunic-and-cloak' || R.accessory === 'cape') {
    const cape = mesh(geo.box(4.4, long ? gH : torsoH + 2.5, 0.5), R.garment === 'himation' ? trim : garment, 0, gY + gH / 2 - 0.2, -1.9);
    cape.rotation.x = 0.08; torso.add(cape);
  }
  addR(torso, mesh(geo.torus(2.2, 0.28), trim, 0, torsoH * 0.55, 0), Math.PI / 2); // belt
  if (!R.unsculpted) torso.add(mesh(geo.sph(0.45), gold, -1.6, torsoH - 0.2, 1.4)); // shoulder pin
  if (R.accessory === 'sash') { const sash = mesh(geo.box(0.9, torsoH + 1, 0.4), trim, 0, torsoH / 2, 2.2); sash.rotation.z = 0.6; torso.add(sash); }
  if (R.accessory === 'satchel') torso.add(mesh(geo.box(1.8, 1.6, 0.9), mat('leather', { color: '#7A5A3B', roughness: 0.9 }), 2.4, 0.6, 0.4));
  if (R.accessory === 'necklace') addR(torso, mesh(geo.torus(1.1, 0.16), gold, 0, torsoH - 0.3, 0.9), Math.PI / 2 - 0.5);
  // arms (pivot at shoulder)
  for (const side of [-1, 1]) {
    const arm = new THREE.Group(); arm.position.set(side * 2.5, torsoH - 0.3, 0);
    arm.add(mesh(geo.cyl(0.55, 0.45, 3.8, 6), skin, 0, -1.9, 0));
    const hand = mesh(geo.sph(0.55), skin, 0, -4.0, 0); arm.add(hand);
    if (R.accessory === 'bracelet' && side > 0) arm.add(mesh(geo.torus(0.6, 0.12), gold, 0, -3.2, 0));
    torso.add(arm); P[side < 0 ? 'armL' : 'armR'] = arm; if (side > 0) P.handR = hand;
  }
  // head
  const head = new THREE.Group(); head.position.y = torsoH + 1.2; torso.add(head); P.head = head;
  head.add(mesh(geo.cyl(0.6, 0.7, 1.2, 6), skin, 0, 0, 0));
  head.add(mesh(geo.sph(headR), skin, 0, headR + 0.6, 0));
  const hy = headR + 0.6;
  // hair
  if (R.hair === 'short' || R.hair === 'long' || R.hair === 'braided' || R.hair === 'bun' || R.hair === 'crested') head.add(mesh(new THREE.SphereGeometry(headR + 0.25, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.55), hair, 0, hy + 0.1, 0));
  if (R.hair === 'curly') for (let i = 0; i < 7; i++) { const a = i * 0.9; head.add(mesh(geo.sph(0.8), hair, Math.cos(a) * 1.6, hy + 0.9 + Math.sin(i) * 0.5, Math.sin(a) * 1.6)); }
  if (R.hair === 'long') head.add(mesh(geo.box(3.2, 3.4, 1.2), hair, 0, hy - 1.2, -1.6));
  if (R.hair === 'braided') head.add(mesh(geo.cyl(0.45, 0.35, 4.5, 6), hair, 0, hy - 2.2, -2.0));
  if (R.hair === 'bun') head.add(mesh(geo.sph(0.9), hair, 0, hy + 1.6, -1.2));
  if (R.hair === 'crested') head.add(mesh(geo.box(0.8, 1.4, 3.2), hair, 0, hy + 2.2, -0.4));
  // headwear
  if (R.headwear === 'laurel-wreath' || R.headwear === 'olive-wreath') { const t = mesh(geo.torus(headR + 0.1, 0.32), R.headwear === 'laurel-wreath' ? leaf : mat('olive', { color: '#7F8F5F' }), 0, hy + 0.9, 0); t.rotation.x = Math.PI / 2 + 0.25; head.add(t); }
  if (R.headwear === 'circlet') { const t = mesh(geo.torus(headR + 0.05, 0.18), gold, 0, hy + 0.9, 0); t.rotation.x = Math.PI / 2; head.add(t); }
  if (R.headwear === 'petasos-hat') { head.add(mesh(geo.cyl(3.6, 3.8, 0.35, 12), mat('straw', { color: '#D9C27A', roughness: 1 }), 0, hy + 1.6, 0)); head.add(mesh(geo.cyl(1.4, 1.9, 1.4, 10), mat('straw', { color: '#D9C27A', roughness: 1 }), 0, hy + 2.3, 0)); }
  if (R.headwear === 'veil') head.add(mesh(geo.cyl(1.2, 2.9, 5.5, 8, true), mat('veil', { color: R.trimColor, roughness: 0.9 }), 0, hy - 1.2, -0.6));
  if (R.headwear === 'hood' || R.hooded) head.add(mesh(geo.cyl(0.8, 2.6, 3.6, 8), cloak, 0, hy + 1, -0.3));
  // held item in the right hand
  const held = new THREE.Group(); P.handR.add(held); P.held = held; F.heldKind = R.held;
  const HELD = {
    scroll: () => { held.add(mesh(geo.cyl(0.5, 0.5, 2.6, 8), mat('paper', { color: '#F3EEE2' }), 0, 0, 0.6)); held.rotation.x = Math.PI / 2; },
    book: () => held.add(mesh(geo.box(1.8, 0.5, 2.2), mat('book', { color: '#A4362B' }), 0, 0, 0.8)),
    staff: () => { held.add(mesh(geo.cyl(0.22, 0.26, 12, 6), mat('wood', { color: '#8A6A4A' }), 0, 2.5, 0)); held.add(mesh(geo.sph(0.7), gold, 0, 8.7, 0)); },
    lantern: () => { held.add(mesh(geo.cyl(0.9, 0.9, 1.8, 8), mat('lantern', { color: '#C2603F', emissive: '#F2C14E', emissiveIntensity: 0 }), 0, -1.6, 0.4)); held.add(mesh(geo.cyl(0.08, 0.08, 1.2, 4), mat('wood', { color: '#5A4231' }), 0, -0.4, 0.4)); },
    lyre: () => { const u = mesh(geo.torus(1.4, 0.22), mat('wood', { color: '#8A6A4A' }), 0, 0.8, 0.8); u.rotation.y = 0.3; held.add(u); for (let i = -1; i <= 1; i++) held.add(mesh(geo.cyl(0.05, 0.05, 2.4, 3), gold, i * 0.5, 0.8, 0.8)); },
    quill: () => addR(held, mesh(geo.cyl(0.08, 0.2, 2.4, 4), mat('quill', { color: '#F3EEE2' }), 0, 0.6, 0.6), -0.5),
    trowel: () => { held.add(mesh(geo.box(1.4, 0.2, 2.0), mat('iron', { color: '#8c8a80', metalness: 0.6, roughness: 0.4 }), 0, -0.6, 1.2)); held.add(mesh(geo.cyl(0.25, 0.3, 1.4, 5), mat('wood', { color: '#8A6A4A' }), 0, 0, 0)); },
    hammer: () => { held.add(mesh(geo.cyl(0.22, 0.26, 3.6, 5), mat('wood', { color: '#8A6A4A' }), 0, 0.6, 0)); held.add(mesh(geo.box(1.8, 0.9, 0.9), mat('iron', { color: '#6b655c', metalness: 0.6, roughness: 0.4 }), 0, 2.4, 0)); },
    basket: () => held.add(mesh(geo.cyl(1.1, 0.8, 1.3, 8), mat('wicker', { color: '#C9B778', roughness: 1 }), 0, -1.3, 0.3)),
    amphora: () => { const clay = mat('cup', { color: '#C2603F' }); held.add(mesh(geo.sph(1), clay, 0, -0.5, 0.6)); held.add(mesh(geo.cyl(0.4, 0.55, 1.4), clay, 0, 0.7, 0.6)); for (const side of [-1, 1]) held.add(mesh(geo.torus(0.55, 0.14), clay, side * 0.9, 0.1, 0.6)); },
    cup: () => held.add(mesh(geo.cyl(0.6, 0.45, 1.0, 8), mat('cup', { color: '#C2603F' }), 0, -0.2, 0.5)),
    teapot: () => { held.add(mesh(geo.sph(1.0), mat('cup', { color: '#C2603F' }), 0, -0.6, 0.6)); addR(held, mesh(geo.cyl(0.15, 0.25, 1.4, 5), mat('cup', { color: '#C2603F' }), 0.9, -0.2, 0.9), 0, 0, -0.9); held.add(mesh(geo.torus(0.5, 0.1), mat('cup', { color: '#C2603F' }), -0.9, -0.5, 0.6)); },
  };
  if (!R.hooded && HELD[R.held]) HELD[R.held]();
  // priest robe accent, god halo, hooded cloak
  if (R.priest) addR(torso, mesh(geo.torus(2.9, 0.3), gold, 0, gY + 0.4, 0), Math.PI / 2);
  if (R.god) { const halo = mesh(geo.torus(2.4, 0.22), gold, 0, hy + 3.6, 0); halo.rotation.x = Math.PI / 2; halo.castShadow = false; head.add(halo); P.halo = halo; }
  if (R.hooded || F.spec.kind === 'visitor') {
    const c = mesh(geo.cyl(2.4, 4.2, torsoH + legH + 1.5, 8), cloak, 0, -(legH) / 2 + 1.0, 0); torso.add(c);
    if(R.hooded) for (const k of ['armL', 'armR']) P[k].visible = false;
    const g = document.createElement('div'); void g;
  }
  F.label.className = `lbl lbl-name ${R.you ? 'you' : ''} ${R.hooded ? 'hooded' : ''} ${R.god ? 'lbl-god' : ''}`;
  F.label.textContent = R.hooded ? laGlyphs(F.spec.id, 2) : String(F.spec.name || '');
  F.bubbleObj.position.set(0, (torsoH + legH + headR * 2 + 4) * s, 0);
  F.gaitK = { brisk: 1.35, stately: 0.8, ambling: 1, bouncy: 1.2 }[R.gait] || 1;
}

export function setFigureSpec(F, spec) {
  const next = recipe({ ...spec });
  const changed = next.sig !== F.recipe.sig;
  F.spec = spec;
  if (changed) buildBody(F);
  else if (F.label.textContent !== String(spec.name || '') && !next.hooded) F.label.textContent = String(spec.name || '');
}

// ---- animation ----
const STATUS_COLORS = { running: '#86C98E', waiting: '#F2C14E', idle: '#B9B2A0', stopped: '#8F8A80', error: '#E2554A', stale: '#B9B2A0' };
export function setStatus(F, status) {
  F.status = status;
  const c = STATUS_COLORS[status] || STATUS_COLORS.idle;
  F.ring.material.color.set(c);
  F.ring.material.opacity = status ? (status === 'idle' || status === 'stale' ? 0.35 : 0.8) : 0;
  F.root.visible = true;
  F.body.traverse((o) => { if (o.material && status === 'stale') { /* dimmed via opacity below */ } });
  F.dim = status === 'stale' || status === 'stopped';
}
export function gesture(F, name, dur = 2.2) { F.anim.gesture = name; F.anim.gestureT = dur; }

export function tickFigure(F, dt, time, moving, speed, turning, night) {
  const A = F.anim, P = F.parts;
  const ds = dt / 1000;
  const k = F.gaitK;
  let bob = 0;
  if (moving) {
    A.phase += ds * (8 + speed * 0.05) * k;
    const sw = Math.sin(A.phase), sw2 = Math.sin(A.phase + Math.PI);
    P.legL.rotation.x = sw * 0.6; P.legR.rotation.x = sw2 * 0.6;
    if (!A.gesture) { P.armL.rotation.x = sw2 * 0.45; P.armR.rotation.x = sw * 0.45; P.armL.rotation.z = 0.15; P.armR.rotation.z = -0.15; }
    bob = Math.abs(Math.cos(A.phase)) * 0.45 * (F.recipe.gait === 'bouncy' ? 1.6 : 1);
    F.body.rotation.z = -turning * 0.25;
    F.body.rotation.x = 0.06;
  } else {
    // idle: breathing, weight shift, settle limbs
    A.breathe += ds;
    P.legL.rotation.x *= 0.85; P.legR.rotation.x *= 0.85;
    if (!A.gesture) { P.armL.rotation.x *= 0.85; P.armR.rotation.x *= 0.85; P.armL.rotation.z = 0.12 + Math.sin(A.breathe * 1.3) * 0.03; P.armR.rotation.z = -0.12 - Math.sin(A.breathe * 1.3) * 0.03; }
    P.torso.scale.y = 1 + Math.sin(A.breathe * 1.6) * 0.012;
    P.torso.position.x = Math.sin(A.breathe * 0.35) * 0.25;
    F.body.rotation.z *= 0.9; F.body.rotation.x *= 0.9;
    bob = Math.sin(A.breathe * 1.6) * 0.08;
    // occasional look-around
    A.lookT -= ds;
    if (A.lookT <= 0) { A.lookT = 3 + Math.random() * 6; A.look = (Math.random() - 0.5) * 1.2; }
    P.head.rotation.y += (A.look - P.head.rotation.y) * Math.min(1, ds * 3);
  }
  if (moving) P.head.rotation.y *= 0.9;
  // gestures override the arms (and sometimes the torso)
  if (A.gesture) {
    A.gestureT -= ds;
    const g = A.gesture, t = time * 6;
    switch (g) {
      case 'wave': P.armR.rotation.x = -2.6; P.armR.rotation.z = -0.5 + Math.sin(t) * 0.35; break;
      case 'read': P.armR.rotation.x = -1.3; P.armL.rotation.x = -1.3; P.armL.rotation.z = 0.4; P.armR.rotation.z = -0.4; P.head.rotation.x = 0.35; break;
      case 'write': P.armR.rotation.x = -1.0 + Math.sin(t * 1.4) * 0.12; P.armR.rotation.z = -0.2; P.head.rotation.x = 0.3; break;
      case 'hammer': P.armR.rotation.x = -2.2 + Math.max(0, Math.sin(t * 1.2)) * 1.9; break;
      case 'haul': P.armR.rotation.x = -0.9; P.armL.rotation.x = -0.9; F.body.rotation.x = 0.25 + Math.sin(t * 0.8) * 0.05; break;
      case 'tend': F.body.position.y = -2.2; P.legL.rotation.x = -1.2; P.legR.rotation.x = -0.4; P.armR.rotation.x = -1.1; P.head.rotation.x = 0.4; break;
      case 'strum': P.armL.rotation.x = -1.1; P.armL.rotation.z = 0.5; P.armR.rotation.x = -0.9 + Math.sin(t * 2) * 0.25; P.armR.rotation.z = -0.2; break;
      case 'raise': P.armR.rotation.x = -2.2; P.armR.rotation.z = -0.3; break;
      default: break;
    }
    if (A.gestureT <= 0) { A.gesture = null; F.body.position.y = 0; P.head.rotation.x = 0; }
  } else if (F.body.position.y !== 0 && !moving) { F.body.position.y *= 0.8; P.head.rotation.x *= 0.8; }
  if (!A.gesture || A.gesture !== 'tend') F.body.position.y = bob + (A.gesture === 'tend' ? -2.2 : 0);
  // halo and ring pulse
  if (P.halo) { P.halo.position.y = P.halo.userData.y0 ?? (P.halo.userData.y0 = P.halo.position.y); P.halo.position.y = P.halo.userData.y0 + Math.sin(time * 1.8) * 0.25; P.halo.rotation.z = time * 0.4; }
  if (F.status === 'running') F.ring.material.opacity = 0.5 + Math.sin(time * 4) * 0.3;
  if (F.status === 'waiting') F.ring.scale.setScalar(1 + Math.sin(time * 3) * 0.08);
  // lantern glow at night
  if (F.heldKind === 'lantern') { const l = P.held.children[0]; if (l && l.material) l.material.emissiveIntensity = night ? 1.8 : 0; }
}

// ---- bubbles ----
export function say(F, text) {
  F.bubbleQueue.push(String(text || '').slice(0, 90) + (String(text || '').length > 90 ? '…' : ''));
  if (!F.bubbleEl) nextBubble(F);
}
function nextBubble(F) {
  const text = F.bubbleQueue.shift();
  if (text == null) { F.bubbleEl = null; return; }
  const el = document.createElement('div');
  el.className = 'bubble speech';
  const inner = document.createElement('span'); el.appendChild(inner);
  const called = Array.from(new Set((text.match(/@[\w.-]+/g) || []).map((m) => m.slice(1))));
  if (called.length) { const c = document.createElement('div'); c.className = 'bubble-called'; c.textContent = `→ ${called.join(', ')}`; el.appendChild(c); }
  F.bubbleHost.appendChild(el);
  F.bubbleEl = el;
  gesture(F, 'wave', 1.8);
  let i = 0;
  const chars = Array.from(text);
  const typer = setInterval(() => { i++; inner.textContent = chars.slice(0, i).join(''); if (i >= chars.length) clearInterval(typer); }, 28);
  clearTimeout(F.bubbleTimer);
  F.bubbleTimer = setTimeout(() => {
    el.classList.add('fade');
    setTimeout(() => { el.remove(); F.bubbleEl = null; nextBubble(F); }, 700);
  }, 8000);
}
export function setThinking(F, on) {
  if (on && !F.thinkEl) { const el = document.createElement('div'); el.className = 'bubble think'; el.innerHTML = '<span></span><span></span><span></span>'; F.bubbleHost.appendChild(el); F.thinkEl = el; }
  if (!on && F.thinkEl) { F.thinkEl.remove(); F.thinkEl = null; }
}
export function setWaiting(F, on) {
  if (on && !F.waitEl) { const el = document.createElement('div'); el.className = 'bubble wait'; el.textContent = '!'; F.bubbleHost.appendChild(el); F.waitEl = el; }
  if (!on && F.waitEl) { F.waitEl.remove(); F.waitEl = null; }
}
export function disposeFigure(F) {
  // CSS2DRenderer only removes an overlay's DOM when that overlay itself is removed, not when an ancestor is — so a
  // departed figure's name, bubbles and "!" would linger frozen on screen. Remove them explicitly.
  F.root.traverse(o => { if (o.isCSS2DObject) o.element?.remove(); });
  F.root.removeFromParent();
  clearTimeout(F.bubbleTimer);
}

// Echoes use the same articulated chiton, without overlays or appearance ornaments.
const echoes = new Map();
export function createApprentice(master, prop, orderId) {
  const root = new THREE.Group(), F = { root, parts: {}, spec: { color: master.color, appearance: { garment: 'chiton', build: master.appearance?.build, held: prop } }, label: {}, bubbleObj: new THREE.Object3D(), anim: { phase: 0, breathe: 0, lookT: 5, look: 0 } };
  buildBody(F); root.scale.setScalar(0.66);
  F.echoMeshes = []; F.body.traverse(o => { if (o.isMesh) { o.castShadow = false; F.echoMeshes.push(o); } });
  F.solid = new Set(); F.parts.held.traverse(o => { if (o.isMesh) F.solid.add(o); });
  F.color = HEX.test(master.color) ? master.color : '#B8A48A';
  F.echoMaterials = [];
  for (let bucket = 0; bucket <= 20; bucket++) { const key = `${F.color}:${bucket}`; let m = echoes.get(key); if (!m) { m = new THREE.MeshStandardMaterial({ color: F.color, emissive: F.color, emissiveIntensity: 0.3, roughness: 0.85, flatShading: true, transparent: true, opacity: bucket / 20 * 0.55, depthWrite: false }); echoes.set(key, m); } F.echoMaterials.push(m); }
  const hit = mesh(geo.cyl(5, 5, 16, 6), mat('hit', { color: '#ffffff' }), 0, 7, 0); hit.material = apprenticeHit; hit.userData.pick = { type: 'apprentice', id: master.name, orderId }; root.add(hit); F.hit = hit;
  return F;
}
const apprenticeHit = new THREE.MeshBasicMaterial({ visible: false });
export function fadeApprentice(F, alpha) {
  const m = F.echoMaterials[Math.round(alpha * 20)];
  for (let i = 0; i < F.echoMeshes.length; i++) { const o = F.echoMeshes[i]; if (!F.solid.has(o)) o.material = m; }
  F.parts.held.visible = alpha > 0.08; F.hit.userData.pickable = alpha > 0.08;
}
