import { apprenticeProp, apprenticeCap, apprenticeFade, apprenticesAllowed } from './apprentice.js';
import { createMist } from './mist3d.js';
let villageState = 'awake';
export function getVillageState() { return villageState; }
import { mountainRoute, quarryRoute, mountainZone, mountainHeight, MOUNTAIN_BOUNDS } from './terrain-layout.js';
// 2.5D map renderer (three.js): orthographic iso camera, flat-shaded low-poly Aegean ruins, sun by
// phase with soft shadows, emissive lamps + restrained bloom, CSS2D labels/bubbles, raycast picking,
// walking figures routed along the road network. Same interface as map.js (createMap).
import * as THREE from 'three';
import { MapControls } from 'three/addons/MapControls.js';
import { CSS2DRenderer } from 'three/addons/CSS2DRenderer.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CSS2DObject } from 'three/addons/CSS2DRenderer.js';
import { mulberry, dist, zoneOf, hashStr } from './svg-util.js';
import { ISLE, SEA_X, isleLandAt } from './isle.js';
import { Builder, P, makeMaterials, buildTerrain, buildIsleTerrain, buildPlace, buildIsleWorkshop, buildObject, makeTreeInstances, isRiverAt, BRIDGE, groundHeight, THEATRE } from './scene3d.js';
import { placeAssets } from './assets3d.js';
import { createTree3D, drawTree3D, tickTree3D } from './tree3d.js';
import { createApprentice, fadeApprentice, createFigure, setFigureSpec, setStatus, tickFigure, say, setThinking, setWaiting, gesture, disposeFigure, FIGURE_H } from './figures3d.js';
import { buildGraph, route, sampleQuad, polyLen } from './nav.js';
import { treeSignature } from './trees.js';

export const WORLD = { w: 1000, h: 760 };
const VILLAGE = { x: 0, y: 0, w: 1000, h: 760 };
const TOOL_COLORS = { claude: '#e7a26b', codex: '#a9d8c4', antigravity: '#c4b5f0', grok: '#8da2c4', gemini: '#9fc5f0', other: '#b8b0a6' };
// Light script: continuous, keyed on the real sun's altitude (degrees); morning and evening keys differ so dawn is
// peach and dusk is rose. Direction comes from the real azimuth; below the horizon a fixed moon takes over.
const LK = (alt, sky0, sky1, fog, water, sunC, sunI, hemiS, hemiG, hemiI, lamps, bloom, points, pools, exposure, fill) => ({ alt, sky0: new THREE.Color(sky0), sky1: new THREE.Color(sky1), fog: new THREE.Color(fog), water: new THREE.Color(water), sunC: new THREE.Color(sunC), sunI, hemiS: new THREE.Color(hemiS), hemiG: new THREE.Color(hemiG), hemiI, lamps, bloom, points, pools, exposure, fill });
const NIGHT = (alt) => LK(alt, '#0B1634', '#2A3A72', '#131F40', '#173A5E', '#A9BEF4', 0.8, '#6F8FDA', '#1A2650', 0.55, 2.4, 0.42, 2.0, 0.85, 0.92, 0.3);
const HIGH = (alt) => LK(alt, '#B4C4DC', '#EADFD0', '#D6DDE4', '#4E9CB4', '#FFF8EA', 1.75, '#E4EEF4', '#8A7A62', 0.6, 0, 0.1, 0, 0, 1.02, 0.35);
const LIGHT_KEYS = {
  am: [NIGHT(-18), NIGHT(-7),
    LK(-1, '#8E84BC', '#F3BE9A', '#CDB0C6', '#5E8AA6', '#FFAD73', 1.1, '#8490B8', '#4A5880', 0.7, 1.5, 0.45, 0.8, 0.5, 0.97, 0.2),
    LK(7, '#B9A4CC', '#F7BE94', '#DDB4C6', '#4F86A4', '#FFA070', 1.55, '#8A9CCC', '#55658C', 0.82, 0.35, 0.25, 0, 0.25, 0.96, 0.22),
    LK(20, '#C2BCD8', '#F2DDCC', '#DCDCE0', '#55A2B8', '#FFF2DC', 1.7, '#DCE8EE', '#857760', 0.58, 0, 0.12, 0, 0, 1.02, 0.35), HIGH(50)],
  pm: [NIGHT(-18), NIGHT(-7),
    LK(-1, '#6C64B0', '#F2A77E', '#9C86B4', '#3E6A8C', '#FFA070', 1.3, '#8C86C0', '#6E6888', 0.8, 1.6, 0.5, 1.2, 0.7, 0.98, 0.1),
    LK(7, '#B4A0CE', '#F7C49E', '#CDB0C8', '#5A98B0', '#FFB888', 1.45, '#A09CC8', '#66628A', 0.7, 0.5, 0.3, 0.4, 0.35, 1, 0.2),
    LK(20, '#CDD2E2', '#F2D8C2', '#DCDAE0', '#55A2B8', '#FFE6BE', 1.65, '#DFE4DA', '#857760', 0.55, 0, 0.12, 0, 0, 1.02, 0.35), HIGH(50)],
};
const LOOK_NUM = ['sunI', 'hemiI', 'lamps', 'bloom', 'points', 'pools', 'exposure', 'fill'], LOOK_COL = ['sky0', 'sky1', 'fog', 'water', 'sunC', 'hemiS', 'hemiG'];
function lookAt(alt, am, out) {
  const keys = LIGHT_KEYS[am ? 'am' : 'pm'];
  let i = 0; while (i < keys.length - 2 && alt > keys[i + 1].alt) i++;
  const a = keys[i], b = keys[i + 1], t = Math.max(0, Math.min(1, (alt - a.alt) / (b.alt - a.alt)));
  for (const k of LOOK_NUM) out[k] = a[k] + (b[k] - a[k]) * t;
  for (const k of LOOK_COL) out[k].copy(a[k]).lerp(b[k], t);
  return out;
}
// Screenshot/mock phases freeze the sun at a representative altitude/azimuth (degrees; azimuth from north, clockwise).
const PHASE_SUN = { dawn: [7, 108, true], morning: [34, 140, true], afternoon: [30, 232, false], twilight: [-1.5, 252, false], night: [-28, 330, false] };
function sunFromWorld(w) {
  const sun = w?.sun;
  if (sun && Number.isFinite(+sun.altitude) && Number.isFinite(+sun.azimuth)) { let am = +sun.azimuth < 180; try { am = +new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: w.tz || undefined }).format(new Date(+w.now || Date.now())) < 12; } catch (_) { /* unknown tz */ } return { alt: +sun.altitude, az: +sun.azimuth, am }; }
  const [alt, az, am] = PHASE_SUN[w?.phase] || PHASE_SUN.morning; return { alt, az, am };
}
const phaseName = (alt, am) => alt < -6 ? 'night' : alt < 6 ? (am ? 'dawn' : 'twilight') : am ? 'morning' : 'afternoon';

export async function createMap3D(container, opts = {}) {
  // ---------- renderer / scene / camera ----------
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  container.appendChild(renderer.domElement);
  const labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.className = 'labels';
  container.appendChild(labelRenderer.domElement);

  const scene = new THREE.Scene();
  const mist = createMist(scene);
  renderer.setClearColor(new THREE.Color('#E3DAD8'), 1);
  scene.fog = new THREE.Fog('#E3DAD8', 2200 + 140, 2200 + 1500);
  const camera = new THREE.OrthographicCamera(-500, 500, 380, -380, 10, 6000);
  const ISO = { az: -0.785, el: 0.61, d: 2200 }; // from the south-west, ~37° elevation; fog starts beyond the near edge
  const view = { cx: 500, cz: 380, w: 1000 }; // target + visible width (world units)
  function placeCamera() {
    const dir = new THREE.Vector3(Math.sin(ISO.az) * Math.cos(ISO.el), Math.sin(ISO.el), Math.cos(ISO.az) * Math.cos(ISO.el));
    camera.position.set(view.cx + dir.x * ISO.d, dir.y * ISO.d, view.cz + dir.z * ISO.d);
    camera.lookAt(view.cx, 0, view.cz);
  }
  const controls = new MapControls(camera, renderer.domElement);
  controls.enableRotate = false;
  controls.screenSpacePanning = false;
  controls.enableDamping = true; controls.dampingFactor = 0.12;
  controls.zoomToCursor = true;
  controls.minZoom = 0.55; controls.maxZoom = 9;
  controls.target.set(view.cx, 0, view.cz);
  placeCamera();

  // ---------- post ----------
  const size = () => ({ w: container.clientWidth || 800, h: container.clientHeight || 600 });
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(size().w, size().h, { samples: 4 }));
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(size().w, size().h), 0.25, 0.4, 1.1);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  function resize() {
    const { w, h } = size();
    renderer.setSize(w, h, false);
    labelRenderer.setSize(w, h);
    composer.setSize(w, h);
    const aspect = w / h;
    camera.left = -500; camera.right = 500; camera.top = 500 / aspect; camera.bottom = -500 / aspect;
    camera.updateProjectionMatrix();
    needsRender = true;
  }
  let resizeQueued = false;
  new ResizeObserver(() => { if (resizeQueued) return; resizeQueued = true; requestAnimationFrame(() => { resizeQueued = false; resize(); }); }).observe(container);

  // ---------- lights ----------
  const sun = new THREE.DirectionalLight('#fff4e0', 2.4);
  sun.castShadow = true;
  const SHADOW = Math.max(512, Math.min(4096, +new URLSearchParams(location.search).get('shadow') || 4096));
  sun.shadow.mapSize.set(SHADOW, SHADOW);
  sun.shadow.radius = 4;
  sun.shadow.bias = -0.0008; sun.shadow.normalBias = 0.6;
  sun.shadow.camera.near = 200; sun.shadow.camera.far = 4000;
  const sunTarget = new THREE.Object3D(); scene.add(sunTarget); sun.target = sunTarget;
  // sky backdrop: a vertical gradient plane behind the world, facing the camera (never fogged)
  const skyGeo = new THREE.PlaneGeometry(9000, 5200, 1, 8);
  const skyCol = new Float32Array(skyGeo.attributes.position.count * 3); skyGeo.setAttribute('color', new THREE.BufferAttribute(skyCol, 3));
  const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, depthWrite: false })); sky.renderOrder = -10; scene.add(sky);
  function paintSky(top, bottom) { const t = top, bt = bottom, pos = skyGeo.attributes.position; for (let i = 0; i < pos.count; i++) { const f = Math.pow((pos.getY(i) + 2600) / 5200, 1.4); const c = bt.clone().lerp(t, f); skyCol[i * 3] = c.r; skyCol[i * 3 + 1] = c.g; skyCol[i * 3 + 2] = c.b; } skyGeo.attributes.color.needsUpdate = true; }
  function placeSky() { const dir = new THREE.Vector3(Math.sin(ISO.az) * Math.cos(ISO.el), Math.sin(ISO.el), Math.cos(ISO.az) * Math.cos(ISO.el)); sky.position.set(view.cx - dir.x * 2600, -300 - dir.y * 2600, view.cz - dir.z * 2600); sky.lookAt(camera.position); }
  scene.add(sun);
  const hemi = new THREE.HemisphereLight('#DCEAF0', '#9B8E78', 0.9); scene.add(hemi);
  const fill = new THREE.DirectionalLight('#CFE3EC', 0.35); fill.position.set(-600, 500, 800); scene.add(fill);
  const nightLights = [];
  const LIGHT_SPOTS = [[440,448],[650,482],[690,618],[140,170],[880,446],[715,222],[250,642],[826,736]];
  for (const [lx, lz] of LIGHT_SPOTS) { const pl = new THREE.PointLight('#FFB060', 0, 130, 1.6); pl.position.set(lx, groundHeight(lx, lz) + 13, lz); pl.visible = false; pl.userData.k = [1.7, 1, 1, 1.5, 1, 1.5, 1, 1][nightLights.length] || 1; scene.add(pl); nightLights.push(pl); }
  function updateShadowFrustum() {
    const span = Math.max(420, view.w * 0.62);
    sun.shadow.camera.left = -span; sun.shadow.camera.right = span; sun.shadow.camera.top = span * 0.8; sun.shadow.camera.bottom = -span * 0.8;
    sun.shadow.camera.updateProjectionMatrix();
    sunTarget.position.set(view.cx, 0, view.cz);
    sun.position.copy(sunTarget.position).addScaledVector(sunDir, 1500);
  }
  // sun state: eased toward the latest snapshot so a new reading never snaps the light
  const sunCur = { alt: 34, az: 140, am: true }, sunGoal = { alt: 34, az: 140, am: true };
  const sunDir = new THREE.Vector3(0.5, 0.7, 0.5), MOON_DIR = new THREE.Vector3(Math.cos(3.6) * Math.cos(0.7), Math.sin(0.7), Math.sin(3.6) * Math.cos(0.7)).normalize();
  const look = LK(0, '#000', '#000', '#000', '#000', '#000', 0, '#000', '#000', 0, 0, 0, 0, 0, 1, 0);
  let sunBase = 1.6, phaseOverride = null, lookDirty = true;
  function setSunGoal(world, override) {
    const g = sunFromWorld(world); phaseOverride = override || null;
    // snap on the first reading, on a frozen phase, or after a long gap (tab hidden); otherwise ease over a few seconds
    let dz = g.az - sunCur.az; while (dz > 180) dz -= 360; while (dz < -180) dz += 360;
    const snap = !sunReady || override || Math.abs(dz) > 12 || Math.abs(g.alt - sunCur.alt) > 6;
    if (snap) { Object.assign(sunCur, g); sunReady = true; }
    Object.assign(sunGoal, g); lookDirty = true; sunT = performance.now();
    if (snap) applyLook();
  }
  let sunReady = false, sunT = 0;
  function easeSun() { // returns true while still moving (wall-clock eased, so slow frames still converge)
    const nowT = performance.now(), ds = Math.min(2, (nowT - sunT) / 1000); sunT = nowT;
    let dz = sunGoal.az - sunCur.az; while (dz > 180) dz -= 360; while (dz < -180) dz += 360;
    const da = sunGoal.alt - sunCur.alt;
    if (Math.abs(dz) < 0.02 && Math.abs(da) < 0.02) { if (sunCur.am !== sunGoal.am) { sunCur.am = sunGoal.am; lookDirty = true; } if (!lookDirty) return false; sunCur.alt = sunGoal.alt; sunCur.az = sunGoal.az; }
    else { const k = 1 - Math.exp(-ds * 0.9); sunCur.alt += da * k; sunCur.az = (sunCur.az + dz * k + 360) % 360; lookDirty = true; }
    return true;
  }
  function applyLook() {
    const { alt, az, am } = sunCur;
    lookAt(alt, am, look);
    paintSky(look.sky0, look.sky1); placeSky();
    renderer.setClearColor(look.fog, 1); scene.fog.color.copy(look.fog);
    mats.water.color.copy(look.water); mats.pool.opacity = look.pools; mats.water.roughness = alt < 0 ? 0.16 : 0.3;
    sun.color.copy(look.sunC); sunBase = look.sunI; sun.intensity = sunBase;
    hemi.color.copy(look.hemiS); hemi.groundColor.copy(look.hemiG); hemi.intensity = look.hemiI;
    fill.intensity = look.fill;
    sun.shadow.intensity = alt < 8 ? 0.58 : 0.85;                                           // low sun: lighter shadows so ground detail survives
    for (const pl of nightLights) { pl.visible = look.points > 0.02; pl.intensity = look.points * 90 * (pl.userData.k || 1); }
    for (const m of lampMats) m.emissiveIntensity = look.lamps;
    mats.ember.emissiveIntensity = 1.2 + look.lamps * 0.45;
    bloom.strength = look.bloom; bloom.threshold = alt < 4 ? 0.86 : 0.985; bloom.radius = 0.4;
    renderer.toneMappingExposure = look.exposure;
    // direction: real azimuth (east = +x, north = -z), elevation kept ≥ 14° so shadows stay readable; moon below the horizon
    const el = Math.max(alt, am ? 18 : 24) * Math.PI / 180, azr = az * Math.PI / 180;
    const sd = new THREE.Vector3(Math.sin(azr) * Math.cos(el), Math.sin(el), -Math.cos(azr) * Math.cos(el));
    const w = Math.max(0, Math.min(1, (alt + 7) / 8));
    sunDir.copy(MOON_DIR).lerp(sd, w * w * (3 - 2 * w)).normalize();
    phase = phaseOverride && PHASE_SUN[phaseOverride] ? phaseOverride : phaseName(alt, am);
    container.dataset.phase = phase;
    container.style.setProperty('--haze', '#' + look.fog.getHexString());
    aimArmillary();
    updateShadowFrustum();
    lookDirty = false; needsRender = true;
  }
  const isNight = () => sunCur.alt < 4;
  const sunInfo = () => ({ alt: sunCur.alt, az: sunCur.az, am: sunCur.am, phase, night: isNight() });
  let phase = 'morning';
  const lampMats = [];

  // ---------- static world ----------
  const mats = makeMaterials();
  lampMats.push(mats.emissive);
  const terrain = buildTerrain(scene, mats);
  let isleBuilt = false;
  function ensureIsle() { if (isleBuilt) return; isleBuilt = true; buildIsleTerrain(scene, mats); }
  function setWorldSize(w, h) {
    const nw = Number.isFinite(+w) && +w > 0 ? +w : WORLD.w, nh = Number.isFinite(+h) && +h > 0 ? +h : WORLD.h;
    if (nw === WORLD.w && nh === WORLD.h) return;
    WORLD.w = nw; WORLD.h = nh;
  }
  // zone labels
  const zoneLabel = (text, x, z, cls = 'lbl lbl-zone') => { const d = document.createElement('div'); d.className = cls; d.textContent = text; const o = new CSS2DObject(d); o.position.set(x, 2, z); scene.add(o); return o; };

  let isleLabel = null;

  // ---------- places, trees, objects, workshops (rebuilt when their key changes) ----------
  const staticGroup = new THREE.Group(); scene.add(staticGroup);
  let placesKey = '';
  const placeInfo = new Map(); // id -> { h, hit, ember, beam, label }
  const placeLabels = new Map();
  let graph = null, isleGraph = null, hasIsleAssets = false;
  let emberEmitter = null, beamCone = null, smokeEmitters = [], armillary = null, plotMesh = null;
  function rebuildStatic(places, workshops, plots, objects, sites) {
    const key = JSON.stringify([places.map((p) => [p.id, p.kind, p.x, p.y, p.name, zoneOf(p)]), workshops.map((w) => [w.id, w.x, w.y, w.project, w.host]), plots.map((p) => [p.id, p.x, p.y]), objects.map((o) => [o.id, o.kind, o.x, o.y]), isleBuilt]);
    if (key === placesKey) return;
    placesKey = key;
    for (const c of [...staticGroup.children]) { staticGroup.remove(c); c.geometry?.dispose?.(); }
    for (const [, o] of placeLabels) o.removeFromParent();
    placeLabels.clear(); placeInfo.clear(); smokeEmitters = []; emberEmitter = null;
    if (beamCone) { beamCone.removeFromParent(); beamCone = null; }
    if (armillary) { armillary.grp.removeFromParent(); armillary = null; }
    const b = new Builder(), e = new Builder(), pool = new Builder(), ao = new Builder(), decals = new Builder(), hits = [];
    for (const p of places) {
      const info = buildPlace(p, b, e, pool, ao);
      placeInfo.set(p.id, info);
      const d = document.createElement('div');
      const divine = ['temple', 'greatlibrary', 'forge', 'quarry', 'works'].includes(p.kind);
      d.className = `lbl lbl-place ${divine ? 'divine' : ''} ${['temple', 'greatlibrary', 'forge', 'quarry', 'tower'].includes(p.kind) ? 'major' : 'minor'}`;
      d.textContent = String(p.name || p.id);
      // the Green's label sits at the plaza's front edge, clear of the Almond at its centre
      const o = new CSS2DObject(d); o.position.set(p.x, (info.y0 || 0) + (info.h || 20) + 6, p.kind === 'plaza' ? p.y + 66 : p.y); staticGroup.add(o); placeLabels.set(p.id, o);
      const hit = new THREE.Mesh(new THREE.BoxGeometry(...(info.hit || [60, 30, 50])), new THREE.MeshBasicMaterial({ visible: false }));
      hit.position.set(p.x, (info.y0 || 0) + (info.hit?.[1] || 30) / 2, p.y); hit.userData = { pick: { type: 'place', id: p.id } }; staticGroup.add(hit); hits.push(hit);
      if (info.ember) emberEmitter = info.ember;
      if (info.beam) { beamCone = makeBeam(info.beam); staticGroup.add(beamCone); }
      if (info.armillary) { armillary = makeArmillary(info.armillary); staticGroup.add(armillary.grp); aimArmillary(); }
    }
    for (const w of workshops) {
      const info = buildIsleWorkshop(w, b, e, pool, ao);
      const d = document.createElement('div'); d.className = 'lbl lbl-place minor ws'; d.textContent = `${w.project || w.id} @ ${w.host || 'local'}`;
      const o = new CSS2DObject(d); o.position.set(w.x, info.y0 + info.h + 6, w.y); staticGroup.add(o); placeLabels.set(w.id, o);
      const hit = new THREE.Mesh(new THREE.BoxGeometry(...info.hit), new THREE.MeshBasicMaterial({ visible: false }));
      hit.position.set(w.x, info.y0 + info.hit[1] / 2, w.y); hit.userData = { pick: { type: 'workshop', id: w.id } }; staticGroup.add(hit);
      if (info.smoke) smokeEmitters.push({ ...info.smoke, key: `${w.project}@${w.host}` });
    }
    const plotB = new Builder();
    for (const p of plots) { const gy = groundHeight(p.x, p.y); for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; plotB.box(p.x + Math.cos(a) * 19, gy + 0.9, p.y + Math.sin(a) * 19, 2.6, 0.9, 2.6, P.stoneDark, -a); } }   // an empty plot: four flush marker stones, shown only up close
    plotMesh = plotB.mesh(mats.decal); if (plotMesh) { plotMesh.castShadow = false; plotMesh.visible = zoomBand === 'near'; staticGroup.add(plotMesh); }
    for (const o of objects) {
      buildObject(o, b, e, pool);
      const hit = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 14, 6), new THREE.MeshBasicMaterial({ visible: false }));
      hit.position.set(o.x, groundHeight(o.x, o.y) + 7, o.y); hit.userData = { pick: { type: 'object', id: o.id } }; staticGroup.add(hit);
    }
    // paths & road graph
    const edges = buildPaths(decals, places, workshops, sites);
    graph = buildGraph(edges.filter((ed) => ed.zone === 'village')); graph.height = groundHeight;
    isleGraph = buildGraph(edges.filter((ed) => ed.zone === 'isle'));
    // ambient trees
    const treeList = scatterTrees(places, workshops, plots, edges);
    for (const t of treeList) { const g = new THREE.CircleGeometry(1, 12); g.rotateX(-Math.PI / 2); g.scale(5.5 * t.s, 1, 4.6 * t.s); ao.add(g, '#3E3550', new THREE.Matrix4().setPosition(t.x, t.y + 0.55, t.z)); }   // contact shadow under every tree
    staticGroup.add(...makeTreeInstances(treeList, mats));
    const dm = decals.mesh(mats.decal); if(dm) {dm.castShadow=false; staticGroup.add(dm);}
    const sm = b.mesh(mats.toon); if (sm) staticGroup.add(sm);
    const em = e.mesh(mats.emissive); if (em) { em.castShadow = false; staticGroup.add(em); }
    const pm = pool.mesh(mats.pool); if (pm) { pm.castShadow = false; pm.receiveShadow = false; pm.renderOrder = 1; staticGroup.add(pm); }
    const am = ao.mesh(mats.ao); if (am) { am.castShadow = false; am.receiveShadow = false; staticGroup.add(am); }
    // library set-dressing (recoloured, instanced); quietly skipped if the files are missing
    const rub = mulberry(23); const pls = [];
    const spots = [[500, 350], [600, 470], [850, 470], [790, 640], [1300, 300], [1480, 620], [1600, 200], [1250, 560]];
    for (const [sx, sz] of spots) { for (let i = 0; i < (sx > 1150 ? 3 : 2); i++) { const x = sx + (rub() - 0.5) * 50, z = sz + (rub() - 0.5) * 40; if (isRiverAt(x, z, 10) || groundHeight(x, z) < -5) continue; const keys = x > 1150 ? ['column', 'block', 'head', 'rockB'] : ['block', 'rockA', 'column', 'ring']; pls.push({ key: keys[Math.floor(rub() * keys.length)], x, y: groundHeight(x, z), z, ry: rub() * 6.28, s: 0.8 + rub() * 0.5 }); } }
    if (!hasIsleAssets && isleBuilt) hasIsleAssets = true;
    placeAssets(staticGroup, pls, mats.toon).then(() => { needsRender = true; }).catch(() => {});
    if (isleBuilt && !isleLabel) { isleLabel = zoneLabel('The Far Isle · exclusion zone', ISLE.center.x, 60); }
    needsRender = true;
  }
  function buildPaths(b, places, workshops, sites) {
    const edges = [];
    const rnd = mulberry(3);
    const curve = (a, c, bb, zone, color = P.sand, w = 9) => {
      const pts = sampleQuad(a, c, bb, 14);
      // A continuous ribbon has no coplanar self-overlap at curved segment joins.
      const vertices=[];
      const sides=pts.map((p,i)=>{ const a=pts[Math.max(0,i-1)],c=pts[Math.min(pts.length-1,i+1)],len=dist(a,c)||1;
        const wv=w/2*(0.86+0.28*Math.sin(i*0.8+edges.length*1.7)); const nx=-(c.y-a.y)/len*wv,ny=(c.x-a.x)/len*wv;
        const h=groundHeight(p.x,p.y)+.8+edges.length*.016;
        return [[p.x+nx,h,p.y+ny],[p.x-nx,h,p.y-ny]];
      });
      for(let i=1;i<pts.length;i++) vertices.push(...sides[i-1][0],...sides[i][0],...sides[i-1][1],...sides[i-1][1],...sides[i][0],...sides[i][1]);
      const geo=new THREE.BufferGeometry(); geo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geo.computeVertexNormals();
      b.add(geo,color);
      if (zone === 'village') for (let i = 1; i < pts.length - 1; i++) { const [l, rgt] = sides[i]; if (i % 2 === 0) { b.box(l[0], l[1] + 0.2, l[2], 1.8, 0.9, 1.8, '#C6B894', rnd() * 3); b.box(rgt[0], rgt[1] + 0.2, rgt[2], 1.8, 0.9, 1.8, '#C6B894', rnd() * 3); } if (i % 3 === 1) { const k = rnd() < 0.5 ? l : rgt, sx = k[0] + (k[0] - pts[i].x) * 0.35, sz = k[2] + (k[2] - pts[i].y) * 0.35; b.blob(sx, k[1] + 0.6, sz, 2.2, 1.1, 1.8, rnd() < 0.5 ? '#B9B77E' : '#A8B07A', rnd() * 3); } }   // curb stones and dry-grass tufts
      edges.push({ points: pts, zone });
    };
    const mstEdges = (nodes) => {
      const out = []; if (nodes.length < 2) return out;
      const inT = new Set([0]);
      while (inT.size < nodes.length) { let best = null, bd = Infinity; for (const i of inT) for (let j = 0; j < nodes.length; j++) { if (inT.has(j)) continue; const d = dist(nodes[i], nodes[j]); if (d < bd) { bd = d; best = [i, j]; } } if (!best) break; inT.add(best[1]); out.push([nodes[best[0]], nodes[best[1]]]); }
      return out;
    };
    const anchor = (p) => ({ x: p.x, y: p.y + ((placeInfo.get(p.id)?.hit?.[2] || 50) / 2) + 6 }); // in front of the building
    // Village roads join at actual junctions; the mountain has one signed entrance.
    // Node 1 is the Green: lanes run to the plaza's rim in their own direction (never across it, never into the
    // theatre tiers); invisible chords across the open front of the plaza keep the walking graph connected.
    const lanes = [[300,340],[440,500],[575,370],[715,250],[820,470],[690,635],[450,710],[250,660],[165,525],[300,300]];
    const nodes=lanes.map(([x,y])=>({x,y}));
    const GREEN = { x: THEATRE.x, y: THEATRE.z }, RIM = 80;
    const rimToward = (c) => { let a = Math.atan2(c.y - GREEN.y, c.x - GREEN.x); a = ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      if (a > THEATRE.f0 - 0.2 && a < THEATRE.f1 + 0.2) a = a - THEATRE.f0 < THEATRE.f1 - a ? THEATRE.f0 - 0.2 : THEATRE.f1 + 0.2;   // swing round the tiers
      return { x: GREEN.x + Math.cos(a) * RIM, y: GREEN.y + Math.sin(a) * RIM }; };
    const rims = [];
    for(const [i,j] of [[0,1],[0,9],[1,2],[2,3],[2,4],[4,5],[5,6],[6,7],[7,8],[8,0],[1,5]]) {
      let a=nodes[i],c=nodes[j]; if (i === 1) { a = rimToward(c); rims.push(a); } if (j === 1) { c = rimToward(a); rims.push(c); }
      const L=dist(a,c)||1,bend=(((i*7+j*3)%5)-2)*L*0.05; curve(a,{x:(a.x+c.x)/2-(c.y-a.y)/L*bend,y:(a.y+c.y)/2+(c.x-a.x)/L*bend},c,'village','#DACBA8',17);
    }
    for (const r of rims) edges.push({ points: [r, nodes[1]], zone: 'village' });
    for(const p of places.filter(p=>zoneOf(p)==='village'&&!['temple','quarry','quiet-stone','green'].includes(p.id))) {
      const ap=anchor(p); const near=nodes.slice(0,9).reduce((a,c)=>dist(c,ap)<dist(a,ap)?c:a);
      curve(near,{x:(near.x+ap.x)/2,y:(near.y+ap.y)/2},ap,'village','#DACBA8',15);
    }
    // Terrain owns the stair treads; navigation uses exactly their centerlines.
    for(const path of [mountainRoute,quarryRoute]) for(let i=1;i<path.length;i++) edges.push({points:[path[i-1],path[i]],zone:'village'});
    const isle = places.filter((p) => zoneOf(p) === 'isle');
    const ia = isle.map(anchor);
    for (const [a, bb] of mstEdges(ia)) { const mx = (a.x + bb.x) / 2, my = (a.y + bb.y) / 2, len = dist(a, bb) || 1, nx = -(bb.y - a.y) / len, ny = (bb.x - a.x) / len, bend = (rnd() - 0.5) * Math.min(50, len * 0.4); curve(a, { x: mx + nx * bend, y: my + ny * bend }, bb, 'isle', P.sand); }
    for (const w of workshops) { let best = null, bd = Infinity; for (const p of ia) { const d = dist(p, w); if (d < bd) { bd = d; best = p; } } if (best) curve(best, { x: (best.x + w.x) / 2, y: (best.y + w.y) / 2 + 10 }, { x: w.x, y: w.y + 44 }, 'isle', P.sand); }
    return edges;
  }
  function scatterTrees(places, workshops, plots, edges) {
    const avoid = [...places.map((p) => ({ x: p.x, y: p.y, r: Math.max(...(placeInfo.get(p.id)?.hit || [60])) * 0.7 + 10 })), ...workshops.map((w) => ({ x: w.x, y: w.y, r: 70 })), ...plots.map((p) => ({ x: p.x, y: p.y, r: 36 })), { x: 440, y: 420, r: 100 }, { x: 372, y: 342, r: 30 }];
    const segs = []; for (const e of edges) for (let i = 1; i < e.points.length; i++) segs.push([e.points[i - 1], e.points[i]]);
    const segD = (p, a, b) => { const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2 || 1; let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2; t = Math.max(0, Math.min(1, t)); return Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.y - (a.y + t * (b.y - a.y))); };
    const tr = mulberry(11);
    const out = [];
    // cypresses mark the switchback's turns; olives and cypresses thin out up the shoulders, the summit stays bare
    for (const [cx, cz, sc] of [[412, 272, 1.15], [276, 268, 1.05], [311, 192, 1.1], [236, 192, 1.0], [270, 152, 1.1], [414, 232, 0.95]]) out.push({ x: cx, z: cz, y: groundHeight(cx, cz), kind: 'cypress', s: sc, ry: cx * 0.1 });
    const onMassif = (x, y) => x < MOUNTAIN_BOUNDS.x1 && y < MOUNTAIN_BOUNDS.z1 && mountainHeight(x, y) > 18.5;
    const massifOk = (x, y) => { if (mountainZone(x, y) !== 'slope') return false; const h = mountainHeight(x, y); if (h > 100) return false; const g = Math.hypot(mountainHeight(x + 3, y) - mountainHeight(x - 3, y), mountainHeight(x, y + 3) - mountainHeight(x, y - 3)) / 6; return g < 0.5 && tr() < 1 - h / 110; };
    // groves: olives and cypresses cluster beside roads, buildings and the theatre rim; calm meadow stays between
    const okSpot = (x, y, onIsle) => { if (onIsle) { if (!isleLandAt(x, y, 30)) return false; } else { if (x < 0 || x > 1000 || y < 0 || y > 760) return false; if (isRiverAt(x, y, 14)) return false; if (onMassif(x, y) && !massifOk(x, y)) return false; } if (avoid.some((a) => Math.hypot(a.x - x, a.y - y) < a.r)) return false; if (segs.some(([a, b]) => segD({ x, y }, a, b) < 13)) return false; return groundHeight(x, y) >= -5; };
    const seeds = [];
    for (const p of places.filter((p) => zoneOf(p) === 'village' && p.kind !== 'plaza')) { const a = tr() * 6.28; seeds.push({ x: p.x + Math.cos(a) * 72, y: p.y + Math.sin(a) * 60, n: 4 + Math.floor(tr() * 3), r: 26 }); }
    for (const e of edges.filter((e) => e.zone === 'village' && e.points.length > 4)) { if (tr() < 0.35) continue; const m = e.points[Math.floor(e.points.length / 2)], a = tr() * 6.28; seeds.push({ x: m.x + Math.cos(a) * 34, y: m.y + Math.sin(a) * 34, n: 2 + Math.floor(tr() * 3), r: 20 }); }
    seeds.push({ x: 700, y: 82, n: 6, r: 34 }, { x: 800, y: 108, n: 5, r: 30 }, { x: 620, y: 118, n: 4, r: 26 }, { x: 935, y: 345, n: 5, r: 28 }, { x: 945, y: 520, n: 5, r: 30 }, { x: 862, y: 572, n: 4, r: 26 }, { x: 370, y: 336, n: 6, r: 26 }, { x: 330, y: 330, n: 4, r: 24 }, { x: 560, y: 690, n: 5, r: 26 }, { x: 930, y: 600, n: 4, r: 24 }, { x: 250, y: 420, n: 4, r: 22 });
    for (const sd of seeds) for (let i = 0, tries = 0; i < sd.n && tries < 24; tries++) { const a = tr() * 6.28, d = Math.sqrt(tr()) * sd.r; const x = sd.x + Math.cos(a) * d, y = sd.y + Math.sin(a) * d; if (!okSpot(x, y, false) || out.some((o) => Math.hypot(o.x - x, o.z - y) < 11)) continue; i++; out.push({ x, z: y, y: groundHeight(x, y), kind: tr() < (onMassif(x, y) ? 0.5 : 0.3) ? 'cypress' : 'olive', s: 0.75 + tr() * 0.7, ry: tr() * 6.28 }); }
    for (let i = 0, tries = 0; i < 7 && tries < 400; tries++) { const x = tr() * 1000, y = tr() * 760; if (!okSpot(x, y, false) || out.some((o) => Math.hypot(o.x - x, o.z - y) < 40)) continue; i++; out.push({ x, z: y, y: groundHeight(x, y), kind: 'olive', s: 0.9 + tr() * 0.5, ry: tr() * 6.28 }); }   // a few lone olives
    if (isleBuilt) for (let i = 0, tries = 0; i < 45 && tries < 900; tries++) { const x = ISLE.bounds.x + tr() * ISLE.bounds.w, y = tr() * 760; if (!okSpot(x, y, true)) continue; i++; out.push({ x, z: y, y: groundHeight(x, y), kind: 'pine', s: 0.8 + tr() * 0.6, ry: tr() * 6.28 }); }
    return out;
  }
  // The Starwatch's bronze armillary: a fixed horizon + meridian frame, a polar axis tilted to the village's latitude, and a
  // star cage (equator, colures, ecliptic with seven star beads) that turns about the axis at night; a sun arm with a gold
  // bead points at the real sun by day. While the weekly Starwatch reading runs, the cage turns faster and the bronze glows.
  const LAT = 38 * Math.PI / 180;   // the polar axis tilt: an Aegean latitude (cosmetic)
  function makeArmillary(at) {
    const grp = new THREE.Group(); grp.position.set(at.x, at.y, at.z); grp.scale.setScalar(at.s || 1);
    const bronze = new THREE.MeshStandardMaterial({ color: '#B8824A', metalness: 0.4, roughness: 0.42, flatShading: true, emissive: new THREE.Color('#F2C14E'), emissiveIntensity: 0 });
    const gold = new THREE.MeshStandardMaterial({ color: '#F2C14E', emissive: new THREE.Color('#F2C14E'), emissiveIntensity: 0.8, roughness: 0.5 });
    const R = 11;
    const ring = (parent, r, tube, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 5, 30), bronze); m.rotation.set(rx, ry, rz); m.castShadow = true; parent.add(m); return m; };
    ring(grp, R + 2.2, 0.6, Math.PI / 2);                         // horizon ring (flat)
    ring(grp, R + 1.3, 0.5, 0, Math.PI / 2);                      // meridian (north–south plane)
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; const nub = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.2, 1.4), bronze); nub.position.set(Math.cos(a) * (R + 2.2), 0, Math.sin(a) * (R + 2.2)); grp.add(nub); }
    const polar = new THREE.Group(); polar.rotation.x = -(Math.PI / 2 - LAT); grp.add(polar);
    const axis = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, (R + 4) * 2, 6), bronze); polar.add(axis);
    const spin = new THREE.Group(); polar.add(spin);
    ring(spin, R, 0.5, Math.PI / 2);                              // celestial equator
    ring(spin, R - 0.6, 0.4, 0, 0); ring(spin, R - 0.6, 0.4, 0, Math.PI / 2);   // colures
    const ecl = new THREE.Group(); ecl.rotation.z = 23.4 * Math.PI / 180; spin.add(ecl);
    ring(ecl, R + 0.7, 0.55, Math.PI / 2);                        // ecliptic band
    const beads = [];
    for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2 + 0.4; const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.75, 0), gold); b.position.set(Math.cos(a) * (R + 0.7), 0, Math.sin(a) * (R + 0.7)); ecl.add(b); beads.push(b); }
    const pointer = new THREE.Group(); grp.add(pointer);
    const armG = new THREE.CylinderGeometry(0.35, 0.35, R + 3, 6); armG.rotateX(Math.PI / 2); armG.translate(0, 0, (R + 3) / 2);
    pointer.add(new THREE.Mesh(armG, bronze));
    const sunBead = new THREE.Mesh(new THREE.IcosahedronGeometry(1.5, 1), gold); sunBead.position.z = R + 3.6; pointer.add(sunBead);
    return { grp, spin, pointer, sunBead, bronze, beads, gold, glow: 0 };
  }
  function aimArmillary() {
    if (!armillary) return;
    const { alt, az } = sunCur, el = alt * Math.PI / 180, azr = az * Math.PI / 180;
    const d = new THREE.Vector3(Math.sin(azr) * Math.cos(el), Math.sin(el), -Math.cos(azr) * Math.cos(el));
    armillary.pointer.lookAt(armillary.grp.position.clone().add(d.multiplyScalar(100)));
    armillary.pointer.visible = alt > -1.5;
  }
  function makeBeam(at) {
    const grp = new THREE.Group();
    for (const [r, len, op] of [[16, 160, 0.16], [38, 380, 0.05]]) { const g = new THREE.ConeGeometry(r, len, 14, 1, true); g.translate(0, -len / 2, 0); g.rotateX(Math.PI / 2); const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: '#FFF2B3', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, fog: true })); m.userData.op = op; grp.add(m); }
    grp.position.set(at.x, at.y, at.z); grp.userData.beam = true; return grp;
  }

  // ---------- dynamic: shared trees, figures ----------
  const treeGroups = new Map(); // zone -> group
  const figures = new Map();   // key -> { F, kind, target, path, ... }
  const smokeParticles = [];
  const smokeGroup = new THREE.Group(); scene.add(smokeGroup);
  let youRec = null;

  function syncTrees(trees, now) {
    const seen = new Set();
    for (const t of trees) {
      const id = zoneOf(t); seen.add(id);
      let g = treeGroups.get(id);
      if (!g) { g = createTree3D(t, mats); scene.add(g); treeGroups.set(id, g); }
      g.position.set(+t.x || 0, groundHeight(+t.x || 0, +t.y || 0), +t.y || 0);
      g.userData.tree = t;
      const shown = t.sealed ? { zone: t.zone, species: t.species, stage: 2, blossoms: 0, blooms: [], branches: [{ id: 's1', credits: 9 }, { id: 's2', credits: 7 }, { id: 's3', credits: 5 }, { id: 's4', credits: 3 }] } : t;
      const sig = treeSignature(shown, now) + (t.sealed ? '#sealed' : '');
      if (g.userData.sig !== sig) { drawTree3D(g, shown, now); g.userData.sig = sig; g.traverse((o) => { if (o.material && t.sealed && o.material !== mats.flat) o.visible = false; }); if (t.sealed) g.children.forEach((c) => { if (c.material === mats.flat) c.material = sealedMat; }); }
    }
    for (const [id, g] of treeGroups) if (!seen.has(id)) { g.removeFromParent(); treeGroups.delete(id); }
  }
  const sealedMat = new THREE.MeshLambertMaterial({ color: '#1a1a26', flatShading: true });

  const boatBuilder=new Builder();
  const hull=new THREE.CylinderGeometry(12,7,4,8); hull.scale(1,1,.4);
  boatBuilder.add(hull,P.woodDark,new THREE.Matrix4().setPosition(850,-5,755));
  for(const dz of [-4,4]) boatBuilder.box(850,-3,755+dz,18,1.8,.8,P.blue);
  boatBuilder.box(850,-3,755,19,1,6,P.sand);
  boatBuilder.box(850,-2,755,2,1,8,P.wood);
  boatBuilder.cyl(850,-2,755,.5,.6,13,P.woodDark,6);
  const visitorBoat=boatBuilder.mesh(mats.toon); visitorBoat.visible=false; scene.add(visitorBoat);
  const rope=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(829,19,757),new THREE.Vector3(842,-2,755)]),new THREE.LineBasicMaterial({color:P.woodDark})); visitorBoat.add(rope);
  const groundY = (x, z) => groundHeight(x, z);
  function figureKey(kind, id) { return `${kind}:${id}`; }
  function syncFigures(state, now) {
    const residents = Array.isArray(state.residents) ? state.residents : [];
    const workers = Array.isArray(state.workers) ? state.workers : [];
    const locked = !!(state.seal?.enabled && state.seal.locked);
    const active = new Set((state.world?.activeTurns || [state.world?.activeTurn].filter(Boolean)).map(t => t.resident));
    const committed = new Set((state.commitments || []).filter((c) => c && c.status === 'active').map((c) => c.ownerId));
    const seen = new Set();
    const pending = residents.filter((r) => r?.pendingNaming === true).map((r) => r.name).sort();
    // Match against our own identity snapshot, including when the caller mutates its state in place.
    for (const r of residents) {
      if (!r?.name) continue;
      const names = Array.isArray(r.formerNames) ? r.formerNames : [];
      let rec = figures.get(figureKey('resident', r.name));
      if (!rec) {
        const old = [...names].reverse().find((n) => figures.has(figureKey('resident', n)) && !residents.some((other) => other.name === n));
        if (old) {
          rec = figures.get(figureKey('resident', old));
          figures.delete(figureKey('resident', old));
          figures.set(figureKey('resident', r.name), rec);
          if (follow === figureKey('resident', old)) follow = figureKey('resident', r.name);
        }
      }
      if (rec && rec.identityName !== undefined && (rec.identityName !== r.name || names.length > (rec.formerCount || 0))) {
        const old = rec.identityName !== r.name ? rec.identityName : names[names.length - 1];
        if (old && old !== r.name) {
          rec.id = r.name;
          rec.F.root.userData.id = r.name;
          rec.F.root.userData.pick = { type: 'resident', id: r.name };
          rec.F.hit.userData.pick = rec.F.root.userData.pick;
          rec.ceremony = { until: performance.now() + 6000, start: performance.now(), from: { ...rec.pos }, height: rec.seatHeight || 0 };
          rec.banner?.removeFromParent();
          const el = document.createElement('div'); el.className = 'naming-banner';
          el.textContent = `${old} → ${r.name}${r.title ? `, ${r.title}` : ''}`;
          rec.banner = new CSS2DObject(el); rec.banner.position.y = FIGURE_H * 1.9; rec.F.root.add(rec.banner);
        }
      }
    }
    const atGreen = residents.filter((r) => r && r.name && (r.placeId === 'green' || (!r.placeId && Math.hypot(+r.x - 440, +r.y - 420) < 70))).map((r) => r.name).sort((p, q) => hashStr(p) - hashStr(q));
    const greenRank = new Map(atGreen.map((n, i) => [n, i]));
    const upsert = (kind, id, spec, x, y, zone, placeId) => {
      if (kind === 'resident' && !pending.includes(id) && greenRank.has(id)) { const i = greenRank.get(id), n = greenRank.size; const a = Math.PI * 0.1 + (i + 0.5) / n * Math.PI * 0.8, rr = 34 + (i % 2) * 9; x = 440 + Math.cos(a) * rr; y = 420 + Math.sin(a) * rr; }   // a loose conversational arc facing the Almond
      const key = figureKey(kind, id); seen.add(key);
      let rec = figures.get(key);
      if (!rec) {
        const F = createFigure({ ...spec, kind, id });
        F.root.position.set(x, groundY(x, y), y);
        scene.add(F.root);
        rec = { F, kind, id, pos: { x, y }, target: { x, y }, path: null, zone, placeId, amble: 4 + Math.random() * 8, speed: 0, heading: 0 };
        figures.set(key, rec);
      } else setFigureSpec(rec.F, { ...spec, kind, id });
      if (kind === 'resident') {
        rec.normalTarget = { x, y, zone, placeId };
        const index = pending.indexOf(id);
        if (index >= 0 && !rec.ceremony) {
          const tier = Math.floor(index / 7) % 4, row = pending.filter((_, i) => Math.floor(i / 7) % 4 === tier), rank = row.indexOf(id);
          const a = THEATRE.open + Math.PI - THEATRE.half * 0.9 + (rank + 0.5) / row.length * THEATRE.half * 1.8, radius = THEATRE.R0 + THEATRE.W / 2 + tier * THEATRE.W;
          x = THEATRE.x + Math.cos(a) * radius; y = THEATRE.z + Math.sin(a) * radius;
          rec.pos = { x, y }; rec.target = { x, y }; rec.path = null;
          rec.seated = true; rec.seatHeight = THEATRE.TIER * (tier + 1);
          rec.heading = Math.atan2(THEATRE.x - x, THEATRE.z - y);
        } else { rec.seated = false; if (!rec.ceremony) rec.seatHeight = 0; }
        if (rec.seated || rec.ceremony) return rec;
      }
      // destination changes: walk along the roads (same zone) or sail (zone change)
      if (rec.zone !== zone) { rec.pos = { x, y }; rec.target = { x, y }; rec.path = null; rec.F.root.position.set(x, groundY(x, y), y); rec.zone = zone; }
      else if (dist(rec.target, { x, y }) > 2) {
        rec.target = { x, y };
        const g = zone === 'isle' ? isleGraph : graph;
        rec.path = route(g, rec.pos, rec.target);
        rec.pathI = 1;
        const len = polyLen(rec.path);
        rec.speed = 28; // believable pace; long trips capped near ~9s
        window.__dbg?.(`walk ${id}: ${rec.path.length} pts, ${Math.round(len)} units @ ${Math.round(rec.speed)}/s`);
      }
      rec.placeId = placeId;
      return rec;
    };
    for (const r of residents) {
      if (!r || !r.name) continue;
      const hooded = r.mood === 'sealed' || (locked && zoneOf(r) === 'isle');
      const rec = upsert('resident', r.name, { name: r.name, color: r.color, appearance: r.appearance, rank: r.rank, hooded }, +r.x || 0, +r.y || 0, zoneOf(r), r.placeId);
      rec.identityName = r.name; rec.formerCount = (r.formerNames || []).length;
      rec.F.root.visible = true;
      rec.disabled = r.enabled === false;
      rec.F.body.traverse((o) => { if (o.material) o.material.transparent = false; });
      rec.F.root.userData.active = active.has(r.name);
      setThinking(rec.F, active.has(r.name));
      rec.flag = committed.has(r.name);
      rec.placeKind = (state.places || []).find((p) => p && p.id === r.placeId)?.kind || '';
      rec.dim = r.enabled === false;
    }
    for (const v of state.visitors || []) {
      if(!v?.name) continue;
      const rec=upsert('visitor',v.name,{name:v.name,appearance:{material:'sandstone',garment:'tunic-and-cloak',garment_color_hex:'#718580',headwear:'hood',held:'staff',accessory:'satchel'}},+v.x||820,+v.y||700,zoneOf(v),v.placeId);
      rec.placeKind=(state.places||[]).find(p=>p.id===v.placeId)?.kind||'';
    }
    visitorBoat.visible=(state.visitors||[]).length>0;
    for (const w of workers) {
      if (!w || !w.id) continue;
      const rec = upsert('god', w.id, { name: w.title || w.id, toolColor: TOOL_COLORS[w.tool] || TOOL_COLORS.other, hooded: !!w.sealed, appearance: null }, +w.x || 0, +w.y || 0, zoneOf(w), w.site);
      setStatus(rec.F, w.stale ? 'stale' : w.status);
      setWaiting(rec.F, w.status === 'waiting' && !w.stale);
      rec.placeKind = { library: 'greatlibrary', forge: 'forge', quarry: 'quarry', temple: 'temple' }[w.site] || '';
      rec.F.label.textContent = w.sealed ? rec.F.label.textContent : String(w.title || w.id).slice(0, 26);
    }
    const h = state.human;
    if (h && Number.isFinite(+h.x) && Number.isFinite(+h.y)) upsert('you', 'you', { name: 'You' }, +h.x, +h.y, zoneOf(h), h.placeId).F.root.visible = true;
    for (const [key, rec] of figures) if (!seen.has(key)) { rec.banner?.removeFromParent(); disposeFigure(rec.F); figures.delete(key); }
    // speech bubbles for new posts
    const posts = Array.isArray(state.posts) ? state.posts : [];
    if (seenPosts) {
      for (const p of posts) if (p && p.id && !seenPosts.has(p.id) && ['resident','visitor'].includes(p.authorKind)) { const rec = figures.get(figureKey(p.authorKind, p.author)); if (rec && rec.F.recipe && !rec.F.recipe.hooded) say(rec.F, p.text); }
    }
    seenPosts = new Set(posts.filter((p) => p && p.id).map((p) => p.id));
  }
  const apprentices = new Map(), apprenticeParams = new URLSearchParams(location.search), threadMats = new Map();
  function removeApprentice(a, key) { a.F.root.removeFromParent(); a.thread.removeFromParent(); a.thread.geometry.dispose(); apprentices.delete(key); }
  function syncApprentices(state) {
    const allowed = apprenticesAllowed(state, apprenticeParams), seen = new Set(), safeMasters = new Set();
    let demo = 0;
    for (const r of state.residents || []) {
      const master = figures.get(figureKey('resident', r.name)); if (!master) continue;
      const safe = allowed && r.zone === 'village' && !r.isleTagged && !r.quarantined && !r.sealed && r.mood !== 'sealed';
      if (safe) safeMasters.add(master);
      let parallel = safe ? r.parallel : [];
      if (safe && apprenticeParams.get('apprentices') === 'demo' && demo++ < 2) parallel = ['library', 'forge', 'quarry', 'temple'].map((site, i) => ({ orderId: `demo-${r.name}-${i}`, headline: `Apprentice at the ${site}`, site, startedAt: 0 }));
      const capped = apprenticeCap(parallel);
      master.F.label.querySelector('.apprentice-count')?.remove();
      if (capped.badge) { const badge = document.createElement('span'); badge.className = 'apprentice-count'; badge.textContent = `+${capped.badge}`; master.F.label.append(badge); }
      for (let i = 0; i < capped.orders.length; i++) {
        const order = capped.orders[i], key = JSON.stringify([r.name, order.orderId]); seen.add(key);
        let a = apprentices.get(key);
        if (!a) {
          // Retiring echoes yield their slot immediately when another order starts.
          if ([...apprentices.values()].filter(a => a.master === master).length >= 3) { const old = [...apprentices].find(([k, a]) => a.master === master && !capped.orders.some(o => o.orderId === a.orderId)); if (old) removeApprentice(old[1], old[0]); }
          const F = createApprentice(r, apprenticeProp(order.site), order.orderId), color = F.color;
          if (!threadMats.has(color)) threadMats.set(color, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.22, depthWrite: false }));
          const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3)); const thread = new THREE.Line(geometry, threadMats.get(color)); thread.frustumCulled = false; thread.visible = false; scene.add(thread, F.root);
          a = { F, master, orderId: order.orderId, x: master.pos.x, y: master.pos.y, tx: 0, ty: 0, alpha: 0, phase: 'in', present: true, thread, path: null, pathI: 1 }; apprentices.set(key, a);
        }
        a.present = true; a.hoverMaster = `resident:${master.id}`; a.hoverEcho = `apprentice:${master.id}`; a.followKey = figureKey('resident', master.id);
        const site = (state.sites || []).find(s => s.id === order.site), place = order.site && (state.places || []).find(p => p.zone !== 'isle' && p.id === (site?.placeId || order.site));
        a.near = !place; a.offset = 14 + i * 8;
        const tx = (place?.x ?? master.pos.x) + 14 + i * 8, ty = (place?.y ?? master.pos.y) + 22;
        if (a.tx !== tx || a.ty !== ty || a.phase === 'return' || a.phase === 'out') { a.tx = tx; a.ty = ty; a.path = route(graph, { x: a.x, y: a.y }, { x: tx, y: ty }); a.pathI = 1; }
      }
    }
    for (const [key, a] of apprentices) {
      if (!safeMasters.has(a.master) || !allowed || !figures.has(figureKey('resident', a.master.id)) || a.master.zone !== 'village') { removeApprentice(a, key); continue; }
      if (!seen.has(key)) { if (a.present) { a.path = route(graph, { x: a.x, y: a.y }, a.master.pos); a.pathI = 1; } a.present = false; }
    }
  }
  function tickApprentices(dt, time, night) {
    let movingAny = false;
    for (const [key, a] of apprentices) {
      const m = a.master;
      if (a.present && a.near) { a.tx = m.pos.x + a.offset; a.ty = m.pos.y + 22; a.path = null; }
      const target = a.path?.[a.pathI];
      let tx = target?.x ?? (a.present ? a.tx : m.pos.x), ty = target?.y ?? (a.present ? a.ty : m.pos.y);
      const dx = tx - a.x, dy = ty - a.y, d = Math.hypot(dx, dy), step = dt * 0.032, moving = d > 0.5;
      if (moving) { const k = Math.min(1, step / d); a.x += dx * k; a.y += dy * k; a.F.root.rotation.y = Math.atan2(dx, dy); }
      if (d <= step && target) a.pathI++;
      const arrived = !a.present && Math.hypot(a.x - m.pos.x, a.y - m.pos.y) < 4;
      apprenticeFade(a, dt, a.present, arrived);
      if (a.phase === 'done') { removeApprentice(a, key); continue; }
      fadeApprentice(a.F, a.alpha); a.F.root.position.set(a.x, groundY(a.x, a.y), a.y);
      tickFigure(a.F, dt, time, moving, 32, 0, night);
      if (!moving) { a.F.parts.armR.rotation.x = -1.1 + Math.sin(time * 3) * 0.14; a.F.parts.head.rotation.x = 0.18; }
      a.thread.visible = hovered === a.hoverMaster || hovered === a.hoverEcho || follow === a.followKey;
      if (a.thread.visible) { const p = a.thread.geometry.attributes.position; p.setXYZ(0, m.pos.x, m.F.root.position.y + 6, m.pos.y); p.setXYZ(1, a.x, a.F.root.position.y + 4, a.y); p.needsUpdate = true; }
      if (moving || a.phase === 'in' || a.phase === 'out') movingAny = true;
    }
    return movingAny;
  }
  let seenPosts = null;

  // ---------- update from state ----------
  let current = null;
  function update(state) {
    current = state || {};
    const now = Date.now();
    const places = Array.isArray(state.places) ? state.places : [];
    const workshops = Array.isArray(state.workshops) ? state.workshops : [];
    const plots = Array.isArray(state.plots) ? state.plots : [];
    const objects = Array.isArray(state.objects) ? state.objects : [];
    const zones = Array.isArray(state.zones) ? state.zones : [];
    const hasIsle = zones.some((z) => z && z.id === 'isle') || (+state.world?.width || 0) > 1000;
    if (hasIsle) ensureIsle();
    setWorldSize(state.world?.width || (hasIsle ? 1700 : 1000), state.world?.height || 760);
    setSunGoal(state.world, state.world?.sun ? null : state.world?.phase);
    rebuildStatic(places, workshops.filter((w) => zoneOf(w) === 'isle'), plots, objects, state.sites || []);
    syncTrees(Array.isArray(state.trees) ? state.trees : [], now);
    syncFigures(state, now);
    syncApprentices(state);
    const locked = !!(state.seal?.enabled && state.seal.locked);
    container.classList.toggle('sealed', locked);
    updateDome(locked, Array.isArray(state.seal?.runes) ? state.seal.runes : []);
    busyForge = (state.workers || []).some((w) => w && w.site === 'forge' && w.status === 'running' && !w.stale);
    busyWs = new Set((state.workers || []).filter((w) => w && w.status === 'running' && !w.stale).map((w) => `${w.project}@${w.host}`));
    needsRender = true;
    startLoop();
  }
  let busyForge = false, busyWs = new Set();
  // seal dome: translucent shell over the isle with drifting Linear A labels
  let dome = null;
  function updateDome(on, runes) {
    if (!on) { if (dome) { dome.removeFromParent(); dome = null; } return; }
    if (dome) return;
    dome = new THREE.Group();
    const g = new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    const m = new THREE.Mesh(g, new THREE.MeshPhysicalMaterial({ color: '#9fe8d8', transparent: true, opacity: 0.16, roughness: 0.2, transmission: 0, side: THREE.DoubleSide, depthWrite: false }));
    m.scale.set(330, 260, 440); m.position.set(ISLE.center.x, 0, ISLE.center.y); dome.add(m);
    const lines = runes.length ? runes : ['𐘀𐘁𐘂'];
    for (let i = 0; i < Math.min(8, lines.length); i++) {
      const d = document.createElement('div'); d.className = 'lbl rune-drift-3d'; d.textContent = Array.from(String(lines[i])).slice(0, 18).join('');
      d.style.animationDelay = `${-(i * 2.3) % 14}s`;
      const o = new CSS2DObject(d); const a = (i / 8) * Math.PI * 2; o.position.set(ISLE.center.x + Math.cos(a) * 220, 60 + (i % 3) * 50, ISLE.center.y + Math.sin(a) * 300); dome.add(o);
    }
    scene.add(dome);
  }

  // ---------- animation loop ----------
  let running = false, lastT = 0, needsRender = true, follow = null, pausedHidden = false, ambientTimer = null;
  document.addEventListener('visibilitychange', () => { pausedHidden = document.visibilityState === 'hidden'; if (!pausedHidden) { needsRender = true; startLoop(); } });
  function startLoop() { clearTimeout(ambientTimer); if (running || pausedHidden) return; running = true; requestAnimationFrame(tick); }
  function tick(t) {
    if (pausedHidden) { lastT = 0; running = false; return; }
    const dt = Math.min(64, t - (lastT || t)); lastT = t;
    const time = t / 1000, ds = dt / 1000;
    if (easeSun()) { applyLook(); }
    const night = isNight();
    const nextVillageState=mist.tick(current,t,dt,{ night, alt: sunCur.alt });
    if(nextVillageState!==villageState) {villageState=nextVillageState;window.dispatchEvent(new CustomEvent('village-state-change',{detail:villageState}));}
    sun.intensity=sunBase*(villageState === 'paused' && !mist.clock.wasActive ? 0.94 : 1);
    let active = false;
    // figures: walk along paths, amble, gesture
    for (const [, rec] of figures) {
      const F = rec.F;
      let moving = false, turning = 0;
      if (rec.ceremony) {
        const c = rec.ceremony, p = Math.min(1, (t - c.start) / 3000), e = p * p * (3 - 2 * p);
        // Direct descent through the orchestra, then onto the Green beside the Almond.
        const exit = { x: THEATRE.x + Math.cos(THEATRE.open) * 30, y: THEATRE.z + Math.sin(THEATRE.open) * 30 };
        const dest = { x: 419, y: 454 }, a = e < 0.4 ? c.from : exit, b = e < 0.4 ? exit : dest, q = e < 0.4 ? e / 0.4 : (e - 0.4) / 0.6;
        rec.pos = { x: a.x + (b.x - a.x) * q, y: a.y + (b.y - a.y) * q };
        rec.seatHeight = c.height * Math.max(0, 1 - e / 0.4);
        rec.heading = p < 1 ? Math.atan2(b.x - a.x, b.y - a.y) : Math.atan2(440 - dest.x, 420 - dest.y);
        moving = p < 1; rec.speed = 28; active = true;
        if (t >= c.until) {
          rec.banner?.removeFromParent(); rec.banner = null; rec.ceremony = null; rec.seatHeight = 0;
          rec.target = { ...rec.normalTarget }; rec.path = route(rec.zone === 'isle' ? isleGraph : graph, rec.pos, rec.target); rec.pathI = 1;
        }
      } else if (rec.path && rec.pathI < rec.path.length) {
        const tgt = rec.path[rec.pathI];
        const d = dist(rec.pos, tgt);
        const slope = Math.abs(groundY(tgt.x,tgt.y)-groundY(rec.pos.x,rec.pos.y))/Math.max(1,d);
        const step = rec.speed * ds / Math.sqrt(1+slope*slope);
        if (d <= step) { rec.pos = { ...tgt }; rec.pathI++; }
        else { rec.pos = { x: rec.pos.x + (tgt.x - rec.pos.x) / d * step, y: rec.pos.y + (tgt.y - rec.pos.y) / d * step }; }
        const heading = Math.atan2(tgt.x - rec.pos.x, tgt.y - rec.pos.y);
        let dh = heading - rec.heading; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
        rec.heading += dh * Math.min(1, ds * 6); turning = Math.max(-1, Math.min(1, dh));
        moving = true; active = true;
        if (rec.pathI >= rec.path.length) { rec.path = null; rec.amble = 5 + Math.random() * 9; rec.arrived = true; if (rec.placeId === 'green') rec.heading = Math.atan2(440 - rec.pos.x, 420 - rec.pos.y); }
      } else if (!rec.seated && ['resident','visitor'].includes(rec.kind) && !rec.dim && !F.recipe.hooded) {
        rec.amble -= ds;
        if (rec.arrived) { rec.arrived = false; const g = { library: 'read', greatlibrary: 'read', studio: 'write', plaza: 'tend', forge: 'hammer', quarry: 'haul' }[rec.placeKind]; if (g) gesture(F, g, 2.5 + Math.random() * 2); }
        if (rec.amble <= 0) {
          rec.amble = 6 + Math.random() * 12;
          if (Math.random() < 0.35) { const held = F.heldKind; gesture(F, held === 'lyre' ? 'strum' : held === 'scroll' || held === 'book' ? 'read' : held === 'lantern' && night ? 'raise' : held === 'quill' ? 'write' : 'wave', 2 + Math.random() * 2); }
          else { const a = Math.random() * 6.28, r = 10 + Math.random() * 18; const to = { x: rec.target.x + Math.cos(a) * r, y: rec.target.y + Math.abs(Math.sin(a)) * r }; if (groundHeight(to.x,to.y) >= 0 && Math.abs(groundHeight(to.x,to.y)-groundHeight(rec.pos.x,rec.pos.y)) < 1) { rec.path = [rec.pos, to]; rec.pathI = 1; rec.speed = 22; } }
        }
      } else if (rec.kind === 'god' && rec.placeKind && !F.recipe.hooded && F.status === 'running') {
        rec.amble -= ds;
        if (rec.amble <= 0) { rec.amble = 5 + Math.random() * 8; const g = { greatlibrary: 'read', forge: 'hammer', quarry: 'haul', temple: 'raise' }[rec.placeKind]; if (g) gesture(F, g, 2.5); }
      }
      F.root.position.set(rec.pos.x, groundY(rec.pos.x, rec.pos.y) + (rec.seatHeight || 0), rec.pos.y);
      F.root.rotation.y = rec.heading;
      tickFigure(F, dt, time, moving, rec.speed, turning, night);
      if (rec.seated) {
        F.body.position.y = -2.5;
        F.parts.legL.rotation.x = F.parts.legR.rotation.x = -Math.PI / 2;
      }
      if (F.anim.gesture) active = true;
      F.root.userData.moving = moving;
    }
    if (apprentices.size && tickApprentices(dt, time, night)) active = true;
    let frameMotion = active; // walking and gestures need full frame rate; ambient life uses 20 fps.
    // trees
    for (const [, g] of treeGroups) if (tickTree3D(g, g.userData.tree || {}, dt, time)) active = true;
    // forge embers / isle workshop smoke
    if (emberEmitter && busyForge) { spawnSmoke(emberEmitter, '#F0742E', true); active = true; }
    for (const s of smokeEmitters) if (busyWs.has(s.key)) { spawnSmoke(s, '#E9E4DC', false); active = true; }
    for (let i = smokeParticles.length - 1; i >= 0; i--) {
      const p = smokeParticles[i]; p.userData.life += ds;
      p.position.y += 14 * ds; p.position.x += Math.sin(time * 2 + p.userData.ph) * 3 * ds; p.scale.multiplyScalar(1 + ds * 0.6);
      p.material.opacity = Math.max(0, 0.6 * (1 - p.userData.life / p.userData.ttl));
      if (p.userData.life > p.userData.ttl) { smokeGroup.remove(p); p.material.dispose(); smokeParticles.splice(i, 1); }
      active = true;
    }
    // the Starwatch armillary: star cage turns at night (one turn per three minutes — true sidereal would be invisible),
    // faster and glowing while a Starwatch reading runs
    if (armillary) {
      const run = !!current?.starwatch?.running, dark = sunCur.alt < -2;
      if (dark || run) { armillary.spin.rotation.y += ds * (run ? 0.9 : Math.PI * 2 / 180); active = true; }
      const goal = run ? 0.7 : 0;
      if (Math.abs(armillary.glow - goal) > 0.005) { armillary.glow += (goal - armillary.glow) * Math.min(1, ds * 1.5); armillary.bronze.emissiveIntensity = armillary.glow * 0.8; active = true; }
      if (run) { const pulse = 1 + 0.35 * Math.sin(time * 3); for (const b of armillary.beads) b.scale.setScalar(pulse); }
      else if (armillary.beads[0].scale.x !== 1) for (const b of armillary.beads) b.scale.setScalar(1);
    }
    // lighthouse beam & water shimmer at night
    if (beamCone) { for (const c of beamCone.children) c.material.opacity = night ? c.userData.op : 0; if (night) { beamCone.rotation.y = time * 0.3; active = true; } }
    terrain.glint.material.opacity = 0.42 + Math.sin(time * 0.8) * 0.14;
    // follow mode
    if (follow) { const rec = figures.get(follow); if (rec) { view.cx += (rec.pos.x - view.cx) * Math.min(1, ds * 2.5); view.cz += (rec.pos.y - view.cz) * Math.min(1, ds * 2.5); controls.target.set(view.cx, 0, view.cz); placeCamera(); active = true; } }
    // Seven-second approach from the sea off Willow Pier, past the Green.
    if (introFlight) {
      const p = Math.min(1, (t - introFlight) / 7000), e = p * p * (3 - 2 * p);
      const k = Math.min(1, e / 0.72), h = k * k * (3 - 2 * k);
      view.cx = 880 + (440 - 880) * h + (560 - 440) * Math.max(0, (e - 0.72) / 0.28);
      view.cz = 850 + (420 - 850) * h + (412 - 420) * Math.max(0, (e - 0.72) / 0.28);
      ISO.el = 0.20 + (0.61 - 0.20) * e;
      camera.zoom = 2.8 + (0.76 - 2.8) * e;
      camera.updateProjectionMatrix(); controls.target.set(view.cx, 0, view.cz); placeCamera();
      active = true;
      if (p >= 1) finishIntro();
    }
    // camera easing
    if (viewAnim) {
      const p = Math.min(1, (t - viewAnim.t0) / viewAnim.dur), e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      view.cx = viewAnim.from.cx + (viewAnim.to.cx - viewAnim.from.cx) * e; view.cz = viewAnim.from.cz + (viewAnim.to.cz - viewAnim.from.cz) * e;
      camera.zoom = viewAnim.from.zoom + (viewAnim.to.zoom - viewAnim.from.zoom) * e; camera.updateProjectionMatrix();
      controls.target.set(view.cx, 0, view.cz); placeCamera();
      if (p >= 1) viewAnim = null;
      active = true;
    }
    if (controls.update()) { active = true; frameMotion = true; }
    clampView();
    // idle (only breathing/bobbing): render at ~20 fps; anything else: every frame
    idleAcc += dt;
    if (active || needsRender) { render(); needsRender = false; idleAcc = 0; }
    else if (idleAcc >= 50) { render(); idleAcc = 0; }
    // End the cinematic RAF chain when the camera settles. Existing petals, breathing,
    // mist and water retain a paced ambient clock, and interaction wakes us immediately.
    if (frameMotion || introFlight || viewAnim || follow) requestAnimationFrame(tick);
    else { running = false; ambientTimer = setTimeout(startLoop, 50); }
  }
  let viewAnim = null, idleAcc = 0, introFlight = null;
  function finishIntro() { introFlight = null; ISO.el = 0.61; controls.enabled = true; panTo('village', false); needsRender = true; startLoop(); }
  function playIntro() { follow = null; viewAnim = null; controls.enabled = false; introFlight = performance.now(); startLoop(); return finishIntro; }
  function spawnSmoke(at, color, ember) {
    if (Math.random() > 0.18) return;
    const p = new THREE.Mesh(new THREE.IcosahedronGeometry(ember ? 1.4 : 2.2, 0), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6 }));
    p.position.set(at.x + (Math.random() - 0.5) * 3, at.y, at.z + (Math.random() - 0.5) * 3);
    p.userData = { life: 0, ttl: ember ? 1.4 : 3.2, ph: Math.random() * 6 };
    smokeGroup.add(p); smokeParticles.push(p);
  }
  const NOPOST = new URLSearchParams(location.search).get('nopost') === '1';
  function render() {
    syncViewFromCamera();
    placeSky();
    declutter();
    if (NOPOST) renderer.render(scene, camera); else composer.render();
    labelRenderer.render(scene, camera);
  }
  function syncViewFromCamera() {
    view.cx = controls.target.x; view.cz = controls.target.z;
    view.w = 1000 / camera.zoom;
    updateShadowFrustum();
  }
  function clampView() {
    const mx = 260, mz = 220;
    const tx = Math.max(-mx, Math.min(WORLD.w + mx, controls.target.x)), tz = Math.max(-mz, Math.min(WORLD.h + mz, controls.target.z));
    if (tx !== controls.target.x || tz !== controls.target.z) { const dx = tx - controls.target.x, dz = tz - controls.target.z; controls.target.x = tx; controls.target.z = tz; camera.position.x += dx; camera.position.z += dz; }
  }
  let zoomBand = '';
  function declutter() {
    const band = view.w > 1150 ? 'far' : view.w > 420 ? 'mid' : 'near';
    if (band !== zoomBand) { zoomBand = band; container.dataset.zoom = band; if (plotMesh) plotMesh.visible = band === 'near'; opts.onViewChange?.(viewInfo()); }
    const r = container.getBoundingClientRect(), W = r.width || 1, H = r.height || 1, v = new THREE.Vector3(), taken = [];
    const recs = [...figures.values()].map((rec) => { const force = !!(rec.F.root.userData.active || rec.F.bubbleEl || rec.kind === 'you'); rec.F.label.classList.toggle('force', force); return { rec, force }; }).sort((a, b) => +b.force - +a.force);
    for (const { rec, force } of recs) {
      const el = rec.F.label; rec.F.labelObj.getWorldPosition(v); v.project(camera);
      const x = (v.x + 1) / 2 * W, y = (1 - v.y) / 2 * H, bw = Math.max(el.offsetWidth || 0, (el.textContent || '').length * 7 + 12) + 6, bh = (el.offsetHeight || 18) + 4;
      let clash = x < 14 || x > W - 14 || y < 14 || y > H - 14;
      if (!clash && (force || band === 'near')) { for (const t of taken) if (Math.abs(t.x - x) < (t.bw + bw) / 2 && Math.abs(t.y - y) < bh) { clash = true; break; } }
      if (!clash) taken.push({ x, y, bw, shown: force || band === 'near' });
      el.classList.toggle('clash', clash);
    }
    for (const [, o] of placeLabels) { o.getWorldPosition(v); v.project(camera); const x = (v.x + 1) / 2 * W, y = (1 - v.y) / 2 * H, hw = Math.max(o.element.offsetWidth || 0, (o.element.textContent || '').length * 7.6 + 16) / 2 + 4; o.element.classList.toggle('edge', x - hw < 2 || x + hw > W - 2 || y < 12 || y > H - 12); o.element.classList.toggle('yield', taken.some((t) => t.shown && Math.abs(t.x - x) < t.bw / 2 + hw && Math.abs(t.y - y) < 22)); }   // a resident's name wins over the place label it would cover   // projected this frame, so no placement lag
  }

  // ---------- picking & gestures ----------
  const raycaster = new THREE.Raycaster();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  function ndc(cx, cy) { const r = container.getBoundingClientRect(); return new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1); }
  function pickAt(cx, cy) {
    raycaster.setFromCamera(ndc(cx, cy), camera);
    const targets = [];
    scene.traverse((o) => { if (o.userData && o.userData.pick && o.userData.pickable !== false && o.isMesh) targets.push(o); });
    const hits = raycaster.intersectObjects(targets, false);
    if (hits.length) return hits[0].object.userData.pick;
    return null;
  }
  function toWorld(cx, cy) {
    raycaster.setFromCamera(ndc(cx, cy), camera);
    const terrainHits=raycaster.intersectObject(terrain.group,true).filter(h=>h.object.name==='land');
    if(terrainHits.length) return {x:terrainHits[0].point.x,y:terrainHits[0].point.z};
    const p = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(groundPlane, p)) return { x: view.cx, y: view.cz };
    return { x: p.x, y: p.z };
  }
  function project(x, y, h = 0) {
    const r = container.getBoundingClientRect();
    const v = new THREE.Vector3(x, groundY(x, y) + h, y).project(camera);
    return { left: (v.x + 1) / 2 * r.width, top: (1 - v.y) / 2 * r.height, scale: camera.zoom };
  }
  let down = null;
  renderer.domElement.addEventListener('pointerdown', (e) => {
    const t = e.target; if (!(t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable))) e.preventDefault();
    down = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
  });
  renderer.domElement.addEventListener('pointermove', (e) => { if (down && !down.moved && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) { down.moved = true; container.classList.add('dragging'); follow = null; viewAnim = null; try { window.getSelection()?.removeAllRanges(); } catch (_) { /* no selection API */ } } });
  renderer.domElement.addEventListener('pointerup', (e) => {
    container.classList.remove('dragging');
    if (!down) return;
    const d = down; down = null;
    if (d.moved || e.button !== 0) return;
    const pick = pickAt(e.clientX, e.clientY);
    if (pick) {
      if (pick.type === 'apprentice') { follow = figureKey('resident', pick.id); opts.onResidentClick?.(pick.id); return opts.onApprenticeClick?.(pick.id, pick.orderId); }
      if (pick.type === 'resident') { follow = figureKey('resident', pick.id); return opts.onResidentClick?.(pick.id); }
      if (pick.type === 'visitor') { follow=figureKey('visitor',pick.id); const v=current?.visitors?.find(v=>v.name===pick.id); return opts.onVisitorClick?.(pick.id) ?? (v?.placeId && opts.onPlaceClick?.(v.placeId)); }
      if (pick.type === 'worker') return opts.onWorkerClick?.(pick.id);
      if (pick.type === 'object') return opts.onObjectClick?.(pick.id);
      if (pick.type === 'tree') return opts.onTreeClick?.(pick.id);
      if (pick.type === 'you') return opts.onYouClick?.();
      if (pick.type === 'place') return opts.onPlaceClick?.(pick.id);
      if (pick.type === 'workshop') return;
    }
    const p = toWorld(e.clientX, e.clientY);
    if (p.x < -30 || p.y < -30 || p.x > WORLD.w + 30 || p.y > WORLD.h + 30) return;
    const x = Math.round(Math.max(0, Math.min(WORLD.w, p.x))), y = Math.round(Math.max(0, Math.min(WORLD.h, p.y)));
    opts.onGroundClick?.(x, y, x >= ISLE.bounds.x && isleBuilt ? 'isle' : 'village');
  });
  renderer.domElement.addEventListener('dblclick', (e) => {
    const pick = pickAt(e.clientX, e.clientY);
    let p;
    if (pick && pick.type === 'place') { const pl = (current?.places || []).find((x) => x.id === pick.id); if (pl) p = { x: pl.x, y: pl.y }; }
    if (!p) p = toWorld(e.clientX, e.clientY);
    animateView(p.x, p.y, 1000 / 320);
  });
  let hovered = null;
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    if (down && down.moved) return;
    const pick = pickAt(e.clientX, e.clientY);
    const key = pick ? `${pick.type}:${pick.id}` : null;
    if (key === hovered) return;
    hovered = key;
    renderer.domElement.style.cursor = pick ? 'pointer' : '';
    opts.onHover?.(pick ? { type: pick.type === 'apprentice' ? 'resident' : pick.type, id: pick.id } : null);
  });
  controls.addEventListener('change', () => { needsRender = true; startLoop(); opts.onViewChange?.(viewInfo()); });

  // ---------- view API ----------
  function viewInfo() { syncViewFromCamera(); return { center: { x: view.cx, y: view.cz }, zone: view.cx > SEA_X + 75 ? 'isle' : 'village', vb: { x: view.cx - view.w / 2, y: view.cz - view.w * 0.38, w: view.w, h: view.w * 0.76 } }; }
  function animateView(cx, cz, zoom, dur = 900) {
    syncViewFromCamera();
    viewAnim = { from: { cx: view.cx, cz: view.cz, zoom: camera.zoom }, to: { cx, cz, zoom: Math.max(controls.minZoom, Math.min(controls.maxZoom, zoom)) }, t0: performance.now(), dur };
    follow = null;
    startLoop();
  }
  function zoneBounds(id) {
    const z = (current?.zones || []).find((z) => z && z.id === id);
    if (z && z.bounds) return { x: +z.bounds.x || 0, y: +z.bounds.y || 0, w: +z.bounds.w || 1000, h: +z.bounds.h || 760 };
    return id === 'isle' ? ISLE.bounds : VILLAGE;
  }
  function panTo(zoneId, animate = true) {
    if (zoneId === 'green') {
      const green = current?.places?.find(p => p.id === 'green');
      if (green) { follow = null; animateView(green.x, green.y, 1.2); return; }
    }
    const b = zoneBounds(zoneId);
    const cx = zoneId === 'isle' ? b.x + b.w / 2 + 230 : 560, cz = zoneId === 'isle' ? b.y + b.h / 2 + 30 : 412, zoom = zoneId === 'isle' ? 1000 / Math.max(1000, b.w + 720) : 0.76;
    if (!animate) { viewAnim = null; view.cx = cx; view.cz = cz; camera.zoom = zoom; camera.updateProjectionMatrix(); controls.target.set(cx, 0, cz); placeCamera(); needsRender = true; return; }
    animateView(cx, cz, zoom);
  }
  function setView(v) { viewAnim = null; const w = +v.w || 1000; view.cx = (+v.x || 0) + w / 2; view.cz = (+v.y || 0) + w * 0.38; camera.zoom = 1000 / w; camera.updateProjectionMatrix(); controls.target.set(view.cx, 0, view.cz); placeCamera(); needsRender = true; }
  function entityPos(type, id) {
    if (type === 'tree') { const g = treeGroups.get(id); if (!g) return null; return { x: g.position.x, y: g.position.z - ((g.userData.layout?.S.h || 20) + (g.userData.layout?.S.r || 20) * 0.5) }; }
    if (type === 'place' || type === 'workshop') { const p = (current?.places || []).find((x) => x && x.id === id) || (current?.workshops || []).find((x) => x && x.id === id); return p ? { x: p.x, y: p.y - ((placeInfo.get(id)?.h || 20) + (placeInfo.get(id)?.y0 || 0)) * 0.6 } : null; }
    const rec = figures.get(figureKey(type === 'worker' ? 'god' : type, id));
    if (rec) return { x: rec.pos.x, y: rec.pos.y - FIGURE_H * 1.1 };
    if (type === 'object') { const o = (current?.objects || []).find((x) => x && x.id === id); return o ? { x: o.x, y: o.y - 8 } : null; }
    return null;
  }
  function pulseAt(x, y) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(3, 4.5, 24), new THREE.MeshBasicMaterial({ color: '#fff2cc', transparent: true, opacity: 0.9 }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(x, groundY(x, y) + 0.4, y); scene.add(ring);
    const t0 = performance.now();
    const step = () => { const p = (performance.now() - t0) / 800; if (p >= 1) { scene.remove(ring); return; } ring.scale.setScalar(1 + p * 4); ring.material.opacity = 1 - p; needsRender = true; requestAnimationFrame(step); };
    step();
  }
  function recenter() { panTo(viewInfo().zone, true); }
  function setGiftMode(on) { container.classList.toggle('gift-mode', !!on); }

  resize();
  setSunGoal({ phase: 'morning' }, null);
  panTo('village', false);
  return { playIntro, getVillageState, sunInfo, update, project, toWorld, entityPos, pulseAt, recenter, panTo, setView, viewInfo, setGiftMode, get state() { return current; }, follow: (name) => { follow = name ? figureKey('resident', name) : null; } };
}
