// Walkable surfaces: figures stand on the buildings' floors, stairs and terraces instead of wading through them.
// Baked once per static rebuild from the buildings' own triangles (world space); appearance is untouched.
const CELL = 0.5, SLOPE = 0.55;   // grid size; normals flatter than ~57° count as floor (treads, podiums, ramps)

export class WalkSurface {
  constructor(ground, { clear = 8 } = {}) { this.ground = ground; this.clear = clear; this.cells = new Map(); }
  static key(ix, iz) { return (ix + 32768) * 65536 + (iz + 32768); }
  // geometries: non-indexed BufferGeometries already in world space (Builder parts).
  addGeometries(geos) {
    for (const g of geos) {
      const p = g.attributes.position?.array; if (!p) continue;
      for (let i = 0; i + 8 < p.length; i += 9) this.addTriangle(p[i], p[i + 1], p[i + 2], p[i + 3], p[i + 4], p[i + 5], p[i + 6], p[i + 7], p[i + 8]);
    }
    for (const list of this.cells.values()) list.sort((a, b) => a - b);
    return this;
  }
  addTriangle(ax, ay, az, bx, by, bz, cx, cy, cz) {
    // Upward-facing only (either winding): its unit normal's y must be steep enough to stand on.
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, len = Math.hypot(nx, ny, nz);
    if (!len || Math.abs(ny) / len < SLOPE) return;
    const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz); if (Math.abs(det) < 1e-9) return;
    const x0 = Math.floor(Math.min(ax, bx, cx) / CELL), x1 = Math.ceil(Math.max(ax, bx, cx) / CELL), z0 = Math.floor(Math.min(az, bz, cz) / CELL), z1 = Math.ceil(Math.max(az, bz, cz) / CELL);
    const e = -1e-4 * Math.abs(det);   // a hair of slack so shared edges don't leave gaps
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
      const px = (ix + 0.5) * CELL, pz = (iz + 0.5) * CELL;
      const l1 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)), l2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)), l3 = det - l1 - l2;
      if (det > 0 ? (l1 < e || l2 < e || l3 < e) : (l1 > -e || l2 > -e || l3 > -e)) continue;
      const y = (l1 * ay + l2 * by + l3 * cy) / det, k = WalkSurface.key(ix, iz), list = this.cells.get(k);
      if (!list) this.cells.set(k, [y]); else if (!list.some((h) => Math.abs(h - y) < 0.05)) list.push(y);
    }
  }
  // Where a figure can stand at (x, z): the ground or any floor with headroom above it, nearest `near` (lowest if none).
  heightAt(x, z, near) {
    const g = this.ground(x, z), list = this.cells.get(WalkSurface.key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!list) return g;
    const layers = [g, ...list.filter((h) => h > g + 0.05)];
    let best = null;
    for (let i = 0; i < layers.length; i++) {
      const above = layers.slice(i + 1).find((h) => h > layers[i] + 0.05);
      if (above !== undefined && above - layers[i] < this.clear) continue;   // a floor sits on it: buried, not standable
      if (best === null || (near !== undefined && Math.abs(layers[i] - near) < Math.abs(best - near))) best = layers[i];
    }
    return best ?? layers.at(-1);
  }
}

// Eases a figure's height toward the surface so stair treads read as steps, not teleports.
export function settle(rec, target, ds) {
  if (rec.wy === undefined || !Number.isFinite(rec.wy) || Math.abs(target - rec.wy) > 40) return (rec.wy = target);
  const up = 45 * ds, down = 70 * ds;
  return (rec.wy += Math.max(-down, Math.min(up, target - rec.wy)));
}
