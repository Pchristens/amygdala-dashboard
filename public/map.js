// Amygdala map — Aegean-pastoral, two registers (see ART.md): a Cycladic/Minoan village of lime-wash and
// terracotta west of the river; marble Doric divine sites (Temple, Great Library, Forge, Quarry) on the east bank;
// The Far Isle beyond the strait. One SVG in world units (village 0–1000 × 760, isle out to 1700); zoom/pan;
// entities diffed by id and lerped in a requestAnimationFrame loop.
import { el, art, mulberry, hexMix, safeColor, smoothPath, dist, segDist, zoneOf, laGlyphs } from './svg-util.js';
import { buildIsle, isleLandAt, LIGHTHOUSE_ART, ISLE, SEA_X } from './isle.js';
import { createTree, drawTree, treeKey, treeSignature, tickPetals } from './trees.js';

export { safeColor };
export const WORLD = { w: 1000, h: 760 };
const VILLAGE = { x: 0, y: 0, w: 1000, h: 760 };

// ---------- palette (ART.md) ----------
const C = {
  lime: '#F3EEE2', plaster: '#E8D9B5', terracotta: '#C2603F', red: '#A4362B', ochre: '#D9A441', gold: '#F2C14E',
  blue: '#3E7FA6', shallows: '#7FB7CF', olive: '#9DAA6B', oliveDark: '#5F7142', cypress: '#3C5A3E', dry: '#C9B778',
  marble: '#EDE8DC', marbleShadow: '#B9B2A0', ink: '#3B2F26', wood: '#8A6A4A', woodDark: '#5A4231', stone: '#8F8676',
};

// ---------- Illustration library (all static strings) ----------
// Oil lamp on a short post: clay bowl, small flame, glow (glow lives in the lights layer via lampLight).
const lamp = (x, y, r = 13) =>
  `<g transform="translate(${x},${y})"><rect x="-1" y="-13" width="2" height="15" fill="${C.woodDark}"/><path d="M-4,-13 h8 l-1.5,3 h-5 z" class="lamp-head"/><path class="flame" d="M0,-14 q-1.6,-2.5 0,-5 q1.6,2.5 0,5 z" fill="${C.gold}"/><circle class="lamp-glow" cy="-15" r="${r}"/></g>`;
const lampLight = (x, y, r = 14) =>
  `<g transform="translate(${x},${y})"><circle class="glow" cy="-15" r="${r}"/><path class="lit" d="M-4,-13 h8 l-1.5,3 h-5 z"/></g>`;
const brazier = (x, y) =>
  `<g transform="translate(${x},${y})"><rect x="-3" y="-6" width="6" height="8" fill="${C.marbleShadow}"/><path d="M-6,-6 h12 l-2,-4 h-8 z" fill="${C.stone}"/><path class="flame" d="M0,-10 q-3,-4 0,-9 q3,5 0,9 z" fill="${C.gold}"/></g>`;
const brazierLight = (x, y) => `<g transform="translate(${x},${y - 10})"><circle class="glow" r="16"/><circle class="lit" r="2.5" fill="#ffb347"/></g>`;
const win = (x, y, w, h, rx = 1) => `<rect class="win" x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}"/>`;
const winLit = (x, y, w, h, rx = 1) =>
  `<rect class="lit" x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}"/><rect class="glow" x="${x - 4}" y="${y - 3}" width="${w + 8}" height="${h + 8}" rx="6"/>`;
// Minoan column: tapers downward, red shaft, dark capital.
const minoanCol = (x, y, h) => `<path d="M${x - 2.2},${y} L${x - 3},${y - h} H${x + 3} L${x + 2.2},${y} Z" fill="${C.red}"/><rect x="${x - 3.6}" y="${y - h - 2}" width="7.2" height="2.4" fill="${C.ink}" opacity=".8"/>`;
// Doric column: plain marble bar with a slab capital.
const doricCol = (x, y, h, w = 6) => `<rect x="${x - w / 2}" y="${y - h}" width="${w}" height="${h}" fill="${C.marble}"/><rect x="${x - w / 2 - 1}" y="${y - h - 2.5}" width="${w + 2}" height="2.5" fill="${C.marbleShadow}"/>`;
const amphora = (x, y, s = 1) => `<g transform="translate(${x},${y}) scale(${s})"><path d="M-2.5,-9 h5 l1,2 l-0.5,7 q-0.5,3 -3,3 q-2.5,0 -3,-3 l-0.5,-7 z" fill="${C.terracotta}"/><rect x="-3" y="-10" width="6" height="1.5" fill="${C.ink}" opacity=".6"/></g>`;
const blueShutter = (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${C.blue}"/><line x1="${x + w / 2}" y1="${y}" x2="${x + w / 2}" y2="${y + h}" stroke="${C.ink}" stroke-opacity=".35" stroke-width=".8"/>`;
const bougainvillea = (x, y) => `<circle cx="${x}" cy="${y}" r="2.2" fill="#D9627A"/><circle cx="${x + 3}" cy="${y - 1.5}" r="1.8" fill="#E88AA5"/><circle cx="${x - 2.5}" cy="${y - 2}" r="1.6" fill="#C94C6B"/>`;

const PLACE_ART = {
  plaza: { // pebble-mosaic ring; the zone's shared tree stands in the middle
    labelY: 50,
    art: `<ellipse rx="56" ry="37" fill="${C.plaster}"/><ellipse rx="48" ry="30" fill="${C.dry}" opacity=".8"/>
      <ellipse rx="40" ry="24" fill="none" stroke="${C.blue}" stroke-width="1.2" stroke-dasharray="1.5 2.6" opacity=".8"/>
      <ellipse rx="30" ry="18" fill="none" stroke="${C.marbleShadow}" stroke-width="1.2" stroke-dasharray="1.5 2.6"/>
      <circle r="15" fill="${C.marbleShadow}"/><circle r="12" fill="${C.wood}" opacity=".55"/>
      <rect x="-44" y="-4" width="12" height="4" fill="${C.wood}"/><rect x="32" y="-4" width="12" height="4" fill="${C.wood}"/><rect x="-6" y="26" width="12" height="4" fill="${C.wood}"/>
      ${amphora(-50, 14, 0.9)}${amphora(50, 14, 0.9)}${lamp(-34, 26)}${lamp(34, 26)}`,
    lights: `${lampLight(-34, 26)}${lampLight(34, 26)}`,
  },
  library: { // peristyle archive: lime block behind a row of Minoan columns
    labelY: -40,
    art: `<rect x="-36" y="-10" width="72" height="32" fill="${C.lime}"/><rect x="-38" y="-14" width="76" height="5" fill="${C.terracotta}"/>
      <rect x="-40" y="22" width="80" height="2.5" fill="${C.ink}" opacity=".55"/>
      ${minoanCol(-28, 22, 28)}${minoanCol(-9, 22, 28)}${minoanCol(9, 22, 28)}${minoanCol(28, 22, 28)}
      <rect x="-40" y="-9" width="80" height="2" fill="${C.marbleShadow}"/>
      ${win(-22, -4, 7, 9)}${win(15, -4, 7, 9)}<rect x="-5" y="4" width="10" height="18" fill="${C.red}"/>
      ${amphora(-44, 18)}<circle cx="-19" cy="-7" r="1.2" fill="${C.ink}" opacity=".3"/>`,
    lights: `${winLit(-22, -4, 7, 9)}${winLit(15, -4, 7, 9)}`,
  },
  garden: { // walled sun garden: low lime wall, olives and flowers inside, blue gate
    labelY: -30,
    art: `<rect x="-34" y="-18" width="68" height="40" rx="3" fill="${C.dry}"/><rect x="-34" y="-18" width="68" height="40" rx="3" fill="none" stroke="${C.lime}" stroke-width="5"/>
      <rect x="-34" y="-18" width="68" height="40" rx="3" fill="none" stroke="${C.marbleShadow}" stroke-width="1"/>
      <circle cx="-18" cy="-4" r="7" fill="#7F8F5F"/><circle cx="-21" cy="-7" r="4.5" fill="#9DAA6B"/><rect x="-19" y="2" width="2" height="5" fill="${C.wood}"/>
      <circle cx="14" cy="-2" r="8" fill="#7F8F5F"/><circle cx="11" cy="-5" r="5" fill="#9DAA6B"/><rect x="13" y="5" width="2" height="5" fill="${C.wood}"/>
      <g fill="${C.oliveDark}"><rect x="-28" y="10" width="56" height="2"/><rect x="-28" y="15" width="56" height="2"/></g>
      <circle cx="-24" cy="10" r="1.8" fill="#E88AA5"/><circle cx="-12" cy="15" r="1.8" fill="${C.ochre}"/><circle cx="0" cy="10" r="1.8" fill="#fff"/><circle cx="12" cy="15" r="1.8" fill="#E88AA5"/><circle cx="24" cy="10" r="1.8" fill="${C.ochre}"/>
      <rect x="-5" y="19" width="10" height="6" fill="${C.blue}"/>${amphora(30, 18, 0.8)}`,
    lights: `${lampLight(-30, 22, 10)}`,
  },
  workshop: { // resident-built: lime shed, terracotta roof, red door
    labelY: -30,
    art: `<rect x="-26" y="-6" width="52" height="26" fill="${C.lime}"/><polygon points="-29,-6 0,-22 29,-6" fill="${C.terracotta}"/>
      <rect x="-8" y="4" width="16" height="16" fill="${C.red}"/>${win(14, 1, 7, 7)}${win(-21, 1, 7, 7)}
      <path d="M-36,22 l4,-9 l4,9" stroke="${C.wood}" stroke-width="1.5" fill="none"/><rect x="-36" y="13" width="8" height="2" fill="${C.wood}"/>${amphora(32, 16, 0.8)}`,
    lights: `${winLit(14, 1, 7, 7)}${winLit(-21, 1, 7, 7)}`,
  },
  observatory: { // blue-domed observatory on the hill
    labelY: -34,
    art: `<ellipse cy="20" rx="50" ry="16" fill="#AEB57A"/><ellipse cy="19" rx="36" ry="10" fill="${C.dry}" opacity=".7"/>
      <rect x="-18" y="-6" width="36" height="26" rx="2" fill="${C.lime}"/>
      <path d="M-20,-6 A20,20 0 0 1 20,-6 Z" fill="${C.blue}"/><path d="M-20,-6 A20,20 0 0 1 20,-6" fill="none" stroke="${C.lime}" stroke-width="1.2"/>
      <path d="M-3,-25 L3,-25 L5,-6 L-5,-6 Z" fill="${C.ink}" opacity=".85"/>
      <line x1="0" y1="-18" x2="13" y2="-34" stroke="${C.ochre}" stroke-width="2.5" stroke-linecap="round"/>
      <rect x="-5" y="8" width="10" height="12" fill="${C.red}"/>${win(8, 2, 6, 6)}${win(-14, 2, 6, 6)}`,
    lights: `${winLit(8, 2, 6, 6)}${winLit(-14, 2, 6, 6)}<rect class="lit" x="-3" y="-25" width="6" height="19" fill-opacity=".35"/>`,
  },
  studio: { // The Loft: lime block, one big blue shutter, easel
    labelY: -36,
    art: `<rect x="-30" y="-8" width="60" height="28" fill="${C.lime}"/><rect x="-32" y="-12" width="64" height="5" fill="${C.terracotta}"/>
      <rect x="-24" y="-28" width="26" height="18" fill="${C.plaster}"/><rect x="-26" y="-30" width="30" height="3" fill="${C.terracotta}"/>${blueShutter(-20, -24, 18, 12)}
      <rect x="-6" y="6" width="12" height="14" fill="${C.red}"/>${win(14, 0, 10, 9)}${blueShutter(8, 0, 4, 9)}
      <path d="M36,22 l6,-22 l6,22 M37,12 h10" stroke="${C.wood}" stroke-width="1.5" fill="none"/><rect x="37" y="2" width="10" height="9" fill="${C.lime}"/><rect x="39" y="4" width="6" height="5" fill="${C.blue}"/>
      <circle cx="-38" cy="16" r="3" fill="${C.blue}"/><circle cx="-33" cy="20" r="2" fill="${C.ochre}"/><circle cx="-40" cy="22" r="2" fill="${C.red}"/>`,
    lights: `${winLit(-20, -24, 18, 12)}${winLit(14, 0, 10, 9)}`,
  },
  market: { // stoa: colonnade of Minoan columns under a flat terracotta roof; stalls beneath
    labelY: -30,
    art: `<ellipse cy="12" rx="52" ry="12" fill="${C.plaster}" opacity=".7"/>
      <rect x="-50" y="-24" width="100" height="6" fill="${C.terracotta}"/><rect x="-48" y="-18" width="96" height="2" fill="${C.marbleShadow}"/>
      ${minoanCol(-42, 10, 26)}${minoanCol(-21, 10, 26)}${minoanCol(0, 10, 26)}${minoanCol(21, 10, 26)}${minoanCol(42, 10, 26)}
      <rect x="-50" y="10" width="100" height="2.5" fill="${C.ink}" opacity=".55"/>
      <g><rect x="-36" y="-2" width="22" height="9" fill="${C.wood}"/><circle cx="-31" cy="-4" r="2" fill="#7a4f8a"/><circle cx="-25" cy="-4" r="2" fill="${C.red}"/><circle cx="-19" cy="-4" r="2" fill="${C.ochre}"/></g>
      <g><rect x="-10" y="-2" width="22" height="9" fill="${C.wood}"/><circle cx="-5" cy="-4" r="2" fill="${C.oliveDark}"/><circle cx="1" cy="-4" r="2" fill="${C.ochre}"/><circle cx="7" cy="-4" r="2" fill="#D9627A"/></g>
      <g><rect x="16" y="-2" width="22" height="9" fill="${C.wood}"/><rect x="18" y="-6" width="18" height="4" fill="${C.plaster}"/></g>
      ${amphora(-52, 8, 0.9)}${amphora(52, 8, 0.9)}`,
    lights: `${lampLight(-52, 12, 11)}${lampLight(52, 12, 11)}`,
  },
  pier: {
    labelY: -16,
    art: `<rect x="-12" y="-6" width="64" height="12" fill="${C.wood}"/>
      <g stroke="${C.woodDark}" stroke-width="1"><line x1="-4" y1="-6" x2="-4" y2="6"/><line x1="4" y1="-6" x2="4" y2="6"/><line x1="12" y1="-6" x2="12" y2="6"/><line x1="20" y1="-6" x2="20" y2="6"/><line x1="28" y1="-6" x2="28" y2="6"/><line x1="36" y1="-6" x2="36" y2="6"/><line x1="44" y1="-6" x2="44" y2="6"/></g>
      <rect x="48" y="-9" width="3" height="18" fill="${C.woodDark}"/><rect x="18" y="-9" width="3" height="18" fill="${C.woodDark}"/>
      <ellipse cx="58" cy="18" rx="12" ry="5" fill="${C.blue}"/><ellipse cx="58" cy="17" rx="9" ry="3" fill="${C.lime}"/><rect x="57" y="4" width="1.5" height="13" fill="${C.woodDark}"/>
      ${lamp(49, -8, 11)}`,
    lights: `${lampLight(49, -8, 12)}`,
  },
  house: { // lime cube, flat roof, blue door, amphora, bougainvillea
    labelY: -30,
    art: `<rect x="-24" y="-12" width="48" height="32" fill="${C.lime}"/><rect x="-26" y="-16" width="52" height="5" fill="${C.terracotta}"/>
      <rect x="-24" y="-11" width="48" height="1.5" fill="${C.marbleShadow}"/>
      <rect x="-5" y="6" width="10" height="14" fill="${C.blue}"/>${win(-19, -2, 8, 8)}${win(11, -2, 8, 8)}${blueShutter(-21, -2, 2, 8)}${blueShutter(19, -2, 2, 8)}
      ${bougainvillea(16, 12)}${bougainvillea(-14, 14)}${amphora(28, 16, 0.9)}`,
    lights: `${winLit(-19, -2, 8, 8)}${winLit(11, -2, 8, 8)}`,
  },
  tower: { // bell tower with a blue dome
    labelY: -58,
    art: `<rect x="-10" y="-30" width="20" height="50" fill="${C.lime}"/><path d="M-12,-30 A12,12 0 0 1 12,-30 Z" fill="${C.blue}"/>
      <rect x="-12" y="-31" width="24" height="2" fill="${C.marbleShadow}"/>
      <rect x="-5" y="-27" width="10" height="11" rx="5" fill="${C.ink}" opacity=".85"/><path d="M-3,-20 q3,-8 6,0 z" fill="${C.gold}"/>
      ${win(-3, -8, 6, 8, 3)}<rect x="-4" y="10" width="8" height="10" fill="${C.red}"/>
      <circle cx="0" cy="-44" r="1.4" fill="${C.gold}"/>`,
    lights: `${winLit(-3, -8, 6, 8, 3)}<rect class="lit" x="-5" y="-27" width="10" height="11" rx="5" fill-opacity=".5"/>`,
  },
  lighthouse: LIGHTHOUSE_ART,
  shrine: { // omphalos + herm + offering bowl, a cypress beside
    labelY: -26,
    art: `<ellipse cy="18" rx="22" ry="7" fill="${C.plaster}" opacity=".7"/>
      <path d="M-7,14 q0,-18 7,-18 q7,0 7,18 z" fill="${C.marbleShadow}"/><path d="M-5,10 q0,-12 5,-12 q5,0 5,12" fill="none" stroke="${C.marble}" stroke-width="1.5" stroke-dasharray="2 2"/>
      <rect x="14" y="-6" width="5" height="20" fill="${C.marble}"/><circle cx="16.5" cy="-9" r="3.5" fill="${C.marble}"/><rect x="12" y="-2" width="9" height="1.5" fill="${C.marbleShadow}"/>
      <ellipse cx="-20" cy="14" rx="7" ry="2.6" fill="${C.terracotta}"/><ellipse cx="-20" cy="13" rx="5" ry="1.6" fill="${C.ochre}"/>
      <polygon points="-36,20 -31,-10 -26,20" fill="${C.cypress}"/><polygon points="-34,14 -31,-6 -28,14" fill="#4E6B48"/>
      ${lamp(26, 16, 10)}`,
    lights: `${lampLight(26, 16, 10)}`,
  },
  cafe: { // vine pergola café: posts and beam with vine leaves, tables, lime back wall
    labelY: -32,
    art: `<rect x="-28" y="-14" width="56" height="24" fill="${C.lime}"/><rect x="-30" y="-18" width="60" height="5" fill="${C.terracotta}"/>
      <rect x="-6" y="-2" width="12" height="12" fill="${C.red}"/>${win(-22, -8, 9, 8)}${win(13, -8, 9, 8)}
      <g stroke="${C.wood}" stroke-width="2"><line x1="-32" y1="24" x2="-32" y2="4"/><line x1="32" y1="24" x2="32" y2="4"/><line x1="-34" y1="4" x2="34" y2="4"/></g>
      <g stroke="${C.wood}" stroke-width="1"><line x1="-24" y1="4" x2="-24" y2="10"/><line x1="-8" y1="4" x2="-8" y2="10"/><line x1="8" y1="4" x2="8" y2="10"/><line x1="24" y1="4" x2="24" y2="10"/></g>
      <g fill="${C.oliveDark}"><circle cx="-28" cy="3" r="3"/><circle cx="-16" cy="2" r="3.5"/><circle cx="-2" cy="3" r="3"/><circle cx="12" cy="2" r="3.5"/><circle cx="26" cy="3" r="3"/></g>
      <g fill="#7F8F5F"><circle cx="-22" cy="1" r="2.4"/><circle cx="-8" cy="1" r="2.4"/><circle cx="6" cy="1" r="2.4"/><circle cx="20" cy="1" r="2.4"/></g>
      <circle cx="-20" cy="18" r="5" fill="${C.plaster}"/><circle cx="-20" cy="18" r="1.6" fill="${C.wood}"/><circle cx="20" cy="18" r="5" fill="${C.plaster}"/><circle cx="20" cy="18" r="1.6" fill="${C.wood}"/>
      ${amphora(38, 20, 0.9)}`,
    lights: `${winLit(-22, -8, 9, 8)}${winLit(13, -8, 9, 8)}<circle class="glow" cy="10" r="22" fill-opacity=".45"/>`,
  },
  works: { // the river gate to the divine bank: marble gateposts and a bronze gate
    labelY: -42,
    art: `<rect x="-26" y="-20" width="9" height="40" fill="${C.marble}"/><rect x="17" y="-20" width="9" height="40" fill="${C.marble}"/>
      <rect x="-27" y="-23" width="11" height="3" fill="${C.marbleShadow}"/><rect x="16" y="-23" width="11" height="3" fill="${C.marbleShadow}"/>
      <rect x="-17" y="-26" width="34" height="4" fill="${C.marble}"/><rect x="-17" y="-22" width="34" height="1.5" fill="${C.marbleShadow}"/>
      <g stroke="#8a6a3a" stroke-width="1.5"><line x1="-12" y1="-18" x2="-12" y2="20"/><line x1="-6" y1="-18" x2="-6" y2="20"/><line x1="0" y1="-18" x2="0" y2="20"/><line x1="6" y1="-18" x2="6" y2="20"/><line x1="12" y1="-18" x2="12" y2="20"/><line x1="-14" y1="0" x2="14" y2="0"/></g>
      ${brazier(-21.5, -24)}${brazier(21.5, -24)}`,
    lights: `${brazierLight(-21.5, -24)}${brazierLight(21.5, -24)}`,
  },
  temple: { // Doric marble temple: stepped stylobate, six plain columns on a dark base line, pediment, braziers
    labelY: -66,
    art: `<ellipse cy="26" rx="76" ry="12" fill="${C.marbleShadow}" opacity=".45"/>
      <rect x="-66" y="14" width="132" height="6" fill="${C.marbleShadow}"/><rect x="-60" y="8" width="120" height="6" fill="#D6CFBF"/><rect x="-54" y="2" width="108" height="6" fill="${C.marble}"/>
      <rect x="-50" y="-30" width="100" height="32" fill="${C.marble}"/><rect x="-44" y="-26" width="88" height="28" fill="#8F8676"/><rect x="-44" y="-26" width="88" height="28" fill="url(#templeInner)"/>
      <rect x="-50" y="1" width="100" height="2" fill="${C.ink}" opacity=".55"/>
      ${doricCol(-44, 2, 34)}${doricCol(-27, 2, 34)}${doricCol(-10, 2, 34)}${doricCol(10, 2, 34)}${doricCol(27, 2, 34)}${doricCol(44, 2, 34)}
      <rect x="-54" y="-39" width="108" height="6" fill="${C.marble}"/><rect x="-54" y="-33" width="108" height="1.5" fill="${C.marbleShadow}"/>
      <polygon points="-57,-39 0,-60 57,-39" fill="${C.marble}" stroke="${C.marbleShadow}" stroke-width="1"/><polygon points="-45,-41 0,-56 45,-41" fill="#DED7C6"/>
      <circle cy="-47" r="4.5" fill="${C.gold}"/>
      ${brazier(-64, 0)}${brazier(64, 0)}
      <rect x="-10" y="-10" width="20" height="12" rx="1" fill="${C.ink}" opacity=".8"/>`,
    lights: `<rect class="lit" x="-44" y="-26" width="88" height="28" fill-opacity=".3"/><circle class="glow" cy="-16" r="46" fill-opacity=".8"/>
      ${brazierLight(-64, 0)}${brazierLight(64, 0)}<circle class="lit" cy="-47" r="4.5" fill="#ffe08a"/><circle class="glow" cy="-47" r="14"/>`,
  },
  greatlibrary: { // marble stoa with scroll niches
    labelY: -50,
    art: `<ellipse cy="24" rx="70" ry="11" fill="${C.marbleShadow}" opacity=".45"/>
      <rect x="-62" y="12" width="124" height="6" fill="${C.marbleShadow}"/><rect x="-56" y="6" width="112" height="6" fill="${C.marble}"/>
      <rect x="-54" y="-26" width="108" height="32" fill="${C.marble}"/><rect x="-50" y="-22" width="100" height="26" fill="#A39B8A"/>
      <g fill="${C.ink}" opacity=".7"><rect x="-44" y="-18" width="9" height="7"/><rect x="-30" y="-18" width="9" height="7"/><rect x="-16" y="-18" width="9" height="7"/><rect x="7" y="-18" width="9" height="7"/><rect x="21" y="-18" width="9" height="7"/><rect x="35" y="-18" width="9" height="7"/><rect x="-44" y="-7" width="9" height="7"/><rect x="-30" y="-7" width="9" height="7"/><rect x="21" y="-7" width="9" height="7"/><rect x="35" y="-7" width="9" height="7"/></g>
      <g fill="${C.plaster}"><circle cx="-41" cy="-14.5" r="1.3"/><circle cx="-36" cy="-14.5" r="1.3"/><circle cx="-27" cy="-14.5" r="1.3"/><circle cx="-22" cy="-14.5" r="1.3"/><circle cx="-13" cy="-14.5" r="1.3"/><circle cx="-8" cy="-14.5" r="1.3"/><circle cx="10" cy="-14.5" r="1.3"/><circle cx="15" cy="-14.5" r="1.3"/><circle cx="24" cy="-14.5" r="1.3"/><circle cx="29" cy="-14.5" r="1.3"/><circle cx="38" cy="-14.5" r="1.3"/><circle cx="43" cy="-14.5" r="1.3"/><circle cx="-41" cy="-3.5" r="1.3"/><circle cx="-36" cy="-3.5" r="1.3"/><circle cx="-27" cy="-3.5" r="1.3"/><circle cx="-22" cy="-3.5" r="1.3"/><circle cx="24" cy="-3.5" r="1.3"/><circle cx="29" cy="-3.5" r="1.3"/><circle cx="38" cy="-3.5" r="1.3"/><circle cx="43" cy="-3.5" r="1.3"/></g>
      <rect x="-4" y="-10" width="8" height="14" fill="${C.ink}" opacity=".75"/>
      <rect x="-54" y="5" width="108" height="2" fill="${C.ink}" opacity=".55"/>
      ${doricCol(-48, 6, 30, 5)}${doricCol(-32, 6, 30, 5)}${doricCol(-16, 6, 30, 5)}${doricCol(0, 6, 30, 5)}${doricCol(16, 6, 30, 5)}${doricCol(32, 6, 30, 5)}${doricCol(48, 6, 30, 5)}
      <rect x="-58" y="-31" width="116" height="5" fill="${C.marble}"/><rect x="-58" y="-26" width="116" height="1.5" fill="${C.marbleShadow}"/><polygon points="-60,-31 0,-40 60,-31" fill="#DED7C6"/>
      ${brazier(-60, 6)}${brazier(60, 6)}`,
    lights: `<rect class="lit" x="-50" y="-22" width="100" height="26" fill-opacity=".25"/><circle class="glow" cy="-8" r="40" fill-opacity=".6"/>${brazierLight(-60, 6)}${brazierLight(60, 6)}`,
  },
  forge: { // round furnace of dark stone with a glowing mouth, bronze anvil, marble platform, smoke when busy
    labelY: -44,
    art: `<ellipse cy="22" rx="50" ry="11" fill="${C.marbleShadow}" opacity=".45"/>
      <rect x="-44" y="10" width="88" height="8" fill="${C.marble}"/><rect x="-40" y="6" width="80" height="4" fill="#D6CFBF"/>
      <path d="M-22,8 A22,24 0 0 1 22,8 Z" fill="#5A524C"/><path d="M-22,8 A22,24 0 0 1 22,8" fill="none" stroke="#3E3835" stroke-width="1.5"/>
      <path d="M-16,8 A16,14 0 0 1 16,8" fill="none" stroke="#7A716A" stroke-width="1" stroke-dasharray="3 2"/>
      <path d="M-7,8 A7,8 0 0 1 7,8 Z" fill="#E86A2F"/><path d="M-4,8 A4,5 0 0 1 4,8 Z" fill="${C.gold}"/>
      <rect x="-3" y="-28" width="6" height="12" fill="#3E3835"/><g transform="translate(0,-30)"><circle class="smoke" r="3"/><circle class="smoke" r="3"/><circle class="smoke" r="3"/></g>
      <g transform="translate(34,2)"><rect x="-8" y="-3" width="16" height="5" fill="#B87333"/><rect x="-4" y="2" width="8" height="5" fill="#3E3835"/><path d="M8,-3 l5,1.5 l-5,1.5 z" fill="#B87333"/></g>
      <g transform="translate(-34,0)"><rect x="-6" y="0" width="12" height="7" fill="${C.wood}"/><path d="M-6,0 l3,-7 h6 l3,7" fill="none" stroke="${C.woodDark}" stroke-width="1.2"/></g>
      ${amphora(-44, 6, 0.9)}`,
    lights: `<circle class="glow" cy="4" r="22" fill-opacity=".9"/><path class="lit" d="M-7,8 A7,8 0 0 1 7,8 Z" fill="#ffb347"/>`,
  },
  quarry: { // cut-stone terraces and an A-frame crane
    labelY: -52,
    art: `<ellipse cy="24" rx="60" ry="11" fill="${C.marbleShadow}" opacity=".45"/>
      <rect x="-56" y="8" width="112" height="14" fill="#D6CFBF"/><rect x="-46" y="-6" width="92" height="14" fill="${C.marble}"/><rect x="-34" y="-18" width="68" height="12" fill="#D6CFBF"/>
      <g stroke="${C.marbleShadow}" stroke-width="1"><line x1="-56" y1="8" x2="56" y2="8"/><line x1="-46" y1="-6" x2="46" y2="-6"/><line x1="-34" y1="-18" x2="34" y2="-18"/><line x1="-20" y1="8" x2="-20" y2="22"/><line x1="16" y1="8" x2="16" y2="22"/><line x1="-8" y1="-6" x2="-8" y2="8"/><line x1="24" y1="-6" x2="24" y2="8"/><line x1="4" y1="-18" x2="4" y2="-6"/></g>
      <g fill="${C.marble}" stroke="${C.marbleShadow}" stroke-width=".8"><rect x="-52" y="0" width="10" height="8"/><rect x="38" y="-2" width="12" height="10"/><rect x="-30" y="-26" width="9" height="8"/></g>
      <g stroke="${C.woodDark}" stroke-width="2" stroke-linecap="round"><line x1="12" y1="-18" x2="26" y2="-48"/><line x1="40" y1="-18" x2="26" y2="-48"/><line x1="26" y1="-48" x2="-6" y2="-36"/></g>
      <line x1="-6" y1="-36" x2="-6" y2="-20" stroke="#6b5a44" stroke-width="1"/><rect x="-11" y="-20" width="10" height="7" fill="${C.marble}" stroke="${C.marbleShadow}" stroke-width=".8"/>
      <circle cx="26" cy="-48" r="2" fill="${C.wood}"/>
      ${brazier(-50, 10)}`,
    lights: `${brazierLight(-50, 10)}`,
  },
};

const OBJECT_ART = {
  tree: `<ellipse cy="8" rx="7" ry="2.5" class="shadow"/><rect x="-1.5" y="-2" width="3" height="10" fill="${C.wood}"/><circle cy="-6" r="8" fill="#7F8F5F"/><circle cx="-3" cy="-9" r="5" fill="#9DAA6B"/><circle cx="3" cy="-4" r="1.2" fill="${C.oliveDark}"/><circle cx="-4" cy="-2" r="1.2" fill="${C.oliveDark}"/>`,
  flowers: `<g stroke="${C.oliveDark}" stroke-width="1"><line x1="-4" y1="4" x2="-4" y2="-3"/><line x1="0" y1="5" x2="0" y2="-5"/><line x1="4" y1="4" x2="4" y2="-2"/></g><circle cx="-4" cy="-4" r="2.2" fill="#E88AA5"/><circle cy="-6" r="2.4" fill="${C.ochre}"/><circle cx="4" cy="-3" r="2.2" fill="#fff"/><circle cx="-4" cy="-4" r=".8" fill="#fff"/><circle cy="-6" r=".8" fill="#fff"/><circle cx="4" cy="-3" r=".8" fill="${C.ochre}"/>`,
  lamp: `${lamp(0, 6, 12)}`,
  bench: `<rect x="-8" y="-2" width="16" height="3" rx="1" fill="${C.wood}"/><rect x="-8" y="-6" width="16" height="2.5" rx="1" fill="${C.woodDark}"/><rect x="-7" y="1" width="2" height="4" fill="${C.woodDark}"/><rect x="5" y="1" width="2" height="4" fill="${C.woodDark}"/>`,
  stone: `<ellipse cy="3" rx="6" ry="2" class="shadow"/><path d="M-5,2 q0,-9 5,-9 q5,0 5,9 z" fill="${C.marbleShadow}"/><path d="M-3,0 q0,-5 3,-5 q3,0 3,5" fill="none" stroke="${C.marble}" stroke-width="1" stroke-dasharray="1.5 1.5"/>`,
  artwork: `<path d="M-5,8 l5,-14 l5,14 M-3,2 h6" stroke="${C.wood}" stroke-width="1.3" fill="none"/><rect x="-6" y="-9" width="12" height="10" fill="${C.lime}" stroke="${C.wood}" stroke-width=".8"/><rect x="-4" y="-7" width="8" height="6" fill="${C.shallows}"/><path d="M-4,-2 l3,-3 l2,2 l3,-3 v3 h-8 z" fill="${C.oliveDark}"/>`,
  lantern: `<line x1="0" y1="-12" x2="0" y2="-7" stroke="${C.woodDark}" stroke-width="1"/><line x1="-6" y1="-12" x2="6" y2="-12" stroke="${C.woodDark}" stroke-width="1.5"/><path d="M-4,-7 h8 v6 q0,4 -4,4 q-4,0 -4,-4 z" class="lamp-head"/><circle class="lamp-glow" cy="-2" r="11"/>`,
  sign: `<rect x="-1" y="-2" width="2" height="10" fill="${C.wood}"/><rect x="-8" y="-10" width="16" height="9" rx="1.5" fill="${C.plaster}" stroke="${C.wood}" stroke-width=".8"/><g stroke="${C.woodDark}" stroke-width="1"><line x1="-5" y1="-7" x2="5" y2="-7"/><line x1="-5" y1="-4" x2="2" y2="-4"/></g>`,
};
export const GIFT_KINDS = Object.keys(OBJECT_ART);
export function giftIconSVG(kind) {
  return `<svg viewBox="-12 -16 24 28" xmlns="http://www.w3.org/2000/svg">${OBJECT_ART[kind] || ''}</svg>`;
}

const PHASE_TINT = {
  dawn: ['#F2C9A8', 0.42],
  morning: ['#ffffff', 0],
  afternoon: ['#F2D9A0', 0.3],
  twilight: ['#B06A8C', 0.45],
  night: ['#1F2A5C', 0.85],
};
const TOOL_COLORS = { claude: '#e7a26b', codex: '#a9d8c4', antigravity: '#c4b5f0', grok: '#8da2c4', gemini: '#9fc5f0', other: '#b8b0a6' };

// ---------- Map ----------
export function createMap(svg, opts = {}) {
  const wrap = svg.parentElement;
  const vb = { ...VILLAGE };
  const layers = {};
  const order = ['defs', 'ground', 'river', 'paths', 'plots', 'trees', 'places', 'sharedTrees', 'workshops', 'objects', 'mist', 'tint', 'lights', 'fireflies', 'workers', 'residents', 'you', 'seal', 'fx'];
  for (const name of order) layers[name] = el('g', { class: `layer-${name}` }, svg);

  layers.defs.innerHTML = `<defs>
    <radialGradient id="glowGrad"><stop offset="0" stop-color="#F2C14E" stop-opacity=".55"/><stop offset="1" stop-color="#F2C14E" stop-opacity="0"/></radialGradient>
    <radialGradient id="fieldGrad" cx=".45" cy=".45" r=".7"><stop offset="0" stop-color="#A9B475"/><stop offset="1" stop-color="#9DAA6B"/></radialGradient>
    <linearGradient id="templeInner" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#5a4f44" stop-opacity=".55"/><stop offset="1" stop-color="#5a4f44" stop-opacity="0"/></linearGradient>
    <pattern id="marblePave" width="26" height="18" patternUnits="userSpaceOnUse"><rect width="26" height="18" fill="#E6E0D2"/><path d="M0,0 H26 M0,9 H26 M13,0 V9 M0,9 V18 M26,9 V18" stroke="#CFC7B5" stroke-width="1" fill="none"/></pattern>
    <filter id="softShadow" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="1.5" stdDeviation="1.2" flood-color="#2a1a0c" flood-opacity=".3"/></filter>
  </defs>`;
  const defs = layers.defs.firstElementChild;

  buildTerrain();
  const tintRect = el('rect', { class: 'tint', x: -400, y: -400, width: 3000, height: WORLD.h + 800, fill: '#fff', opacity: 0 }, layers.tint);
  buildFireflies();
  let isleBuilt = false;
  function ensureIsle() {
    if (isleBuilt) return;
    isleBuilt = true;
    buildIsle({ ground: layers.ground, mist: layers.mist, lights: layers.lights, defs });
  }

  // ---- rune seal dome over the isle (Linear A) ----
  let dome = null, domeKey = '';
  function updateSealDome(runes) {
    const key = runes.join('\n');
    if (dome && domeKey === key) return;
    domeKey = key;
    if (!dome) {
      defs.insertAdjacentHTML('beforeend', `<radialGradient id="domeGrad" cx=".5" cy=".55" r=".55"><stop offset="0" stop-color="#6e5fb8" stop-opacity=".10"/><stop offset=".75" stop-color="#5fb8b0" stop-opacity=".22"/><stop offset="1" stop-color="#e6f2ff" stop-opacity=".55"/></radialGradient>`);
      dome = el('g', { class: 'seal-dome' }, layers.seal);
      const c = ISLE.center;
      el('ellipse', { cx: c.x, cy: c.y, rx: 318, ry: 432, fill: 'url(#domeGrad)', class: 'dome-fill' }, dome);
      el('ellipse', { cx: c.x, cy: c.y, rx: 318, ry: 432, class: 'dome-ring' }, dome);
      el('ellipse', { cx: c.x, cy: c.y, rx: 308, ry: 420, class: 'dome-ring dome-ring2' }, dome);
      dome._runes = el('g', { class: 'dome-runes' }, dome);
      dome._engraved = el('g', { class: 'dome-engraved' }, dome);
    }
    dome._runes.textContent = '';
    dome._engraved.textContent = '';
    const lines = runes.length ? runes : [laGlyphs('sealed', 6)];
    const c = ISLE.center;
    for (let i = 0; i < Math.min(9, lines.length); i++) {
      const t = el('text', { class: 'rune-drift', x: c.x - 200 + (i % 3) * 140, y: c.y - 330 + i * 78, 'text-anchor': 'middle' }, dome._runes);
      t.textContent = Array.from(String(lines[i])).slice(0, 22).join('');
      t.style.animationDelay = `${-(i * 2.3) % 14}s`;
      t.style.animationDuration = `${12 + (i % 4) * 3}s`;
    }
    const ring = Array.from(lines.join(' ').replace(/\s+/g, ' ')).slice(0, 140).join('');
    const pid = 'domeRim';
    if (!defs.querySelector(`#${pid}`)) el('path', { id: pid, d: `M${c.x - 290},${c.y} A290,400 0 1 1 ${c.x + 290},${c.y} A290,400 0 1 1 ${c.x - 290},${c.y}`, fill: 'none' }, defs);
    const tp = el('text', { class: 'rune-engraved' }, dome._engraved);
    const tpath = el('textPath', {}, tp);
    tpath.setAttribute('href', `#${pid}`);
    tpath.textContent = ring || laGlyphs('sealed', 6);
  }
  function removeSealDome() {
    if (!dome) return;
    dome.remove(); dome = null; domeKey = '';
  }
  function setWorldSize(w, h) {
    const nw = Number.isFinite(+w) && +w > 0 ? +w : WORLD.w;
    const nh = Number.isFinite(+h) && +h > 0 ? +h : WORLD.h;
    if (nw === WORLD.w && nh === WORLD.h) return;
    WORLD.w = nw; WORLD.h = nh;
    clampVB(); applyVB();
  }

  // ---- terrain ----
  function buildTerrain() {
    const g = layers.ground;
    el('rect', { class: 'ground', x: -400, y: -400, width: 3000, height: WORLD.h + 800 }, g);
    el('rect', { x: 0, y: 0, width: 1000, height: WORLD.h, fill: 'url(#fieldGrad)' }, g);
    const rnd = mulberry(7);
    for (let i = 0; i < 22; i++) { // dry gold patches
      el('ellipse', { class: 'ground-dry', cx: Math.round(rnd() * 720), cy: Math.round(rnd() * 760), rx: Math.round(30 + rnd() * 70), ry: Math.round(14 + rnd() * 30), opacity: (0.22 + rnd() * 0.25).toFixed(2) }, g);
    }
    for (let i = 0; i < 14; i++) { // dark olive scrub
      el('ellipse', { class: 'ground-scrub', cx: Math.round(rnd() * 720), cy: Math.round(rnd() * 760), rx: Math.round(16 + rnd() * 30), ry: Math.round(8 + rnd() * 14), opacity: (0.15 + rnd() * 0.2).toFixed(2) }, g);
    }
    // the divine bank: marble pavement
    el('rect', { class: 'divine-ground', x: 790, y: -20, width: SEA_X - 790 + 10, height: 800, rx: 24, fill: 'url(#marblePave)', opacity: 0.95 }, g);
    el('rect', { x: 790, y: -20, width: SEA_X - 790 + 10, height: 800, rx: 24, fill: 'none', stroke: '#CFC7B5', 'stroke-width': 2 }, g);
    el('text', { x: 890, y: 36, class: 'district-label', 'text-anchor': 'middle' }, g).textContent = 'The divine bank';

    // river: Aegean blue with pale shallows
    const pts = [{ x: 745, y: -40 }, { x: 735, y: 90 }, { x: 762, y: 200 }, { x: 740, y: 300 }, { x: 752, y: 381 }, { x: 736, y: 470 }, { x: 766, y: 560 }, { x: 744, y: 660 }, { x: 756, y: 800 }];
    const d = smoothPath(pts);
    el('path', { d, class: 'river-edge', 'stroke-width': 54 }, layers.river);
    el('path', { d, fill: 'none', stroke: C.blue, 'stroke-width': 44, 'stroke-linejoin': 'round' }, layers.river);
    el('path', { d, fill: 'none', stroke: C.shallows, 'stroke-width': 26, opacity: 0.55 }, layers.river);
    el('path', { d, class: 'river-shine' }, layers.river);
    el('path', { d, class: 'river-shine', 'stroke-dashoffset': 25, transform: 'translate(-9,0)' }, layers.river);
    art(layers.river, `<path d="M-34,-12 Q0,-22 34,-12 L34,12 Q0,2 -34,12 Z" fill="${C.marble}"/><path d="M-34,-12 Q0,-22 34,-12" fill="none" stroke="${C.marbleShadow}" stroke-width="1.5"/><path d="M-34,12 Q0,2 34,12" fill="none" stroke="${C.marbleShadow}" stroke-width="1.5"/>
      <g stroke="${C.marbleShadow}" stroke-width=".8"><line x1="-22" y1="-14" x2="-22" y2="10"/><line x1="-11" y1="-16" x2="-11" y2="8"/><line x1="0" y1="-17" x2="0" y2="7"/><line x1="11" y1="-16" x2="11" y2="8"/><line x1="22" y1="-14" x2="22" y2="10"/></g>
      <path d="M-30,0 A30,12 0 0 1 30,0" fill="none" stroke="${C.marbleShadow}" stroke-width="2"/>`,
      { transform: 'translate(752,381)' });
    const rr = mulberry(99);
    for (let i = 0; i < 18; i++) {
      const side = rr() < 0.5 ? -1 : 1;
      const y = rr() * 760;
      const x = 750 + side * (28 + rr() * 8) + Math.sin(y / 90) * 10;
      art(layers.river, `<g stroke="${C.oliveDark}" stroke-width="1.2" fill="none"><path d="M0,0 q-1,-6 1,-11"/><path d="M2,0 q2,-5 0,-9"/><path d="M-2,1 q-3,-4 -1,-8"/></g>`, { transform: `translate(${x.toFixed(1)},${y.toFixed(1)})` });
    }
  }

  function buildFireflies() {
    const rnd = mulberry(5);
    const spots = [[560, 540], [300, 480], [140, 580], [700, 600], [420, 400]];
    for (let i = 0; i < 24; i++) {
      const s = spots[i % spots.length];
      const c = el('circle', { cx: s[0] + (rnd() - 0.5) * 120, cy: s[1] + (rnd() - 0.5) * 80, r: 1.3, fill: '#ffe9a0' }, layers.fireflies);
      c.style.animation = `firefly ${3 + rnd() * 3}s ease-in-out ${rnd() * 4}s infinite`;
    }
  }

  // ---- paths & ambient trees (olives, cypresses; Aleppo pines on the isle) ----
  let terrainKey = '';
  function buildPathsAndTrees(places, workshops, plots) {
    const key = places.map((p) => `${p.id}:${p.x},${p.y}`).join('|') + '#' + workshops.map((w) => `${w.id}:${w.x},${w.y}`).join('|') + '#' + (isleBuilt ? 'i' : '');
    if (key === terrainKey) return;
    terrainKey = key;
    layers.paths.innerHTML = '';
    layers.trees.innerHTML = '';
    const segs = [];
    const rnd = mulberry(3);
    const addCurve = (a, b, bend) => {
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const len = dist(a, b) || 1;
      const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
      const d = `M${a.x},${a.y} Q${(mx + nx * bend).toFixed(1)},${(my + ny * bend).toFixed(1)} ${b.x},${b.y}`;
      el('path', { d, class: 'path-edge' }, layers.paths);
      el('path', { d, class: 'path' }, layers.paths);
      segs.push([a, b]);
    };
    const west = places.filter((p) => zoneOf(p) === 'village' && p.x < 720);
    for (const [a, b] of mst(west)) addCurve(a, b, (rnd() - 0.5) * Math.min(80, dist(a, b) * 0.5));
    const bridge = { x: 752, y: 381 };
    const gate = places.find((p) => p.kind === 'works' && zoneOf(p) === 'village') || { x: 815, y: 380 };
    const plaza = west.find((p) => p.kind === 'plaza') || nearest(west, bridge);
    if (plaza) {
      const d = smoothPath([plaza, { x: (plaza.x + bridge.x) / 2, y: plaza.y - 6 }, { x: bridge.x - 40, y: bridge.y }, { x: bridge.x + 40, y: bridge.y }, gate]);
      el('path', { d, class: 'path-edge' }, layers.paths);
      el('path', { d, class: 'path' }, layers.paths);
      segs.push([plaza, bridge], [bridge, gate]);
    }
    // the divine bank: a marble way from the gate to each site
    const divine = places.filter((p) => zoneOf(p) === 'village' && p.x >= 790 && p.kind !== 'works');
    for (const s of divine) {
      const d = `M${gate.x},${gate.y} Q${s.x - 10},${(gate.y + s.y) / 2} ${s.x},${s.y + 26}`;
      el('path', { d, class: 'path-marble' }, layers.paths);
      segs.push([gate, { x: s.x, y: s.y + 26 }]);
    }
    for (const w of workshops.filter((w) => zoneOf(w) === 'village')) addCurve(gate, { x: w.x, y: w.y + 30 }, (rnd() - 0.5) * 40);
    const isle = places.filter((p) => zoneOf(p) === 'isle' || p.x >= ISLE.bounds.x);
    for (const [a, b] of mst(isle)) addCurve(a, b, (rnd() - 0.5) * Math.min(60, dist(a, b) * 0.4));
    for (const w of workshops.filter((w) => zoneOf(w) === 'isle' || w.x >= ISLE.bounds.x)) {
      const n = nearest(isle, w);
      if (n) addCurve(n, { x: w.x, y: w.y + 30 }, (rnd() - 0.5) * 40);
    }

    const avoid = [...places.map((p) => ({ ...p, r: p.x >= 790 && zoneOf(p) === 'village' ? 80 : 62 })), ...workshops.map((w) => ({ ...w, r: 72 })), ...plots.map((p) => ({ ...p, r: 40 }))];
    const tr = mulberry(11);
    let placed = 0, tries = 0;
    const want = isleBuilt ? 70 : 48;
    const olive = `<ellipse cy="8" rx="8" ry="3" class="shadow"/><path d="M-1.5,9 L-2.5,2 Q-4,-1 -1,-3 L1,-3 Q4,-1 2.5,2 L1.5,9 Z" class="tree-trunk"/><circle cy="-5" r="9" class="olive-canopy"/><circle cx="-4" cy="-8" r="6" class="olive-canopy2"/><circle cx="5" cy="-3" r="5" class="olive-canopy2"/>`;
    const cypress = `<ellipse cy="9" rx="5" ry="2" class="shadow"/><rect x="-1" y="5" width="2" height="5" class="tree-trunk"/><path d="M-5,6 Q-5,-6 0,-20 Q5,-6 5,6 Z" class="cypress"/><path d="M-2.5,4 Q-2.5,-6 0,-16 Q2.5,-6 2.5,4 Z" class="cypress2"/>`;
    const pine = `<ellipse cy="7" rx="7" ry="2.5" class="shadow"/><rect x="-1" y="2" width="3" height="6" class="tree-trunk" transform="skewX(-8)"/><path d="M-9,4 Q-3,-4 2,-13 Q6,-4 10,4 Z" fill="#4a6f62"/><path d="M-6,0 Q-1,-8 3,-15 Q7,-6 8,0 Z" fill="#5a8273"/>`;
    while (placed < want && tries < 1700) {
      tries++;
      const onIsle = isleBuilt && tr() < 0.32;
      const x = onIsle ? ISLE.bounds.x + tr() * ISLE.bounds.w : tr() * 1000;
      const y = tr() * 760;
      if (onIsle) { if (!isleLandAt(x, y, 34)) continue; }
      else {
        if (Math.abs(x - 750) < 42) continue;
        if (x > 790 && tr() < 0.85) continue;
      }
      if (avoid.some((a) => dist(a, { x, y }) < a.r)) continue;
      if (segs.some(([a, b]) => segDist({ x, y }, a, b) < 16)) continue;
      const s = 0.8 + tr() * 0.6;
      const markup = onIsle ? pine : tr() < 0.3 ? cypress : olive;
      art(layers.trees, markup, { transform: `translate(${x.toFixed(1)},${y.toFixed(1)}) scale(${s.toFixed(2)})` });
      placed++;
    }
  }
  function nearest(list, p) {
    let best = null, bd = Infinity;
    for (const q of list) { const d = dist(q, p); if (d < bd) { bd = d; best = q; } }
    return best;
  }
  function mst(nodes) {
    const edges = [];
    if (nodes.length < 2) return edges;
    const inTree = new Set([0]);
    while (inTree.size < nodes.length) {
      let best = null, bd = Infinity;
      for (const i of inTree) for (let j = 0; j < nodes.length; j++) {
        if (inTree.has(j)) continue;
        const d = dist(nodes[i], nodes[j]);
        if (d < bd) { bd = d; best = [i, j]; }
      }
      if (!best) break;
      inTree.add(best[1]);
      edges.push([nodes[best[0]], nodes[best[1]]]);
    }
    return edges;
  }

  // ---- generic id-keyed sync ----
  function sync(layer, items, keyFn, create, update) {
    const map = layer._recs || (layer._recs = new Map());
    const seen = new Set();
    for (const item of items) {
      const k = keyFn(item);
      if (k == null || seen.has(k)) continue;
      let rec = map.get(k);
      if (!rec) { rec = { el: create(item), key: k }; layer.appendChild(rec.el); map.set(k, rec); }
      rec.data = item;
      update(rec, item);
      seen.add(k);
    }
    for (const [k, rec] of map) if (!seen.has(k)) { rec.el.remove(); rec.el._lights?.remove(); map.delete(k); }
    return map;
  }
  const movers = new Set();
  function setMoverTarget(rec, x, y) {
    if (!rec.cur) { rec.cur = { x, y }; rec.el.setAttribute('transform', `translate(${x},${y})`); }
    rec.target = { x, y };
    movers.add(rec);
  }

  // ---- places ----
  function artFor(p) {
    if (p.kind === 'tower' && zoneOf(p) === 'isle') return PLACE_ART.lighthouse;
    return PLACE_ART[p.kind] || PLACE_ART.house;
  }
  function createPlace(p) {
    const g = el('g', { class: 'place', 'data-id': p.id, 'data-kind': p.kind });
    const a = artFor(p);
    art(g, `<ellipse cy="18" rx="44" ry="10" class="shadow" opacity=".45"/>`);
    art(g, a.art, { filter: 'url(#softShadow)' });
    const label = el('text', { class: 'place-label', y: a.labelY }, g);
    label.textContent = String(p.name || p.id || '');
    const lights = el('g', { class: 'place-lights', 'data-for': p.id }, layers.lights);
    lights.innerHTML = a.lights || '';
    g._lights = lights;
    g._artKey = `${p.kind}|${zoneOf(p)}`;
    return g;
  }
  function updatePlace(rec, p, busy) {
    if (rec.el._artKey !== `${p.kind}|${zoneOf(p)}`) {
      rec.el._lights.remove();
      const fresh = createPlace(p);
      rec.el.replaceWith(fresh);
      rec.el = fresh;
    }
    rec.el.setAttribute('transform', `translate(${p.x},${p.y})`);
    rec.el._lights.setAttribute('transform', `translate(${p.x},${p.y})`);
    rec.el.classList.toggle('busy', !!busy);
    const lbl = rec.el.querySelector('.place-label');
    if (lbl.textContent !== String(p.name || p.id || '')) lbl.textContent = String(p.name || p.id || '');
  }

  // ---- isle workshops (quarantine yards) ----
  function createWorkshop(w) {
    const g = el('g', { class: 'ws', 'data-id': w.id });
    art(g, `<ellipse cy="28" rx="48" ry="9" class="shadow" opacity=".5"/>
      <rect x="-42" y="12" width="84" height="14" rx="1" fill="#5A524C"/><rect x="-38" y="8" width="76" height="5" fill="#7A716A"/>
      <rect x="-30" y="-6" width="60" height="18" fill="${C.plaster}"/><rect x="-30" y="-6" width="60" height="2" fill="${C.lime}"/>
      <g fill="${C.lime}"><rect x="-35" y="-30" width="4.5" height="38"/><rect x="30.5" y="-30" width="4.5" height="38"/><rect x="-13" y="-30" width="4" height="22"/><rect x="9" y="-30" width="4" height="22"/></g>
      <rect x="-39" y="-34" width="78" height="5" fill="${C.marbleShadow}"/><polygon points="-41,-34 0,-47 41,-34" fill="${C.terracotta}"/>
      <rect x="-9" y="-4" width="18" height="10" rx="2" fill="${C.ink}" opacity=".8"/>${win(-6, -2, 12, 6, 1)}
      ${brazier(-46, 6)}<g transform="translate(-46,-10)"><circle class="smoke" r="2.2"/><circle class="smoke" r="2.2"/><circle class="smoke" r="2.2"/></g>${brazier(46, 6)}`, { filter: 'url(#softShadow)' });
    art(g, `<g stroke="#5A524C" stroke-width="1.2" fill="none"><line x1="-54" y1="-6" x2="-54" y2="34"/><line x1="54" y1="-6" x2="54" y2="34"/><line x1="-54" y1="34" x2="54" y2="34"/><line x1="-54" y1="2" x2="-46" y2="2"/><line x1="46" y1="2" x2="54" y2="2"/><line x1="-54" y1="18" x2="-46" y2="18"/><line x1="46" y1="18" x2="54" y2="18"/></g><rect x="-10" y="31" width="20" height="6" rx="1" fill="${C.red}"/><rect x="-8" y="33" width="16" height="2" fill="#fff" opacity=".7"/>`, { class: 'ws-fence' });
    const t1 = el('text', { class: 'ws-label', y: -54 }, g);
    const t2 = el('text', { class: 'ws-label ws-host', y: -43 }, g);
    g._t1 = t1; g._t2 = t2;
    const lights = el('g', { class: 'ws-lights' }, layers.lights);
    lights.innerHTML = `${winLit(-6, -2, 12, 6, 1)}${brazierLight(-46, 6)}${brazierLight(46, 6)}`;
    g._lights = lights;
    return g;
  }
  function updateWorkshop(rec, w, busy) {
    rec.el.setAttribute('transform', `translate(${w.x},${w.y})`);
    rec.el._lights.setAttribute('transform', `translate(${w.x},${w.y})`);
    const p = String(w.project || w.id || ''), h = `@ ${String(w.host || 'local')}`;
    if (rec.el._t1.textContent !== p) rec.el._t1.textContent = p;
    if (rec.el._t2.textContent !== h) rec.el._t2.textContent = h;
    rec.el.classList.toggle('busy', !!busy);
    rec.el.classList.toggle('quarantined', zoneOf(w) === 'isle');
  }

  // ---- plots ----
  function createPlot() {
    const g = el('g', { class: 'plot-g' });
    el('circle', { class: 'plot', r: 22 }, g);
    el('text', { class: 'plot-label', y: 3 }, g).textContent = 'free plot';
    return g;
  }

  // ---- objects (gifts) ----
  function createObject(o) {
    const g = el('g', { class: 'obj', 'data-id': o.id, 'data-kind': o.kind });
    art(g, OBJECT_ART[o.kind] || OBJECT_ART.stone);
    if (o.kind === 'lamp' || o.kind === 'lantern') {
      const lights = el('g', { class: 'obj-lights' }, layers.lights);
      lights.innerHTML = o.kind === 'lamp' ? lampLight(0, 6, 12) : `<circle class="glow" cy="-2" r="12"/><path class="lit" d="M-4,-7 h8 v6 q0,4 -4,4 q-4,0 -4,-4 z" fill-opacity=".8"/>`;
      g._lights = lights;
    }
    return g;
  }
  function updateObject(rec, o) {
    rec.el.setAttribute('transform', `translate(${o.x},${o.y})`);
    if (rec.el._lights) rec.el._lights.setAttribute('transform', `translate(${o.x},${o.y})`);
  }

  // ---- shared trees ----
  function createSharedTree(t) {
    const g = createTree(t);
    g._lights = el('g', { class: 'tree-lights' }, layers.lights);
    return g;
  }
  function updateSharedTree(rec, t, now) {
    rec.el.setAttribute('transform', `translate(${+t.x || 0},${+t.y || 0})`);
    rec.el._lights.setAttribute('transform', `translate(${+t.x || 0},${+t.y || 0})`);
    rec.el.classList.toggle('sealed', !!t.sealed);
    const shown = t.sealed
      ? { zone: t.zone, species: t.species, stage: 2, blossoms: 0, blooms: [], branches: [{ id: 's1', credits: 9 }, { id: 's2', credits: 7 }, { id: 's3', credits: 5 }, { id: 's4', credits: 3 }] }
      : t;
    const sig = treeSignature(shown, now) + (t.sealed ? '#sealed' : '');
    if (rec.sig !== sig) { rec.sig = sig; drawTree(rec.el, rec.el._lights, shown, now); }
  }

  // ---- residents (chibi body in a chiton; priest wears a laurel wreath and carries the staff) ----
  function createResident(r) {
    const g = el('g', { class: 'resident', 'data-name': r.name });
    const body = el('g', { class: 'bob' }, g);
    el('ellipse', { cy: 10, rx: 8, ry: 3, class: 'shadow' }, g);
    g.insertBefore(g.lastChild, body);
    el('circle', { class: 'turn-ring', r: 16, cy: 0 }, body);
    el('ellipse', { class: 'foot', cx: -3, cy: 9, rx: 2.5, ry: 1.5 }, body);
    el('ellipse', { class: 'foot', cx: 3, cy: 9, rx: 2.5, ry: 1.5 }, body);
    el('path', { class: 'body', d: 'M-6.5,9 L-5.5,-3 Q0,-5.5 5.5,-3 L6.5,9 Z' }, body);          // chiton
    el('path', { class: 'chiton-fold', d: 'M-1,-4 L-2,9', stroke: 'rgba(40,25,10,.25)', 'stroke-width': 0.8, fill: 'none' }, body);
    el('rect', { class: 'belt', x: -5.8, y: 1.5, width: 11.6, height: 1.4, fill: 'rgba(40,25,10,.3)' }, body);
    el('circle', { class: 'pin', cx: -3.6, cy: -3.2, r: 1.1, fill: C.gold, stroke: 'rgba(40,25,10,.4)', 'stroke-width': 0.4 }, body);  // shoulder pin
    el('circle', { class: 'head', cy: -9.5, r: 6 }, body);
    el('circle', { class: 'eye', cx: -2.2, cy: -10, r: 0.9, fill: '#2a1f16' }, body);
    el('circle', { class: 'eye', cx: 2.2, cy: -10, r: 0.9, fill: '#2a1f16' }, body);
    el('path', { class: 'smile', d: 'M-1.6,-7.2 q1.6,1.4 3.2,0', stroke: '#2a1f16', 'stroke-width': 0.7, fill: 'none' }, body);
    const think = el('g', { class: 'think', transform: 'translate(13,-20)' }, body);
    el('ellipse', { rx: 9, ry: 6, fill: '#fffaf0', stroke: '#c9bcab', 'stroke-width': 0.6 }, think);
    el('circle', { cx: -4, r: 1.2, class: 'think-dot' }, think);
    el('circle', { cx: 0, r: 1.2, class: 'think-dot' }, think);
    el('circle', { cx: 4, r: 1.2, class: 'think-dot' }, think);
    el('circle', { cx: -7, cy: 6, r: 1.6, fill: '#fffaf0', stroke: '#c9bcab', 'stroke-width': 0.6 }, think);
    el('path', { class: 'cloak', d: 'M-8,10 L-5.5,-7 Q0,-21 5.5,-7 L8,10 Z', fill: '#2d2a44', stroke: '#15132a', 'stroke-width': 0.8 }, body);
    el('path', { class: 'cloak', d: 'M-5,-6 Q0,-16 5,-6 Q0,-3 -5,-6 Z', fill: '#0f0e1c' }, body);
    el('text', { class: 'cloak-rune', y: -7, 'text-anchor': 'middle', 'font-size': 7, fill: '#9fe8d8' }, body).textContent = laGlyphs('x', 1);
    // priest: long white robe with a gold hem, laurel wreath, staff
    el('path', { class: 'robe', d: 'M-8,11 L-5.5,-4 Q0,-7.5 5.5,-4 L8,11 Z' }, body);
    el('path', { class: 'robe-trim', d: 'M-8,11 L8,11 L7.6,9 L-7.6,9 Z', fill: C.gold, opacity: 0.9 }, body);
    el('line', { class: 'staff', x1: 10, y1: -17, x2: 10, y2: 10, stroke: C.wood, 'stroke-width': 1.3 }, body);
    el('circle', { class: 'staff', cx: 10, cy: -18.5, r: 2.2, fill: C.gold }, body);
    el('path', { class: 'wreath', d: 'M-6.5,-11 Q-3,-16.5 0,-15.5 Q3,-16.5 6.5,-11', fill: 'none', stroke: '#4F8A5B', 'stroke-width': 1.6, 'stroke-linecap': 'round' }, body);
    el('path', { class: 'wreath', d: 'M-5,-12.5 l1.5,-1.5 M-2.5,-14 l1,-1.8 M2.5,-14 l-1,-1.8 M5,-12.5 l-1.5,-1.5', stroke: '#6FA36E', 'stroke-width': 1.1, 'stroke-linecap': 'round' }, body);
    el('text', { class: 'rank-mark', y: -18.5, 'text-anchor': 'middle', 'font-size': 7 }, body);
    const flag = el('g', { class: 'commit-flag', transform: 'translate(-11,-14)' }, body);
    el('line', { x1: 0, y1: 0, x2: 0, y2: 12, stroke: C.woodDark, 'stroke-width': 1 }, flag);
    el('path', { d: 'M0,0 L7,2.5 L0,5 Z', fill: C.ochre, stroke: C.wood, 'stroke-width': 0.5 }, flag);
    const label = el('text', { class: 'name-label', y: 21 }, g);
    g._label = label;
    g._bob = body;
    g._phase = Math.random() * Math.PI * 2;
    return g;
  }
  function updateResident(rec, r, activeName, hasCommitment, hooded) {
    const g = rec.el;
    const color = safeColor(r.color, '#b8b0a6');
    g.querySelector('.body').setAttribute('fill', color);
    g.querySelector('.head').setAttribute('fill', hexMix(color, '#fff4e6', 0.45));
    g.querySelectorAll('.foot').forEach((f) => f.setAttribute('fill', hexMix(color, '#2a1f16', 0.45)));
    const name = hooded ? laGlyphs(r.name, 2) : String(r.name || '');
    if (g._label.textContent !== name) g._label.textContent = name;
    g.classList.toggle('hooded', !!hooded);
    if (hooded) g.querySelector('.cloak-rune').textContent = laGlyphs(r.name, 1);
    g.classList.toggle('disabled', r.enabled === false);
    g.classList.toggle('active', !!activeName && activeName === r.name);
    g.classList.toggle('committed', !!hasCommitment);
    const rank = r.rank === 'high' || r.rank === 'low' || r.rank === 'priest' ? r.rank : '';
    g.setAttribute('data-rank', rank);
    g.classList.toggle('priest', rank === 'priest');
    g.querySelector('.robe').setAttribute('fill', C.lime);
    const mark = hooded || rank === 'priest' ? '' : rank === 'high' ? '✦' : '';
    const mk = g.querySelector('.rank-mark');
    if (mk.textContent !== mark) mk.textContent = mark;
    setMoverTarget(rec, +r.x || 0, +r.y || 0);
  }

  // ---- workers = gods: 1.25× scale, marble-pale tunic with a trim in the tool colour, gold halo ----
  function createWorker(w) {
    const g = el('g', { class: 'worker', 'data-id': w.id });
    el('ellipse', { cy: 10, rx: 8, ry: 3, class: 'shadow' }, g);
    const body = el('g', { class: 'bob', transform: 'scale(1.25)' }, g);
    el('circle', { class: 'status-ring', r: 12.5, cy: -1 }, body);
    el('ellipse', { cx: -2.5, cy: 7.5, rx: 2, ry: 1.3, fill: '#8f8676' }, body);
    el('ellipse', { cx: 2.5, cy: 7.5, rx: 2, ry: 1.3, fill: '#8f8676' }, body);
    el('path', { class: 'body', d: 'M-5.5,8 L-4.5,-2.5 Q0,-4.5 4.5,-2.5 L5.5,8 Z', fill: C.marble, stroke: 'rgba(60,50,40,.3)', 'stroke-width': 0.7 }, body);
    el('path', { class: 'strap', d: 'M-4.5,-2.5 L4.5,-2.5 L4,-0.8 L-4,-0.8 Z', fill: C.gold, opacity: 0.85 }, body);
    el('rect', { class: 'trim', x: -5.5, y: 6.4, width: 11, height: 1.6, fill: '#e7a26b' }, body);
    el('circle', { class: 'head', cy: -8, r: 5, fill: '#f3d9b8' }, body);
    el('circle', { cx: -1.8, cy: -8.3, r: 0.8, fill: '#2a1f16' }, body);
    el('circle', { cx: 1.8, cy: -8.3, r: 0.8, fill: '#2a1f16' }, body);
    el('ellipse', { class: 'halo-glow', cy: -15.5, rx: 9, ry: 3.6, fill: C.gold, opacity: 0.22 }, body);
    el('ellipse', { class: 'halo', cy: -15.5, rx: 6.5, ry: 2.1, fill: 'none', stroke: C.gold, 'stroke-width': 1.4 }, body);
    el('path', { class: 'cloak', d: 'M-7,8 L-5,-6 Q0,-18 5,-6 L7,8 Z', fill: '#2d2a44', stroke: '#15132a', 'stroke-width': 0.8 }, body);
    el('path', { class: 'cloak', d: 'M-4.5,-5 Q0,-14 4.5,-5 Q0,-2 -4.5,-5 Z', fill: '#0f0e1c' }, body);
    el('text', { class: 'cloak-rune', y: -5.5, 'text-anchor': 'middle', 'font-size': 6, fill: '#9fe8d8' }, body).textContent = laGlyphs('w', 1);
    const bubble = el('g', { class: 'wait-bubble', transform: 'translate(11,-19)' }, body);
    el('circle', { r: 6.5, fill: '#f5b942', stroke: '#fff6dc', 'stroke-width': 1 }, bubble);
    el('circle', { cx: -5, cy: 5, r: 1.5, fill: '#f5b942' }, bubble);
    el('text', { y: 3, 'text-anchor': 'middle', 'font-size': 9, 'font-weight': 900, fill: '#2a1a0c' }, bubble).textContent = '!';
    g._bob = body;
    g._phase = Math.random() * Math.PI * 2;
    return g;
  }
  function updateWorker(rec, w) {
    const g = rec.el;
    const st = ['running', 'waiting', 'idle', 'stopped', 'error'].includes(w.status) ? w.status : 'idle';
    g.setAttribute('data-status', w.stale ? 'stale' : st);
    g.classList.toggle('hooded', !!w.sealed);
    if (w.sealed) g.querySelector('.cloak-rune').textContent = laGlyphs(w.id, 1);
    g.querySelector('.trim').setAttribute('fill', TOOL_COLORS[w.tool] || TOOL_COLORS.other);
    setMoverTarget(rec, +w.x || 0, +w.y || 0);
  }

  // ---- you ----
  let youRec = null;
  function ensureYou() {
    if (youRec) return youRec;
    const g = el('g', { class: 'you' }, layers.you);
    el('ellipse', { cy: 11, rx: 8, ry: 3, class: 'shadow' }, g);
    const body = el('g', { class: 'bob' }, g);
    el('circle', { class: 'you-ring', r: 15 }, body);
    el('ellipse', { cx: -3, cy: 10, rx: 2.5, ry: 1.5, fill: '#4a3a2a' }, body);
    el('ellipse', { cx: 3, cy: 10, rx: 2.5, ry: 1.5, fill: '#4a3a2a' }, body);
    el('path', { d: 'M-7,10 L-6,-3 Q0,-6 6,-3 L7,10 Z', fill: C.plaster, stroke: 'rgba(40,25,10,.3)', 'stroke-width': 1 }, body);
    el('rect', { x: -7, y: 3, width: 14, height: 2.5, fill: C.blue }, body);
    el('circle', { cx: -3.8, cy: -3.4, r: 1.1, fill: C.gold }, body);
    el('circle', { cy: -10, r: 6.2, fill: '#fbe8cf', stroke: 'rgba(40,25,10,.35)', 'stroke-width': 1 }, body);
    el('circle', { cx: -2.3, cy: -10.5, r: 0.95, fill: '#2a1f16' }, body);
    el('circle', { cx: 2.3, cy: -10.5, r: 0.95, fill: '#2a1f16' }, body);
    el('path', { d: 'M-1.8,-7.6 q1.8,1.6 3.6,0', stroke: '#2a1f16', 'stroke-width': 0.7, fill: 'none' }, body);
    el('path', { d: 'M-8,-11 Q0,-20 8,-11 Z', fill: C.plaster }, body);
    el('rect', { x: -10, y: -11.8, width: 20, height: 1.8, rx: 1, fill: C.wood }, body);
    el('text', { class: 'name-label you-label', y: 23 }, g).textContent = 'You';
    g._bob = body;
    g._phase = 0;
    youRec = { el: g };
    return youRec;
  }

  // ---- update from state ----
  let current = null;
  function update(state) {
    current = state || {};
    const now = Date.now();
    const places = Array.isArray(state.places) ? state.places : [];
    const workshops = Array.isArray(state.workshops) ? state.workshops : [];
    const plots = Array.isArray(state.plots) ? state.plots : [];
    const residents = Array.isArray(state.residents) ? state.residents : [];
    const workers = Array.isArray(state.workers) ? state.workers : [];
    const objects = Array.isArray(state.objects) ? state.objects : [];
    const trees = Array.isArray(state.trees) ? state.trees : [];
    const zones = Array.isArray(state.zones) ? state.zones : [];
    const sites = Array.isArray(state.sites) ? state.sites : [];
    const phase = state.world?.phase || 'morning';
    const active = state.world?.activeTurn?.resident || null;

    const hasIsle = zones.some((z) => z && z.id === 'isle') || (+state.world?.width || 0) > 1000;
    if (hasIsle) ensureIsle();
    setWorldSize(state.world?.width || (hasIsle ? 1700 : 1000), state.world?.height || 760);

    svg.setAttribute('data-phase', PHASE_TINT[phase] ? phase : 'morning');
    const [tc, to] = PHASE_TINT[phase] || PHASE_TINT.morning;
    tintRect.setAttribute('fill', tc);
    tintRect.setAttribute('opacity', to);

    buildPathsAndTrees(places, workshops, plots);
    sync(layers.plots, plots, (p) => p.id, createPlot, (rec, p) => rec.el.setAttribute('transform', `translate(${p.x},${p.y})`));
    // a site is "busy" (forge smoke) when a non-stale running god stands there
    const busySites = new Set(workers.filter((w) => w.status === 'running' && !w.stale && w.site).map((w) => w.site));
    const placeToSite = new Map(sites.filter((s) => s && s.placeId).map((s) => [s.placeId, s.id]));
    sync(layers.places, places, (p) => p.id, createPlace, (rec, p) => updatePlace(rec, p, busySites.has(placeToSite.get(p.id) || (p.kind === 'temple' ? 'temple' : p.kind === 'forge' ? 'forge' : p.kind === 'quarry' ? 'quarry' : p.kind === 'greatlibrary' ? 'library' : ''))));
    const busyByWs = new Map();
    for (const w of workers) if (w.status === 'running' && !w.stale) busyByWs.set(`${w.project}@${w.host}`, true);
    sync(layers.workshops, workshops, (w) => w.id, createWorkshop, (rec, w) => updateWorkshop(rec, w, busyByWs.get(`${w.project}@${w.host}`)));
    sync(layers.objects, objects, (o) => o.id, createObject, updateObject);
    sync(layers.sharedTrees, trees, treeKey, createSharedTree, (rec, t) => updateSharedTree(rec, t, now));
    sync(layers.workers, workers, (w) => w.id, createWorker, updateWorker);
    const seal = state.seal || {};
    const locked = !!(seal.enabled && seal.locked);
    svg.classList.toggle('sealed', locked);
    if (locked && hasIsle) updateSealDome(Array.isArray(seal.runes) ? seal.runes.map(String) : []); else removeSealDome();
    const committed = new Set((Array.isArray(state.commitments) ? state.commitments : []).filter((c) => c && c.status === 'active').map((c) => c.ownerId));
    sync(layers.residents, residents, (r) => r.name, createResident, (rec, r) => updateResident(rec, r, active, committed.has(r.name), r.mood === 'sealed' || (locked && zoneOf(r) === 'isle')));
    const h = state.human;
    if (h && Number.isFinite(+h.x) && Number.isFinite(+h.y)) {
      const rec = ensureYou();
      setMoverTarget(rec, +h.x, +h.y);
      rec.el.style.display = '';
    } else if (youRec) {
      youRec.el.style.display = 'none';
    }
    startLoop();
  }

  // ---- animation loop ----
  let running = false, lastT = 0;
  let viewAnim = null;
  function startLoop() {
    if (running) return;
    running = true;
    requestAnimationFrame(tick);
  }
  function tick(t) {
    const dt = Math.min(64, t - (lastT || t));
    lastT = t;
    const k = 1 - Math.pow(0.0025, dt / 1000);
    const time = t / 1000;
    for (const rec of movers) {
      if (!rec.el.isConnected) { movers.delete(rec); continue; }
      const c = rec.cur, tg = rec.target;
      const dx = tg.x - c.x, dy = tg.y - c.y;
      if (Math.abs(dx) > 0.05 || Math.abs(dy) > 0.05) {
        c.x += dx * k; c.y += dy * k;
        if (Math.abs(dx) < 0.1 && Math.abs(dy) < 0.1) { c.x = tg.x; c.y = tg.y; }
        rec.el.setAttribute('transform', `translate(${c.x.toFixed(2)},${c.y.toFixed(2)})`);
        rec.moving = true;
      } else if (rec.moving) {
        rec.moving = false;
        rec.el.setAttribute('transform', `translate(${tg.x},${tg.y})`);
      }
      const bob = rec.el._bob;
      if (bob) {
        const ph = rec.el._phase || 0;
        const walk = rec.moving ? Math.sin(time * 14 + ph) * 1.6 : 0;
        const idle = Math.sin(time * 1.6 + ph) * 0.9;
        const scale = rec.el.classList.contains('worker') ? ' scale(1.25)' : '';
        bob.setAttribute('transform', `translate(0,${(idle + walk).toFixed(2)})${scale}`);
      }
    }
    for (const [, rec] of layers.sharedTrees._recs || []) tickPetals(rec, dt, time);
    if (viewAnim) {
      const p = Math.min(1, (t - viewAnim.t0) / viewAnim.dur);
      const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      for (const key of ['x', 'y', 'w', 'h']) vb[key] = viewAnim.from[key] + (viewAnim.to[key] - viewAnim.from[key]) * e;
      if (p >= 1) viewAnim = null;
      applyVB();
    }
    requestAnimationFrame(tick);
  }

  // ---- view: zoom & pan ----
  function applyVB() {
    svg.setAttribute('viewBox', `${vb.x.toFixed(1)} ${vb.y.toFixed(1)} ${vb.w.toFixed(1)} ${vb.h.toFixed(1)}`);
    opts.onViewChange?.(viewInfo());
  }
  function clampVB() {
    vb.w = Math.max(220, Math.min(Math.max(1500, WORLD.w + 300), vb.w));
    vb.h = vb.w * (VILLAGE.h / VILLAGE.w);
    const mx = 260, my = 220;
    vb.x = Math.max(-mx, Math.min(WORLD.w + mx - vb.w, vb.x));
    vb.y = Math.max(-my, Math.min(WORLD.h + my - vb.h, vb.y));
  }
  function toWorld(cx, cy) {
    const m = svg.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = new DOMPoint(cx, cy).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  }
  function project(x, y) {
    const m = svg.getScreenCTM();
    const r = wrap.getBoundingClientRect();
    if (!m) return { left: 0, top: 0 };
    const p = new DOMPoint(x, y).matrixTransform(m);
    return { left: p.x - r.left, top: p.y - r.top, scale: m.a };
  }
  function viewInfo() {
    const cx = vb.x + vb.w / 2;
    return { center: { x: cx, y: vb.y + vb.h / 2 }, zone: cx > SEA_X + 75 ? 'isle' : 'village', vb: { ...vb } };
  }
  function zoneBounds(zoneId) {
    const z = (current?.zones || []).find((z) => z && z.id === zoneId);
    if (z && z.bounds) return { x: +z.bounds.x || 0, y: +z.bounds.y || 0, w: +z.bounds.w || 1000, h: +z.bounds.h || 760 };
    return zoneId === 'isle' ? ISLE.bounds : VILLAGE;
  }
  function panTo(zoneId, animate = true) {
    const b = zoneBounds(zoneId);
    const w = Math.max(VILLAGE.w, b.w + 80);
    const to = { w, h: w * (VILLAGE.h / VILLAGE.w) };
    to.x = b.x + b.w / 2 - to.w / 2;
    to.y = b.y + b.h / 2 - to.h / 2;
    if (zoneId === 'isle') to.x = Math.min(to.x, WORLD.w + 40 - to.w);
    if (!animate) { viewAnim = null; Object.assign(vb, to); clampVB(); applyVB(); return; }
    viewAnim = { from: { ...vb }, to, t0: performance.now(), dur: 900 };
    startLoop();
  }
  function zoomAt(cx, cy, factor) {
    viewAnim = null;
    const p = toWorld(cx, cy);
    vb.w *= factor; vb.h *= factor;
    vb.x = p.x - (p.x - vb.x) * factor;
    vb.y = p.y - (p.y - vb.y) * factor;
    clampVB(); applyVB();
  }
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const raw = (e.deltaMode === 1 ? e.deltaY * 20 : e.deltaY) * 0.0016;
    const f = Math.min(1.25, Math.max(0.8, Math.exp(raw)));
    zoomAt(e.clientX, e.clientY, f);
  }, { passive: false });

  const pointers = new Map();
  let drag = null;
  let pinch = null;
  svg.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    svg.setPointerCapture?.(e.pointerId);
    if (pointers.size === 1) {
      drag = { startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY, moved: false, target: e.target, button: e.button };
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      if (drag) drag.moved = true;
    }
  });
  svg.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      if (pinch.d > 0 && d > 0) zoomAt(mx, my, pinch.d / d);
      const m = svg.getScreenCTM();
      if (m) { vb.x -= (mx - pinch.mx) / m.a; vb.y -= (my - pinch.my) / m.d; clampVB(); applyVB(); }
      pinch = { d, mx, my };
      return;
    }
    if (!drag) return;
    const dx = e.clientX - drag.lastX, dy = e.clientY - drag.lastY;
    if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 4) {
      drag.moved = true;
      viewAnim = null;
      svg.classList.add('dragging');
    }
    if (drag.moved) {
      const m = svg.getScreenCTM();
      if (m) { vb.x -= dx / m.a; vb.y -= dy / m.d; clampVB(); applyVB(); }
    }
    drag.lastX = e.clientX; drag.lastY = e.clientY;
  });
  const endPointer = (e) => {
    const was = pointers.has(e.pointerId);
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (!was || !drag || pointers.size > 0) { if (pointers.size === 0) { drag = null; svg.classList.remove('dragging'); } return; }
    const d = drag; drag = null;
    svg.classList.remove('dragging');
    if (d.moved || d.button !== 0 || e.type === 'pointercancel') return;
    handleClick(d.target, e);
  };
  svg.addEventListener('pointerup', endPointer);
  svg.addEventListener('pointercancel', endPointer);

  function handleClick(target, e) {
    const t = target instanceof Element ? target : null;
    const res = t?.closest('.resident');
    if (res) return opts.onResidentClick?.(res.getAttribute('data-name'), res);
    const wk = t?.closest('.worker');
    if (wk) return opts.onWorkerClick?.(wk.getAttribute('data-id'), wk);
    const ob = t?.closest('.obj');
    if (ob) return opts.onObjectClick?.(ob.getAttribute('data-id'), ob);
    const tree = t?.closest('.shared-tree');
    if (tree) return opts.onTreeClick?.(tree.getAttribute('data-zone'), tree);
    const you = t?.closest('.you');
    if (you) return opts.onYouClick?.(you);
    const pl = t?.closest('.place');
    if (pl && opts.onPlaceClick) return opts.onPlaceClick(pl.getAttribute('data-id'), pl);
    const p = toWorld(e.clientX, e.clientY);
    if (p.x < -30 || p.y < -30 || p.x > WORLD.w + 30 || p.y > WORLD.h + 30) return;
    const x = Math.round(Math.max(0, Math.min(WORLD.w, p.x))), y = Math.round(Math.max(0, Math.min(WORLD.h, p.y)));
    opts.onGroundClick?.(x, y, zoneAt(x, y));
  }
  function zoneAt(x) { return x >= ISLE.bounds.x && isleBuilt ? 'isle' : 'village'; }

  let hovered = null;
  const HOVERABLE = '.resident, .worker, .obj, .place, .ws, .shared-tree';
  svg.addEventListener('pointerover', (e) => {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    const t = e.target instanceof Element ? e.target.closest(HOVERABLE) : null;
    if (!t || t === hovered) return;
    hovered = t;
    opts.onHover?.(hoverInfo(t), t);
  });
  svg.addEventListener('pointerout', (e) => {
    if (!hovered) return;
    const to = e.relatedTarget instanceof Element ? e.relatedTarget.closest(HOVERABLE) : null;
    if (to === hovered) return;
    hovered = null;
    opts.onHover?.(null);
  });
  function hoverInfo(t) {
    if (t.classList.contains('resident')) return { type: 'resident', id: t.getAttribute('data-name') };
    if (t.classList.contains('worker')) return { type: 'worker', id: t.getAttribute('data-id') };
    if (t.classList.contains('obj')) return { type: 'object', id: t.getAttribute('data-id') };
    if (t.classList.contains('place')) return { type: 'place', id: t.getAttribute('data-id') };
    if (t.classList.contains('ws')) return { type: 'workshop', id: t.getAttribute('data-id') };
    if (t.classList.contains('shared-tree')) return { type: 'tree', id: t.getAttribute('data-zone') };
    return null;
  }

  function entityPos(type, id) {
    const layer = { resident: layers.residents, worker: layers.workers, object: layers.objects, place: layers.places, workshop: layers.workshops, tree: layers.sharedTrees }[type];
    const rec = layer?._recs?.get(id);
    if (!rec) return null;
    if (rec.cur) return { x: rec.cur.x, y: rec.cur.y };
    const off = type === 'tree' ? (rec.el._layout?.P.h || 20) * 0.7 : 0;
    return { x: +rec.data.x || 0, y: (+rec.data.y || 0) - off };
  }
  function pulseAt(x, y) {
    const c = el('circle', { class: 'move-marker show', cx: x, cy: y, r: 4 }, layers.fx);
    setTimeout(() => c.remove(), 900);
  }
  function recenter() { panTo(viewInfo().zone, true); }
  function setView(v) {
    viewAnim = null;
    vb.x = +v.x || 0; vb.y = +v.y || 0; vb.w = +v.w || VILLAGE.w; vb.h = vb.w * (VILLAGE.h / VILLAGE.w);
    clampVB(); applyVB();
  }
  function setGiftMode(on) { svg.classList.toggle('gift-mode', !!on); }

  applyVB();
  return { update, project, toWorld, entityPos, pulseAt, recenter, panTo, setView, viewInfo, setGiftMode, get state() { return current; } };
}
