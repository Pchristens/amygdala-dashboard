// Shared SVG + math helpers for the map modules.
export const NS = 'http://www.w3.org/2000/svg';

export function el(tag, attrs = {}, parent = null) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}
// Static, hand-authored markup only (never user/agent data).
export function art(parent, markup, attrs = {}) {
  const g = el('g', attrs, parent);
  g.innerHTML = markup;
  return g;
}
export function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hashStr(s) {
  let h = 2166136261;
  for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function hexMix(hex, target, amt) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return target;
  const n = parseInt(m[1], 16);
  const t = parseInt(target.slice(1), 16);
  const ch = (shift) => Math.round(((n >> shift) & 255) * (1 - amt) + ((t >> shift) & 255) * amt);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}
export function safeColor(c, fallback = '#b8b0a6') {
  return /^#[0-9a-f]{6}$/i.test(String(c || '')) ? c : fallback;
}
export function smoothPath(pts, close = false) {
  if (!pts.length) return '';
  const p = close ? [...pts, pts[0]] : pts;
  let d = `M${p[0].x},${p[0].y}`;
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] || (close ? p[p.length - 2] : p[i]), p1 = p[i], p2 = p[i + 1], p3 = p[i + 2] || (close ? p[1] : p2);
    d += ` C${(p1.x + (p2.x - p0.x) / 6).toFixed(1)},${(p1.y + (p2.y - p0.y) / 6).toFixed(1)} ${(p2.x - (p3.x - p1.x) / 6).toFixed(1)},${(p2.y - (p3.y - p1.y) / 6).toFixed(1)} ${p2.x},${p2.y}`;
  }
  return close ? d + ' Z' : d;
}
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export function segDist(p, a, b) {
  const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  if (!l2) return dist(p, a);
  let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return dist(p, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
}
export function pointInPoly(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
export const zoneOf = (item) => (item && item.zone === 'isle' ? 'isle' : 'village');

// ---- Linear A (U+10600–U+10736): the sealed script. Astral code points: always use Array.from, never index. ----
export const LA_GLYPHS = Array.from({ length: 0x137 }, (_, i) => String.fromCodePoint(0x10600 + i));
export function laGlyphs(seed, n = 2) {
  let hsh = 2166136261;
  for (const ch of String(seed)) { hsh ^= ch.codePointAt(0); hsh = Math.imul(hsh, 16777619); }
  let out = '';
  for (let i = 0; i < n; i++) { hsh = Math.imul(hsh ^ (hsh >>> 13), 1274126177) >>> 0; out += LA_GLYPHS[hsh % LA_GLYPHS.length]; }
  return out;
}
// Cosmetic "engraving": each Latin letter maps to a fixed Linear A sign; spaces and digits survive.
const LA_MAP = {};
'abcdefghijklmnopqrstuvwxyz'.split('').forEach((c, i) => { LA_MAP[c] = LA_GLYPHS[(i * 11 + 3) % 120]; });
export function toLinearA(text) {
  return Array.from(String(text || '').toLowerCase()).map((c) => LA_MAP[c] || (/[.,;:!?]/.test(c) ? '𐄁' : c)).join('');
}
// Pseudo-random Linear A line (mock ciphertext), words of 2–6 signs.
export function laLine(seed, len = 36) {
  let a = seed >>> 0, out = [];
  while (out.length < len) {
    a = (a * 1664525 + 1013904223) >>> 0;
    const word = 2 + (a % 5);
    for (let i = 0; i < word && out.length < len; i++) { a = (a * 1664525 + 1013904223) >>> 0; out.push(LA_GLYPHS[a % LA_GLYPHS.length]); }
    out.push(' ');
  }
  return out.join('').trim();
}
