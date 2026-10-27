// The Far Isle: open sea east of The Works, a fog band, a rocky island with marker buoys.
import { el, art, mulberry, smoothPath, pointInPoly } from './svg-util.js';

export const SEA_X = 1000;
export const ISLE = {
  bounds: { x: 1150, y: 0, w: 550, h: 760 },
  center: { x: 1425, y: 385 },
  shore: [
    { x: 1185, y: 130 }, { x: 1235, y: 72 }, { x: 1320, y: 42 }, { x: 1420, y: 32 }, { x: 1520, y: 46 }, { x: 1600, y: 72 },
    { x: 1660, y: 125 }, { x: 1690, y: 205 }, { x: 1694, y: 300 }, { x: 1680, y: 400 }, { x: 1692, y: 480 }, { x: 1672, y: 580 },
    { x: 1632, y: 662 }, { x: 1560, y: 722 }, { x: 1460, y: 742 }, { x: 1360, y: 736 }, { x: 1280, y: 720 }, { x: 1212, y: 690 },
    { x: 1170, y: 640 }, { x: 1150, y: 560 }, { x: 1166, y: 470 }, { x: 1150, y: 380 }, { x: 1162, y: 290 }, { x: 1152, y: 205 },
  ],
};
export function isleLandAt(x, y, margin = 0) {
  if (!pointInPoly({ x, y }, ISLE.shore)) return false;
  if (!margin) return true;
  // crude inset: also require the point to be inside when nudged toward the edges
  return [[margin, 0], [-margin, 0], [0, margin], [0, -margin]].every(([dx, dy]) => pointInPoly({ x: x + dx, y: y + dy }, ISLE.shore));
}

export function buildIsle({ ground, mist, lights, defs }) {
  defs.insertAdjacentHTML('beforeend', `
    <linearGradient id="mistGrad" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#e8eef0" stop-opacity="0"/><stop offset=".35" stop-color="#e8eef0" stop-opacity=".62"/><stop offset=".7" stop-color="#e8eef0" stop-opacity=".5"/><stop offset="1" stop-color="#e8eef0" stop-opacity="0"/></linearGradient>
    <radialGradient id="isleGrad" cx=".5" cy=".45" r=".6"><stop offset="0" stop-color="#A9A86E"/><stop offset="1" stop-color="#8E8F5A"/></radialGradient>
    <filter id="blur10" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="10"/></filter>
    <linearGradient id="beamGrad" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#fff2b3" stop-opacity=".55"/><stop offset="1" stop-color="#fff2b3" stop-opacity="0"/></linearGradient>`);

  // --- sea ---
  el('rect', { class: 'sea', x: SEA_X, y: -400, width: 1200, height: 1560 }, ground);
  // sandy mainland shoreline
  el('path', { d: `M${SEA_X},-400 V1160`, class: 'shore-sand', fill: 'none' }, ground);
  const wr = mulberry(31);
  for (let i = 0; i < 70; i++) {
    const x = SEA_X + 25 + wr() * 660, y = wr() * 760;
    if (isleLandAt(x, y, 10)) continue;
    const w = 8 + wr() * 14;
    el('path', { d: `M${x.toFixed(0)},${y.toFixed(0)} q${(w / 2).toFixed(0)},-3 ${w.toFixed(0)},0`, class: 'wave' }, ground);
  }

  // --- island ---
  const d = smoothPath(ISLE.shore, true);
  el('path', { d, class: 'isle-rock', 'stroke-width': 26 }, ground);  // rocky shelf under the shoreline
  el('path', { d, class: 'isle-shore', 'stroke-width': 12 }, ground);
  el('path', { d, fill: 'url(#isleGrad)', stroke: '#5f6f55', 'stroke-width': 1.5 }, ground);
  const rr = mulberry(47);
  for (let i = 0; i < 20; i++) {
    const x = 1180 + rr() * 500, y = 40 + rr() * 700;
    if (!isleLandAt(x, y, 24)) continue;
    el('ellipse', { cx: x.toFixed(0), cy: y.toFixed(0), rx: (18 + rr() * 50).toFixed(0), ry: (8 + rr() * 22).toFixed(0), fill: '#6E6B45', opacity: (0.18 + rr() * 0.22).toFixed(2) }, ground);
  }
  // boulders and cliffs
  for (let i = 0; i < 26; i++) {
    const x = 1160 + rr() * 540, y = 30 + rr() * 720;
    if (!isleLandAt(x, y, 6) || isleLandAt(x, y, 70)) continue; // near the edges only
    const s = 0.7 + rr() * 1.2;
    art(ground, `<path d="M-6,3 L-4,-3 L1,-5 L6,-2 L7,3 Z" fill="#4A4440" stroke="#2E2A28" stroke-width=".8"/><path d="M-4,-2 L1,-4 L5,-1" stroke="#7A716A" stroke-width=".8" fill="none"/>`, { transform: `translate(${x.toFixed(0)},${y.toFixed(0)}) scale(${s.toFixed(2)})` });
  }
  // a few inland rocks and heather tufts
  for (let i = 0; i < 24; i++) {
    const x = 1200 + rr() * 460, y = 60 + rr() * 660;
    if (!isleLandAt(x, y, 40)) continue;
    art(ground, rr() < 0.5
      ? `<circle r="2.2" fill="#C9B778"/><circle cx="3" cy="1" r="1.8" fill="#D9A441"/><circle cx="-3" cy="1.5" r="1.6" fill="#B5A062"/>`
      : `<ellipse rx="4" ry="2.4" fill="#5A524C"/><ellipse cx="-1" cy="-.8" rx="2" ry="1" fill="#7A716A"/>`,
      { transform: `translate(${x.toFixed(0)},${y.toFixed(0)})` });
  }

  // --- marker buoys (a ring around the isle) ---
  const buoyLights = el('g', { class: 'buoy-lights' }, lights);
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2;
    const x = ISLE.center.x + Math.cos(a) * 335, y = ISLE.center.y + Math.sin(a) * 440;
    if (x < 1080 || x > 1700 || y < 14 || y > 748) continue;
    if (isleLandAt(x, y)) continue;
    art(ground, `<ellipse cy="2" rx="4" ry="1.6" fill="#1f3f55" opacity=".5"/><path d="M-3,2 L-2,-4 H2 L3,2 Z" fill="#A4362B"/><rect x="-2" y="-2" width="4" height="1.6" fill="#fff"/><line x1="0" y1="-4" x2="0" y2="-8" stroke="#3b3b3b" stroke-width="1"/><circle cy="-8.5" r="1.2" fill="#444"/>`,
      { transform: `translate(${x.toFixed(0)},${y.toFixed(0)})`, class: 'buoy' });
    const l = el('circle', { class: 'lit buoy-lit', cx: x.toFixed(0), cy: (y - 8.5).toFixed(0), r: 1.4, fill: '#ff6a4a' }, buoyLights);
    l.style.animationDelay = `${(i * 0.37) % 2}s`;
  }

  // --- sea mist between mainland and isle ---
  el('rect', { x: 1010, y: -420, width: 190, height: 1600, fill: 'url(#mistGrad)', filter: 'url(#blur10)', class: 'mist-a' }, mist);
  el('rect', { x: 1040, y: -420, width: 140, height: 1600, fill: 'url(#mistGrad)', filter: 'url(#blur10)', class: 'mist-b' }, mist);

  // --- zone label ---
  const t = el('text', { x: 1425, y: 100, class: 'zone-label', 'text-anchor': 'middle' }, ground);
  t.textContent = 'The Far Isle';
  const t2 = el('text', { x: 1425, y: 116, class: 'zone-sublabel', 'text-anchor': 'middle' }, ground);
  t2.textContent = 'exclusion zone';
}

// Lighthouse illustration (used for a tower-kind place on the isle), plus its sweeping beam for the lights layer.
export const LIGHTHOUSE_ART = {
  labelY: -66,
  art: `<ellipse cy="18" rx="30" ry="9" fill="#8c8a80" opacity=".55"/><path d="M-26,18 L-18,6 L-8,10 L4,4 L16,9 L26,18 Z" fill="#4A4440"/>
    <path d="M-10,16 L-7,-40 H7 L10,16 Z" fill="#F3EEE2"/>
    <path d="M-9.4,8 L-8.9,0 H8.9 L9.4,8 Z" fill="#3E7FA6"/><path d="M-8.4,-10 L-7.9,-18 H7.9 L8.4,-10 Z" fill="#3E7FA6"/><path d="M-7.4,-28 L-7,-36 H7 L7.4,-28 Z" fill="#3E7FA6"/>
    <rect x="-9" y="-44" width="18" height="4" fill="#4a4a50"/><rect x="-6" y="-54" width="12" height="10" fill="#dfe9ee" stroke="#4a4a50" stroke-width="1"/><rect class="win" x="-4" y="-52" width="8" height="6"/>
    <path d="M-8,-54 A8,8 0 0 1 8,-54 Z" fill="#3E7FA6"/><circle cy="-63" r="1.2" fill="#F2C14E"/>
    <rect x="-3" y="4" width="6" height="12" rx="2" fill="#5a4231"/>`,
  lights: `<rect class="lit" x="-4" y="-52" width="8" height="6"/><circle class="glow" cy="-49" r="16"/>
    <g transform="translate(0,-49)"><polygon class="beam" points="0,0 260,-30 260,30" fill="url(#beamGrad)"/></g>`,
};
