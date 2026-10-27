// Optional set-dressing from the CC0/CC-BY library in public/assets (see assets/CREDITS.md):
// a few rubble / rock / broken-column pieces, bounding-box normalised, recoloured to the palette
// and instanced. Fails quietly (the procedural scene is complete without them).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

const PIECES = [
  { key: 'column', path: 'assets/models/kenney/nature/statue_columnDamaged.glb', height: 28, color: '#D9CFBC' },
  { key: 'block', path: 'assets/models/kenney/nature/statue_block.glb', height: 10, color: '#B5AA98' },
  { key: 'rockA', path: 'assets/models/kenney/nature/rock_largeA.glb', height: 9, color: '#9A9397' },
  { key: 'rockB', path: 'assets/models/kenney/nature/rock_largeB.glb', height: 7, color: '#7A7380' },
  { key: 'head', path: 'assets/models/kenney/nature/statue_head.glb', height: 16, color: '#D9CFBC' },
  { key: 'ring', path: 'assets/models/kenney/nature/statue_ring.glb', height: 14, color: '#B5AA98' },
];
const cache = new Map();
function recolour(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(hex); const n = g.attributes.position.count; const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  for (const k of ['uv', 'uv1', 'uv2', 'tangent', 'skinIndex', 'skinWeight']) if (g.attributes[k] && k !== 'uv') g.deleteAttribute(k);
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  return g;
}
async function loadPiece(p) {
  if (cache.has(p.key)) return cache.get(p.key);
  const loader = new GLTFLoader();
  const promise = new Promise((resolve, reject) => loader.load(p.path, (gltf) => {
    const geos = [];
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => { if (o.isMesh && o.geometry) { const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld); geos.push(recolour(g, p.color)); } });
    if (!geos.length) return reject(new Error('empty'));
    const merged = BufferGeometryUtils.mergeGeometries(geos, false);
    merged.computeBoundingBox();
    const bb = merged.boundingBox; const size = new THREE.Vector3(); bb.getSize(size);
    const s = p.height / Math.max(0.001, size.y);
    merged.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
    merged.scale(s, s, s);
    merged.computeVertexNormals();
    resolve(merged);
  }, undefined, reject));
  cache.set(p.key, promise);
  return promise;
}
// placements: [{ key, x, y, z, ry, s }] → InstancedMesh per key (added to `parent`)
export async function placeAssets(parent, placements, material) {
  const byKey = new Map();
  for (const pl of placements) { if (!byKey.has(pl.key)) byKey.set(pl.key, []); byKey.get(pl.key).push(pl); }
  const out = [];
  for (const [key, list] of byKey) {
    const spec = PIECES.find((p) => p.key === key); if (!spec) continue;
    try {
      const geo = await loadPiece(spec);
      const mesh = new THREE.InstancedMesh(geo, material, list.length);
      const m = new THREE.Matrix4();
      list.forEach((pl, i) => { m.makeRotationY(pl.ry || 0); m.scale(new THREE.Vector3(pl.s || 1, pl.s || 1, pl.s || 1)); m.setPosition(pl.x, pl.y, pl.z); mesh.setMatrixAt(i, m); });
      mesh.instanceMatrix.needsUpdate = true; mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = `asset-${key}`;
      parent.add(mesh); out.push(mesh);
    } catch (err) { console.warn('asset piece unavailable', key, err?.message || err); }
  }
  return out;
}
export const ASSET_KEYS = PIECES.map((p) => p.key);
