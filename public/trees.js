// The shared trees: The Cherry (village) and The Salt Pine (isle). Drawn procedurally and
// deterministically from state: stage sets size, each branch is one bough (seeded by id),
// bloom cohorts are blossom clusters that fade toward fallsAt, fruit and keepsakes hang on boughs.
import { el, art, mulberry, hashStr, zoneOf } from './svg-util.js';

export const STAGE_THRESHOLDS = [0, 12, 30, 60, 120];
export const STAGE_NAMES = ['sapling', 'young tree', 'spreading canopy', 'mature tree', 'ancient tree'];
const STAGE_P = [ // trunk height, trunk width, crown radius, bough length
  { h: 14, w: 2.6, r: 7, b: 9 },
  { h: 24, w: 4, r: 13, b: 15 },
  { h: 36, w: 6.5, r: 21, b: 23 },
  { h: 46, w: 9.5, r: 29, b: 31 },
  { h: 58, w: 14, r: 40, b: 43 },
];
const BARK = '#6b4a2e', BARK_DARK = '#4f3621';
const LEAF = ['#5f8f4f', '#6f9f5a', '#7fae66'];
const PINE = ['#3f6a5c', '#4f7a6a', '#5f8f7a'];
const PINK = ['#f6b7c8', '#f28ba6', '#fde0e8', '#f5a2b8'];
const SEAGLOW = ['#bfeadb', '#d8f5ea', '#a9ded0'];

export const treeKey = (t) => zoneOf(t);
export function isPine(t) { return t.species === 'pine' || (t.species !== 'cherry' && zoneOf(t) === 'isle'); }
export function stageOf(t) { return Math.max(0, Math.min(4, Math.floor(+t.stage || 0))); }
export function stageProgress(t) {
  const s = stageOf(t);
  const from = STAGE_THRESHOLDS[s];
  const to = Number.isFinite(+t.nextStageAt) ? +t.nextStageAt : (STAGE_THRESHOLDS[s + 1] ?? from);
  const c = Math.max(0, +t.lifetimeCredits || 0);
  if (to <= from) return 1;
  return Math.max(0, Math.min(1, (c - from) / (to - from)));
}
function fade(cohort, now) {
  const o = +cohort.opensAt || 0, f = +cohort.fallsAt || 0;
  if (!f || f <= o) return 1;
  return Math.max(0.12, Math.min(1, (f - now) / (f - o)));
}
export function treeSignature(t, now) {
  const b = (Array.isArray(t.branches) ? t.branches : []).map((x) => [x.id, x.credits, !!x.fruit, !!x.keepsake]);
  const c = (Array.isArray(t.blooms) ? t.blooms : []).map((x) => [x.branchId, x.count, x.opensAt, x.fallsAt]);
  return JSON.stringify([stageOf(t), isPine(t), t.blossoms, b, c, Math.floor(now / 60000)]);
}

function layout(t) {
  const stage = stageOf(t), P = STAGE_P[stage], pine = isPine(t);
  const rnd = mulberry(hashStr(`${zoneOf(t)}:${t.species || ''}`));
  const lean = pine ? P.h * 0.32 : 0;
  const top = { x: lean, y: -P.h };
  const branches = (Array.isArray(t.branches) ? t.branches : []).filter((b) => b && b.id).slice(0, 24);
  const boughs = branches.map((b, i) => {
    const br = mulberry(hashStr(b.id));
    const k = Math.floor(i / 2), side = i % 2 === 0 ? -1 : 1;
    let spread = 24 + (k % 5) * 20 + br() * 10;
    if (pine) spread = side < 0 ? 62 + (k % 4) * 9 + br() * 6 : 30 + (k % 5) * 13 + br() * 8;
    const ang = (-90 + side * spread) * (Math.PI / 180);
    const credits = Math.max(0, +b.credits || 0);
    const strength = 0.5 + 0.5 * Math.min(1, credits / 15);
    const len = P.b * (0.55 + 0.45 * strength) * (pine && side < 0 ? 0.5 : 1) * (0.9 + br() * 0.2);
    const frac = 0.42 + 0.5 * Math.min(1, i / 8);
    const start = { x: lean * frac * 0.9, y: -P.h * frac };
    const end = { x: start.x + Math.cos(ang) * len, y: start.y + Math.sin(ang) * len };
    const mx = (start.x + end.x) / 2, my = (start.y + end.y) / 2;
    const nx = -(end.y - start.y) / len, ny = (end.x - start.x) / len;
    const bend = (br() - 0.5) * len * 0.5;
    const ctrl = { x: mx + nx * bend, y: my + ny * bend - len * 0.12 };
    const width = Math.max(1, P.w * 0.32 * strength);
    return { b, i, side, start, end, ctrl, len, width, credits, rnd: br, strength };
  });
  return { stage, P, pine, top, lean, boughs, rnd };
}
const f1 = (n) => (+n).toFixed(1);
const q = (a, c, b) => `M${f1(a.x)},${f1(a.y)} Q${f1(c.x)},${f1(c.y)} ${f1(b.x)},${f1(b.y)}`;
const along = (bo, tt) => ({ // point along a quadratic bough
  x: (1 - tt) ** 2 * bo.start.x + 2 * (1 - tt) * tt * bo.ctrl.x + tt * tt * bo.end.x,
  y: (1 - tt) ** 2 * bo.start.y + 2 * (1 - tt) * tt * bo.ctrl.y + tt * tt * bo.end.y,
});

export function createTree(t) {
  const g = el('g', { class: 'shared-tree', 'data-zone': zoneOf(t) });
  g._shadow = el('ellipse', { class: 'shadow', cy: 4, rx: 10, ry: 4 }, g);
  g._sway = el('g', { class: 'sway' }, g);
  g._petals = el('g', { class: 'petals' }, g);
  g._hit = el('circle', { class: 'tree-hit', r: 20, cy: -10, fill: 'transparent' }, g);
  return g;
}

// Rebuild the illustration. `lights` is this tree's group in the lights layer.
export function drawTree(g, lights, t, now) {
  const L = layout(t);
  const { stage, P, pine, top, lean, boughs, rnd } = L;
  const sway = g._sway;
  sway.textContent = '';
  lights.textContent = '';
  sway.style.animationDuration = `${5 + stage * 1.6}s`;
  g._shadow.setAttribute('rx', (P.r * 0.9 + 6).toFixed(1));
  g._shadow.setAttribute('ry', (P.r * 0.3 + 3).toFixed(1));
  g._hit.setAttribute('r', (P.r + 10).toFixed(1));
  g._hit.setAttribute('cy', (-P.h * 0.6).toFixed(1));
  g._layout = L;

  const w = P.w, h = P.h;
  const gn = stage >= 3 ? 1 : stage >= 2 ? 0.5 : 0.2;
  const s1 = (rnd() - 0.5) * 2, s2 = (rnd() - 0.5) * 2;
  // roots
  if (stage >= 2) {
    art(sway, `<path d="M${f1(-w / 2)},1 q-4,0 ${f1(-w * 0.6 - 4)},3 M${f1(w / 2)},1 q4,0 ${f1(w * 0.6 + 4)},3 M${f1(-w * 0.2)},2 q-1,2 ${f1(-w * 0.3)},4" stroke="${BARK}" stroke-width="${f1(1 + stage * 0.6)}" fill="none" stroke-linecap="round"/>`);
  }
  // trunk
  const trunk = `M${f1(-w / 2)},2 C${f1(-w * 0.55 + lean * 0.1)},${f1(-h * 0.35)} ${f1(-w * (0.3 + 0.3 * gn * s1) + lean * 0.5)},${f1(-h * 0.65)} ${f1(lean - w * 0.22)},${f1(-h)} L${f1(lean + w * 0.22)},${f1(-h)} C${f1(w * (0.3 + 0.3 * gn * s2) + lean * 0.5)},${f1(-h * 0.65)} ${f1(w * 0.55 + lean * 0.1)},${f1(-h * 0.35)} ${f1(w / 2)},2 Z`;
  art(sway, `<path d="${trunk}" fill="${BARK}" stroke="${BARK_DARK}" stroke-width="${stage >= 2 ? 1 : 0.6}" stroke-linejoin="round"/>`);
  if (stage >= 2) art(sway, `<path d="M${f1(-w * 0.15)},0 C${f1(-w * 0.2)},${f1(-h * 0.3)} ${f1(-w * 0.05 + lean * 0.4)},${f1(-h * 0.5)} ${f1(lean * 0.7 - w * 0.05)},${f1(-h * 0.8)}" stroke="${BARK_DARK}" stroke-width=".8" fill="none" opacity=".6"/>`);
  // boughs
  for (const bo of boughs) {
    art(sway, `<path d="${q(bo.start, bo.ctrl, bo.end)}" stroke="${BARK}" stroke-width="${f1(bo.width)}" fill="none" stroke-linecap="round"/>`);
  }
  // foliage
  const blobs = [];
  const crownN = pine ? 0 : 3 + stage;
  for (let j = 0; j < crownN; j++) {
    const a = (j / crownN) * Math.PI * 2 + rnd() * 0.6;
    const rr = P.r * (0.25 + rnd() * 0.3);
    blobs.push({ x: top.x + Math.cos(a) * rr, y: top.y - P.r * 0.2 + Math.sin(a) * rr * 0.7, r: P.r * (0.45 + rnd() * 0.3), c: LEAF[j % 3] });
  }
  if (!pine) {
    if (stage === 0) blobs.push({ x: top.x, y: top.y - 3, r: P.r, c: LEAF[1] }, { x: top.x - 3, y: top.y - 5, r: P.r * 0.7, c: LEAF[2] });
    for (const bo of boughs) {
      blobs.push({ x: bo.end.x, y: bo.end.y - 2, r: Math.max(4, P.r * 0.32) * (0.8 + 0.3 * bo.strength), c: LEAF[(bo.i + 1) % 3] });
      const m = along(bo, 0.65);
      blobs.push({ x: m.x, y: m.y - 2, r: Math.max(3, P.r * 0.24), c: LEAF[bo.i % 3] });
    }
    blobs.sort((a, b) => (a.c === LEAF[0] ? -1 : 1) - (b.c === LEAF[0] ? -1 : 1));
    art(sway, blobs.map((b) => `<circle cx="${f1(b.x)}" cy="${f1(b.y)}" r="${f1(b.r)}" fill="${b.c}"/>`).join(''));
  } else {
    // windswept pine tufts: triangles along boughs and a crown spike, leaning east
    const tuft = (x, y, s, c) => `<path d="M${f1(x - s)},${f1(y + s * 0.5)} L${f1(x + s * 0.35)},${f1(y - s * 1.1)} L${f1(x + s * 1.1)},${f1(y + s * 0.5)} Z" fill="${c}"/>`;
    let m = '';
    const cs = Math.max(5, P.r * 0.55);
    m += tuft(top.x, top.y + cs * 0.2, cs, PINE[0]) + tuft(top.x + 2, top.y - cs * 0.3, cs * 0.75, PINE[1]) + tuft(top.x + 3, top.y - cs * 0.7, cs * 0.5, PINE[2]);
    for (const bo of boughs) {
      const n = bo.len > 20 ? 3 : 2;
      for (let k = 1; k <= n; k++) {
        const p = along(bo, k / n);
        m += tuft(p.x, p.y, Math.max(3.5, P.r * 0.22) * (0.8 + 0.4 * bo.strength) * (k === n ? 1.15 : 0.9), PINE[(bo.i + k) % 3]);
      }
    }
    art(sway, m);
  }
  // blossoms (cohorts)
  const cohorts = (Array.isArray(t.blooms) ? t.blooms : []).filter((c) => c && +c.count > 0);
  const totalOpen = Math.max(0, +t.blossoms || 0);
  let placed = 0;
  const bloomMarkup = [];
  const glowMarkup = [];
  const cluster = (cx, cy, n, spread, op, seedStr) => {
    const r2 = mulberry(hashStr(seedStr));
    let s = '';
    for (let k = 0; k < n; k++) {
      const a = r2() * Math.PI * 2, d = Math.sqrt(r2()) * spread;
      const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d * 0.75;
      const col = (pine ? SEAGLOW : PINK)[k % 3];
      s += `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(1.3 + r2() * 1.1)}" fill="${col}" opacity="${f1(op)}"/>`;
      if (pine && k % 3 === 0) glowMarkup.push(`<circle class="lit" cx="${f1(x)}" cy="${f1(y)}" r="${f1(3.5)}" fill="#bfeadb" fill-opacity="${f1(op * 0.35)}"/>`);
    }
    return s;
  };
  for (const c of cohorts) {
    const bo = boughs.find((x) => x.b.id === c.branchId);
    const n = Math.min(22, Math.ceil(+c.count));
    const op = fade(c, now);
    const cx = bo ? bo.end.x : top.x, cy = bo ? bo.end.y - 2 : top.y - P.r * 0.3;
    bloomMarkup.push(cluster(cx, cy, n, bo ? Math.max(5, P.r * 0.38) : P.r * 0.6, op, `${c.branchId}|${c.opensAt}`));
    placed += n;
  }
  if (totalOpen > placed) bloomMarkup.push(cluster(top.x, top.y - P.r * 0.25, Math.min(22, totalOpen - placed), P.r * 0.6, 1, 'crown'));
  art(sway, bloomMarkup.join(''), { class: 'blooms' });
  // fruit & keepsakes
  let extras = '';
  for (const bo of boughs) {
    if (bo.b.fruit) {
      const p = along(bo, 0.85);
      extras += pine
        ? `<ellipse cx="${f1(p.x + 1)}" cy="${f1(p.y + 4)}" rx="1.6" ry="2.4" fill="#8a6a4a"/><ellipse cx="${f1(p.x - 2.5)}" cy="${f1(p.y + 3)}" rx="1.4" ry="2.1" fill="#7a5a3b"/>`
        : `<line x1="${f1(p.x)}" y1="${f1(p.y)}" x2="${f1(p.x + 1)}" y2="${f1(p.y + 4)}" stroke="${BARK_DARK}" stroke-width=".6"/><circle cx="${f1(p.x + 1.2)}" cy="${f1(p.y + 5)}" r="1.7" fill="#c9344a"/><circle cx="${f1(p.x - 1.8)}" cy="${f1(p.y + 4)}" r="1.5" fill="#d9465c"/><circle cx="${f1(p.x + 0.6)}" cy="${f1(p.y + 4.3)}" r=".5" fill="#fff" opacity=".7"/>`;
    }
    if (bo.b.keepsake) {
      const p = along(bo, 0.5);
      extras += `<line x1="${f1(p.x)}" y1="${f1(p.y)}" x2="${f1(p.x)}" y2="${f1(p.y + 6)}" stroke="#8a6a4a" stroke-width=".7"/><path d="M${f1(p.x)},${f1(p.y + 5)} l2.6,2.6 l-2.6,2.6 l-2.6,-2.6 z" fill="#f0c05a" stroke="#8a6a4a" stroke-width=".6"/><circle cx="${f1(p.x)}" cy="${f1(p.y + 7.6)}" r=".7" fill="#fff" opacity=".8"/>`;
    }
  }
  if (extras) art(sway, extras, { class: 'tree-extras' });
  // night lights: soft glow under the canopy, little lanterns on the lowest boughs, ground lanterns
  let lm = `<circle class="glow" cx="${f1(top.x)}" cy="${f1(-h * 0.45)}" r="${f1(P.r + 10)}" fill-opacity=".7"/>`;
  if (stage >= 1) {
    for (const bo of boughs.slice(0, 2)) {
      const p = along(bo, 0.6);
      lm += `<line x1="${f1(p.x)}" y1="${f1(p.y)}" x2="${f1(p.x)}" y2="${f1(p.y + 5)}" stroke="#5a4231" stroke-width=".6"/><rect class="lit" x="${f1(p.x - 1.6)}" y="${f1(p.y + 5)}" width="3.2" height="4.2" rx="1"/><circle class="glow" cx="${f1(p.x)}" cy="${f1(p.y + 7)}" r="8"/>`;
    }
  }
  if (stage >= 2) {
    for (const sx of [-1, 1]) {
      const x = sx * (P.r * 0.75 + 4);
      lm += `<rect class="lit" x="${f1(x - 2)}" y="-6" width="4" height="5" rx="1"/><circle class="glow" cx="${f1(x)}" cy="-4" r="11"/>`;
    }
  }
  lights.innerHTML = lm;
  // ground lantern posts (visible by day too) for stage >= 2
  if (stage >= 2) {
    for (const sx of [-1, 1]) {
      const x = sx * (P.r * 0.75 + 4);
      art(g, `<rect x="${f1(x - 0.8)}" y="-1" width="1.6" height="4" fill="#4a3a2a"/><rect x="${f1(x - 2.2)}" y="-6" width="4.4" height="5.2" rx="1" class="lamp-head"/>`, { class: 'tree-post' });
    }
  }
  for (const old of g.querySelectorAll('.tree-post')) if (stage < 2) old.remove();
}

// Drifting petals (or pale pine-light motes). Called every frame for each tree record.
export function tickPetals(rec, dt, time) {
  const g = rec.el, L = g._layout;
  if (!L) return;
  const t = rec.data || {};
  const open = Math.max(0, +t.blossoms || 0);
  rec.petals = rec.petals || [];
  const maxAlive = open > 0 ? 3 + L.stage * 3 : 0;
  if (open > 0 && rec.petals.length < maxAlive && Math.random() < Math.min(1, open / 30) * (dt / 1400)) {
    const pine = L.pine;
    const p = {
      x: L.top.x + (Math.random() - 0.5) * L.P.r * 1.4, y: L.top.y - Math.random() * L.P.r * 0.5,
      vx: (pine ? 4 : 7) + Math.random() * 8, vy: (pine ? 3 : 7) + Math.random() * 6, ph: Math.random() * 6.28, life: 0, ttl: 3.5 + Math.random() * 2.5,
      el: el('ellipse', { rx: pine ? 1.2 : 2, ry: pine ? 1.2 : 1.2, fill: (pine ? SEAGLOW : PINK)[Math.floor(Math.random() * 3)], opacity: 0.95 }, g._petals),
    };
    rec.petals.push(p);
  }
  const ds = dt / 1000;
  for (let i = rec.petals.length - 1; i >= 0; i--) {
    const p = rec.petals[i];
    p.life += ds;
    if (p.life > p.ttl) { p.el.remove(); rec.petals.splice(i, 1); continue; }
    p.x += (p.vx + Math.sin(time * 2.2 + p.ph) * 7) * ds;
    p.y += (p.vy + Math.cos(time * 1.7 + p.ph) * 3) * ds;
    const op = Math.min(1, (p.ttl - p.life) / 1.2) * 0.95;
    p.el.setAttribute('transform', `translate(${p.x.toFixed(1)},${p.y.toFixed(1)}) rotate(${((time * 120 + p.ph * 50) % 360).toFixed(0)})`);
    p.el.setAttribute('opacity', op.toFixed(2));
  }
}
