import { createBells } from './bell.js';
import { placeCard } from './card-place.js';
import { residentCard } from './cards.js';
const osLabel = os => ({ macos: 'macOS', windows: 'Windows', linux: 'Linux' }[os] || '');
// Amygdala front end entry: state, SSE, header controls, map callbacks, cards, gifts, feed,
// the Far Isle navigation, shared-tree cards, milestones, and the rune seal.
import { createMap, GIFT_KINDS, giftIconSVG } from './map.js';
import { createMap3D } from './map3d.js';
import * as map3d from './map3d.js';
import { createPanel, mountHeroTerminal, residentIdentity, stewardPane } from './panel.js';
import { h, agentClass, relTime, avatar, toast, capitalize, commitmentEl, runeTablet } from './util.js';
import { STAGE_NAMES, STAGE_THRESHOLDS, stageOf, stageProgress } from './trees.js';
import { zoneOf, laLine, LA_GLYPHS } from './svg-util.js';

const params = new URLSearchParams(location.search);
const MOCK = params.get('mock') === '1';
const AGENT_DECK_URL = 'http://127.0.0.1:8420';
const $ = (id) => document.getElementById(id);
if (params.get('theme') === 'light' || params.get('theme') === 'dark') document.documentElement.dataset.theme = params.get('theme');

let state = null;
let connected = false;
let expired = false;
// ?debug=1: surface runtime errors on the page (headless screenshots cannot show the console)
if (params.get('debug') === '1') {
  const box = document.createElement('pre');
  box.id = 'debug-log'; box.style.cssText = 'position:fixed;left:8px;top:70px;z-index:99;max-width:60vw;max-height:40vh;overflow:auto;background:rgba(0,0,0,.75);color:#9fe8d8;font:11px/1.3 monospace;padding:6px;white-space:pre-wrap';
  document.body.appendChild(box);
  const log = (m) => { box.textContent += m + '\n'; };
  window.addEventListener('error', (e) => log('error: ' + (e.message || e) + ' @' + (e.filename || '') + ':' + (e.lineno || '')));
  window.addEventListener('unhandledrejection', (e) => log('rejection: ' + (e.reason && (e.reason.stack || e.reason.message || e.reason))));
  window.__dbg = log;
}
// The server injects <meta name="hf-token"> when it serves index.html; every /api call carries it.
const TOKEN = MOCK ? "" : (document.querySelector('meta[name="hf-token"]')?.getAttribute('content') || '');
// The page speaks as the human (v0.45 governance records the actor; anything else with the token is the Steward).
const authHeaders = () => (TOKEN ? { 'X-Amygdala-Token': TOKEN, 'X-Amygdala-Source': 'human' } : {});
function sessionExpired() {
  if (expired) return;
  expired = true;
  connected = false;
  if (es) { es.close(); es = null; }
  clearTimeout(retryTimer);
  renderHeader();
  toast('Session expired — reload the page', true, 8000);
}

const hasIsle = () => !!state && (state.zones || []).some((z) => z && z.id === 'isle');
const sealLocked = () => !!(state?.seal?.enabled && state.seal.locked);

// ---------- API ----------
async function api(path, body, method = 'POST') {
  if (MOCK) return mockApi(path, body);
  try {
    const res = await fetch(path, { method, headers: { 'content-type': 'application/json', ...authHeaders() }, ...(method === 'POST' && { body: JSON.stringify(body || {}) }) });
    if (res.status === 401) { sessionExpired(); return { ok: false, error: 'Session expired — reload the page' }; }
    let data = null;
    try { data = await res.json(); } catch (_) { /* non-JSON reply */ }
    if (!res.ok || (data && data.ok === false)) {
      const msg = (data && data.error) || `Request failed (${res.status})`;
      toast(msg, true);
      return { ok: false, error: msg };
    }
    return data || true;
  } catch (err) {
    toast('Could not reach the village server', true);
    return { ok: false, error: 'Could not reach the village server' };
  }
}
const okResult = (r) => r === true || (r && r.ok !== false);

// ---------- Map ----------
const cardEl = $('card');
const card = { info: null, pinned: false };
const svg = $('map');
const wrap = $('map-wrap');
const zoneNav = $('zone-nav');
const FLAT = params.get('flat') === '1';
const mapOpts = {
  onFrame() { repositionCard(); },
  onGroundClick(x, y) {
    if (card.info) return closeCard();
    if (gift.active) return placeGift(x, y);
    map.pulseAt(x, y);
    api('/api/human/move', { x, y });
  },
  onResidentClick(name) { pinCard({ type: 'resident', id: name }); },
  onApprenticeClick(name, orderId) { panel.openOrder(orderId); setDrawer(true); },
  onGhostClick(ghost) { pinCard({ type: 'ghost', id: ghost.key, heroId: ghost.heroId, ghost }); },
  onWorkerClick(id) { pinCard({ type: 'worker', id }); },
  onObjectClick(id) { pinCard({ type: 'object', id }); },
  onPlaceClick(id) { openPlacePane(id); },
  onTreeClick(zone) { pinCard({ type: 'tree', id: zone }); },
  onYouClick() { pinCard({ type: 'you', id: 'you' }); },
  onHover(info) {
    map.setHover?.(info);
  },
  onViewChange(info) {
    repositionCard();
    if (info) zoneNav.textContent = info.zone === 'isle' ? '← Village' : 'Far Isle →';
    zoneNav.dataset.zone = info?.zone || 'village';
  },
};
async function makeMap() {
  if (!FLAT) {
    try {
      const m = await createMap3D($('map3d'), mapOpts);
      window.__dbg?.('3D map created');
      svg.hidden = true; svg.style.display = 'none';
      return m;
    } catch (err) {
      console.warn('3D map unavailable, using the flat map', err);
      window.__dbg?.('3D map unavailable: ' + (err && (err.stack || err.message || err)));
    }
  }
  $('map3d').hidden = true; $('map3d').style.display = 'none';
  svg.hidden = false; svg.style.display = '';
  return createMap(svg, mapOpts);
}
// Graphics quality is per browser (a laptop on battery and a desktop differ), so it lives in localStorage, not the world.
try { mapOpts.quality = localStorage.getItem('amygdala.gfx') || 'auto'; } catch (_) { /* private mode */ }
const map = await makeMap();
if (map.setQuality) {
  $('gfx-row').hidden = false; $('gfx').value = map.quality().pref;
  $('gfx').addEventListener('change', (e) => { map.setQuality(e.target.value); try { localStorage.setItem('amygdala.gfx', e.target.value); } catch (_) { /* private mode */ } });
}
$('recenter-btn').addEventListener('click', () => map.recenter());
zoneNav.addEventListener('click', () => {
  const to = zoneNav.dataset.zone === 'isle' ? 'village' : 'isle';
  map.panTo(to);
  if (to === 'isle' && panel.zone !== 'isle') panel.setZone('isle');
  if (to === 'village' && panel.zone !== 'village') panel.setZone('village');
});
setTimeout(() => $('map-hint').classList.add('fade'), 9000);

// ---------- Card ----------
function pinCard(info) {
  if (card.pinned && card.info && card.info.type === info.type && card.info.id === info.id) return closeCard();
  showCard(info, true);
}
function closeCard() { const root = card.root; card.root = null; root?.close(); card.info = null; card.pinned = false; cardEl.hidden = true; cardEl.textContent = ''; }
cardEl.addEventListener('click', (e) => { if (e.target.closest('.card-close')) closeCard(); });

function showCard(info, pinned) {
  if (!state) return;
  // Re-pinning from inside the old card keeps the first opener; the old card's nodes are about to be detached.
  const opener = cardEl.contains(document.activeElement) ? card.opener : document.activeElement; card.opener = opener;
  const content = buildCard(info);
  if (!content) return closeCard();
  card.root?.close({ restoreFocus: false });
  card.info = info; card.pinned = pinned;
  cardEl.textContent = '';
  const where = cardPlaceName(info);
  if (where) cardEl.append(h('div', { class: 'card-place', text: where }));
  cardEl.append(...content);
  cardEl.classList.toggle('wide', info.type === 'tree' || info.type === 'ghost');
  cardEl.appendChild(h('button', { class: 'btn btn-ghost btn-xs card-close', type: 'button', text: '✕', 'aria-label': 'Close' }));
  cardEl.hidden = false;
  card.root = info.type === 'resident' ? content[0] : null;
  card.root?.open(opener);
  card.size = { w: cardEl.offsetWidth, h: cardEl.offsetHeight };
  repositionCard();
}
// The map's place label, carried into the card as its top tag (the floating one would sit under the card).
function cardPlaceName(info) {
  const { type, id } = info;
  let placeId = null;
  if (type === 'tree') placeId = 'green';
  else if (type === 'resident') placeId = (state.residents || []).find((x) => x && x.name === id)?.placeId;
  else if (type === 'object') placeId = (state.objects || []).find((x) => x && x.id === id)?.placeId;
  else if (type === 'worker') {
    const w = (state.workers || []).find((x) => x && x.id === id);
    if (w && zoneOf(w) !== 'isle') placeId = (state.sites || []).find((x) => x.id === w.site)?.placeId;
  }
  const place = placeId && (state.places || []).find((p) => p.id === placeId);
  return place && zoneOf(place) !== 'isle' ? place.name : null;
}
let cardBounds = null, cardObstacles = [];
function refreshCardBounds() {
  const r = wrap.getBoundingClientRect(), header = document.querySelector('header.topbar').getBoundingClientRect();
  cardBounds = { left: 0, top: header.bottom - r.top, right: r.width, bottom: r.height };
  cardObstacles = [];
  if (drawerOpen) {
    const d = $('drawer').getBoundingClientRect();
    // Reserve the drawer's final position even while its opening transform is animating.
    cardObstacles.push({ left: window.innerWidth - d.width - r.left, top: d.top - r.top, right: window.innerWidth - r.left, bottom: d.bottom - r.top });
  }
}
window.addEventListener('resize', () => { refreshCardBounds(); repositionCard(); });
const cardLayoutObserver = new ResizeObserver(() => { refreshCardBounds(); repositionCard(); });
for (const el of [wrap, document.querySelector('header.topbar'), $('drawer')]) cardLayoutObserver.observe(el);
function repositionCard() {
  if (cardEl.hidden || !card.info) return;
  const pos = card.info.type === 'you' ? (state.human || null) : map.entityPos(card.info.type, card.info.id);
  if (!pos) return closeCard();
  if (!cardBounds) refreshCardBounds();
  const above = map.project(pos.x, pos.y - 16), below = map.project(pos.x, pos.y + 20);
  const p = placeCard({ above: { x: above.left, y: above.top }, below: { x: below.left, y: below.top }, size: card.size, bounds: cardBounds, obstacles: cardObstacles });
  cardEl.style.left = `${p.left}px`; cardEl.style.top = `${p.top}px`;
  cardEl.classList.toggle('below', p.below); cardEl.classList.toggle('docked', p.docked);
}
function zoneChip(item) {
  return zoneOf(item) === 'isle' ? h('span', { class: 'chip chip-isle', text: 'isle' }) : null;
}
function wakeResident(name) { return api(`/api/residents/${encodeURIComponent(name)}/wake`, {}).then((ok) => { if (okResult(ok)) toast(`Waking ${name}…`); }); }
const residentActions = {
  onClose: closeCard, onWake: wakeResident,
  onDetails: name => { setDrawer(true, 'residents'); panel.showResident(name); },
  onOrder: name => { setDrawer(true, 'orders'); panel.orderTo(name); },
  onFollow: (name, on) => map.follow(on ? name : null),
  isFollowing: name => map.following(name),
};
function buildCard(info) {
  const { type, id } = info;
  if (type === 'ghost') {
    if (SHOT || state.visitor || sealLocked()) return null;
    const g = (state.isleGhosts || []).find(g => g.key === id && g.heroId === info.heroId) || (MOCK ? info.ghost : null);
    if (!g || !(state.workers || []).some(w => w.id === g.heroId && w.zone === 'isle' && !w.sealed)) return null;
    return [h('div', { class: 'card-head' }, h('div', { class: 'card-name', text: 'Isle ghost' })), h('div', { class: 'card-sub', text: `${g.model} · ${g.agentType} · ${g.finished ? 'finished' : 'running'}` }), h('div', { class: 'card-row', text: new Date(g.startedAt).toLocaleString() }), h('pre', { class: 'card-row ghost-prompt', text: g.prompt }), ...(g.actions || []).map(a => h('div', { class: 'card-row ghost-action', text: `${new Date(a.ts).toLocaleTimeString()} · ${a.tool}: ${a.summary}` }))];
  }
  if (type === 'resident') {
    const r = (state.residents || []).find((x) => x && x.name === id);
    if (!r) return null;
    return [residentCard(r, state, residentActions, { embedded: true })];
  }
  if (type === 'worker') {
    const w = (state.workers || []).find((x) => x && x.id === id);
    if (!w) return null;
    const st = String(w.status || 'idle');
    const stale = !!w.stale;
    const milestone = h('button', { class: 'btn btn-xs', type: 'button', text: 'Share a milestone 🌸' });
    milestone.disabled = !!w.sealed;
    milestone.addEventListener('click', () => openMilestone(w.project, w.host));
    return [
      h('div', { class: 'card-head' }, h('div', {},
        h('div', { class: `card-name ${w.sealed ? 'runic' : ''}` }, w.sealed ? '🔒 ' : '', String(w.title || w.id)),
        h('div', { class: 'card-sub' },
          h('span', { class: `chip ${agentClass(w.tool)}`, text: String(w.tool || 'tool') }), ' ',
          stale
            ? h('span', { class: 'pill pill-stale', text: `last seen ${relTime(w.updatedAt) || 'a while ago'}` })
            : h('span', { class: `pill pill-${st}`, text: st === 'waiting' ? 'waiting for you' : st }), ' ', zoneChip(w)))),
      w.site && zoneOf(w) !== 'isle' ? h('div', { class: 'card-row', text: `at ${siteLabel(w.site)} · ${w.siteReason || ''}` }) : null,
      stale ? h('div', { class: 'card-row dim-note', text: 'Agent Deck could not reach this session on its last poll. It may still be running.' }) : null,
      w.sealed ? h('div', { class: 'card-row dim-note', text: 'This hero is quarantined behind the seal; its details are encrypted.' }) : null,
      h('div', { class: 'card-row' }, h('b', { text: 'Project ' }), h('span', { class: w.sealed ? 'runic' : '', text: String(w.project || '—') })),
      h('div', { class: 'card-row' }, h('b', { text: 'Host ' }), h('span', { class: w.sealed ? 'runic' : '', text: String(w.host || 'local') + (w.os ? ` · ${osLabel(w.os)}` : '') })),
      w.sealed ? null : h('div', { class: 'card-row worker-path', text: String(w.path || '') }),
      stale ? null : h('div', { class: 'card-row' }, h('span', { class: 'post-time', text: `updated ${relTime(w.updatedAt)}` })),
      !w.node && state?.world?.terminalReason ? h('div', { class: 'dim-note', text: state.world.terminalReason }) : null,
      h('div', { class: 'card-actions' }, canOpenTerminal(w) ? h('button', { class: 'btn btn-xs', type: 'button', text: 'Terminal ▸', onClick: () => openTerminal(w) }) : null, h('a', { class: 'btn btn-primary', href: AGENT_DECK_URL, target: '_blank', rel: 'noopener', text: 'Open in Agent Deck ↗' }), milestone, endLabourButton(w), h('button', { class: 'btn btn-xs', type: 'button', text: 'Tell the tale', disabled: !!w.sealed, onClick: () => tellTale(w.id) })),
    ].filter(Boolean);
  }
  if (type === 'object') {
    const o = (state.objects || []).find((x) => x && x.id === id);
    if (!o) return null;
    return [
      h('div', { class: 'card-head' }, h('div', {},
        h('div', { class: 'card-name', text: capitalize(o.kind || 'gift') }),
        h('div', { class: 'card-sub', text: `left by ${o.author || 'someone'} · ${relTime(o.ts)}` }))),
      o.note ? h('div', { class: 'card-quote', text: String(o.note) }) : null,
    ].filter(Boolean);
  }
  if (type === 'place') {
    const p = (state.places || []).find((x) => x && x.id === id);
    if (!p) return null;
    const here = (state.residents || []).filter((r) => r && r.placeId === p.id).map((r) => r.name);
    return [
      h('div', { class: 'card-head' }, h('div', {},
        h('div', { class: 'card-name', text: String(p.name || p.id) }),
        h('div', { class: 'card-sub', text: `${p.kind || ''}${p.keeper ? ` · kept by ${p.keeper}` : ''}${p.builtBy ? ` · built by ${p.builtBy}` : ''}${zoneOf(p) === 'isle' ? ' · the Far Isle' : ''}` }))),
      p.description ? h('div', { class: 'card-quote', text: String(p.description) }) : null,
      here.length ? h('div', { class: 'card-row' }, h('b', { text: 'Here now: ' }), here.join(', ')) : null,
    ].filter(Boolean);
  }
  if (type === 'tree') return buildTreeCard(id);
  if (type === 'you') {
    const place = (state.places || []).find((x) => x && x.id === state.human?.placeId);
    return [
      h('div', { class: 'card-head' }, h('div', {},
        h('div', { class: 'card-name', text: 'You' }),
        h('div', { class: 'card-sub', text: place ? `at ${place.name}` : zoneOf(state.human) === 'isle' ? 'on the Far Isle' : 'wandering' }))),
      h('div', { class: 'card-row', text: 'Click the ground to walk somewhere. Leave a gift with the button above.' }),
    ];
  }
  return null;
}
function buildTreeCard(zone) {
  const t = (state.trees || []).find((x) => x && zoneOf(x) === zone);
  if (!t) return null;
  const name = String(t.name || (zone === 'isle' ? 'The Salt Pine' : 'The Cherry'));
  if (t.sealed) {
    return [
      h('div', { class: 'card-head' }, h('div', {}, h('div', { class: 'card-name', text: name }), h('div', { class: 'card-sub', text: 'sealed · no growth data' }))),
      runeTablet(state.seal?.runes, { title: 'The pine stands behind the seal', compact: true, onBreak: () => openSeal('unlock') }),
    ];
  }
  const stage = stageOf(t);
  const prog = stageProgress(t);
  const credits = Math.max(0, +t.lifetimeCredits || 0);
  const next = Number.isFinite(+t.nextStageAt) ? +t.nextStageAt : STAGE_THRESHOLDS[stage + 1];
  const colorFor = (n) => (state.residents || []).find((r) => r && r.name === n)?.color || (n === 'You' ? 'var(--human)' : null);
  const branches = (Array.isArray(t.branches) ? t.branches : []).filter((b) => b && b.id);
  const recent = (Array.isArray(t.recent) ? t.recent : []).slice(-5).reverse();
  const tended = Array.isArray(t.tendedToday) ? t.tendedToday.filter(Boolean).map(String) : [];
  const out = [
    h('div', { class: 'card-head' }, h('div', {},
      h('div', { class: 'card-name', text: name }),
      h('div', { class: 'card-sub' }, h('span', { class: 'chip chip-tree', text: String(t.stageName || STAGE_NAMES[stage]) }), ' ', `${credits} lifetime credits`))),
    h('div', { class: 'tree-progress' },
      h('div', { class: 'tree-bar' }, h('span', { class: 'tree-fill', style: { width: `${Math.round(prog * 100)}%` } })),
      h('div', { class: 'tree-progress-text', text: stage >= 4 || !Number.isFinite(next) ? 'fully grown — it only gets older now' : `${credits}/${next} to ${STAGE_NAMES[stage + 1] || 'the next stage'}` })),
    h('div', { class: 'card-row' }, h('b', { text: `${Math.max(0, +t.blossoms || 0)} blossoms open` }), zone === 'isle' ? ' · pale lights in the needles' : ' · they fall after three days'),
  ];
  if (branches.length) {
    const list = h('div', { class: 'branch-list' });
    for (const b of branches) {
      const avs = h('span', { class: 'branch-avatars' });
      for (const c of (Array.isArray(b.contributors) ? b.contributors : []).slice(0, 6)) avs.appendChild(avatar(c, colorFor(c), 'xs'));
      list.appendChild(h('div', { class: 'branch-row' },
        h('span', { class: 'branch-name', text: String(b.name || b.id) }),
        avs,
        h('span', { class: 'branch-credits', text: `${+b.credits || 0}` }),
        h('span', { class: 'branch-marks', title: `${b.fruit ? 'bearing fruit' : ''}${b.keepsake ? ' · keepsake' : ''}`.trim() }, b.fruit ? (zone === 'isle' ? '🌰' : '🍒') : '', b.keepsake ? '🎀' : ''),
        b.keepsake?.note ? h('div', { class: 'branch-keepsake', text: `“${String(b.keepsake.note).slice(0, 120)}” — ${b.keepsake.by || 'someone'}` }) : null,
      ));
    }
    out.push(h('div', { class: 'card-section-title', text: `${branches.length} branch${branches.length === 1 ? '' : 'es'}` }), list);
  } else {
    out.push(h('div', { class: 'card-row dim-note', text: 'No branches yet. The first finished project will grow one.' }));
  }
  if (recent.length) {
    out.push(h('div', { class: 'card-section-title', text: 'Recently grew' }));
    for (const r of recent) out.push(h('div', { class: 'card-row recent-row' }, h('span', { class: 'recent-amt', text: `+${+r.amount || 0}` }), ' ', String(r.reason || ''), h('span', { class: 'post-time', text: ` · ${relTime(r.awardedAt)}` })));
  }
  const tendedRow = h('div', { class: 'card-row tended' }, h('b', { text: 'Tended today: ' }));
  if (tended.length) for (const n of tended) tendedRow.append(avatar(n, colorFor(n), 'xs'), h('span', { class: 'tended-name', text: n }));
  else tendedRow.append(h('span', { class: 'dim-note', text: 'nobody yet' }));
  out.push(tendedRow);
  return out;
}

// ---------- Gifts ----------
const gift = { active: false, kind: 'flowers' };
const giftForm = $('gift-form');
const giftKinds = $('gift-kinds');
for (const kind of GIFT_KINDS) {
  const b = h('button', { class: 'gift-kind', type: 'button', role: 'radio', 'aria-checked': kind === gift.kind ? 'true' : 'false', dataset: { kind } });
  b.innerHTML = giftIconSVG(kind); // static art only
  b.appendChild(h('span', { text: kind }));
  b.addEventListener('click', () => {
    gift.kind = kind;
    for (const x of giftKinds.children) x.setAttribute('aria-checked', x.dataset.kind === kind ? 'true' : 'false');
  });
  giftKinds.appendChild(b);
}
$('gift-btn').addEventListener('click', () => setGiftMode(!gift.active));
$('gift-cancel').addEventListener('click', () => setGiftMode(false));
function setGiftMode(on) {
  gift.active = on;
  giftForm.hidden = !on;
  map.setGiftMode(on);
  $('gift-btn').textContent = on ? 'Placing a gift…' : '+ Leave a gift';
  if (on) closeCard();
}
async function placeGift(x, y) {
  const note = $('gift-note').value.trim();
  map.pulseAt(x, y);
  const ok = await api('/api/human/gift', { kind: gift.kind, note, x, y });
  if (okResult(ok)) { toast(`You left ${gift.kind === 'artwork' ? 'an' : 'a'} ${gift.kind}.`); $('gift-note').value = ''; setGiftMode(false); }
}

// ---------- Panel ----------
const panel = createPanel({
  api,
  onTellTale: tellTale,
  endLabourButton,
  canOpenTerminal,
  onTerminal: openTerminal,
  onViewChange: syncTerminalWidth,
  onPost: ({ text, channel, replyTo, zone }) => api('/api/human/post', { text, channel, replyTo: replyTo || null, zone }),
  onToggleResident: (name, enabled) => api(`/api/residents/${encodeURIComponent(name)}`, { enabled }),
  onHibernate: (name, on) => api(`/api/residents/${encodeURIComponent(name)}/hibernate`, { on }),
  onWake: wakeResident,
  onQuarantine: (project, host, on) => api('/api/quarantine', { project, host, on }).then((ok) => { if (okResult(ok)) toast(on ? `${project} is quarantined on the isle.` : `${project} is back in The Works.`); }),
  onMilestone: (project, host) => openMilestone(project, host),
  onDecide: openDecide,
  onFocusWorker: (id) => { const w = (state?.workers || []).find((x) => x.id === id); if (w) pinCard({ type: 'worker', id }); },
  onBreakSeal: () => openSeal('unlock'),
  onSetupSeal: () => openSeal('setup'),
  onZoneChange: (zone) => { if (map.viewInfo().zone !== zone) map.panTo(zone); },
  onOffer: (w) => openOffering(w),
  onCommand: (o) => openCommand(o),
  onCloseOffering: (o) => api('/api/temple/close', { offeringId: o.id }).then((ok) => { if (okResult(ok)) toast('Offering closed.'); }),
  onFindingStatus: (id, status) => api('/api/findings/status', { id, status }).then((ok) => { if (okResult(ok)) toast(status === 'decreed' ? 'Decreed. The session will hear of it.' : status === 'fixed' ? 'Confirmed fixed. The tree grows. 🌸' : 'Set aside.'); }),
  onDecreeMode: (mode) => api('/api/temple/decree-mode', { mode }),
  onOmenCount: (n) => renderOmenChip(n),
  onCommission: () => openCommission(),
  onPetitionHero: (p) => openCommission(p),
  onMoveSite: (workerId, site) => api('/api/workers/site', { workerId, site }).then((ok) => { if (okResult(ok)) toast(site === 'auto' ? 'Automatic placement enabled.' : `Moved to ${siteLabel(site)}.`); }),
  onCounsel: (id, action) => api('/api/counsel', { id, action }).then((ok) => { if (okResult(ok)) toast(action === 'relay' ? 'Counsel relayed to the hero (fenced as untrusted).' : 'Counsel dismissed.'); }),
  onDig: (f) => openDig(f),
  onCounselCount: (n) => { const b = $('counsel-chip'); if (b) { b.hidden = !n; $('counsel-chip-text').textContent = `${n} counsel`; } },
});
// The endpoint acknowledges immediately; snapshots carry the eventual tale and feed errors.
let endingLabour = null;
function endLabourButton(w) {
  const remote = !!w.bridge || (!w.node && w.host !== 'local');
  return h('button', { class: 'btn btn-xs', type: 'button', text: endingLabour?.id === w.id ? 'Ending labour…' : 'End labour',
    disabled: remote || !!w.sealed || (zoneOf(w) === 'isle' && sealLocked()) || w.status === 'stopped' || !!endingLabour,
    title: remote ? 'End this hero in its own window; its tale is written when it stops.' : 'Ask for a wrap-up, stop the hero, and record a tale',
    onClick: () => openEndLabour(w) });
}
function openEndLabour(w) {
  const dialog = $('end-labour-dialog');
  const message = $('end-labour-message');
  const submit = $('end-labour-submit');
  $('end-labour-title').textContent = `End labour — ${w.title || w.id}`;
  message.textContent = "End this hero's labour? They'll be asked to wrap up, then stopped, and a tale will be written.";
  submit.hidden = false; submit.disabled = false;
  submit.onclick = async () => {
    if (endingLabour) return;
    submit.disabled = true;
    endingLabour = { id: w.id, zone: zoneOf(w), tales: new Set((state.tales || []).map((t) => t.id)), feed: new Set((state.feed || []).map((f) => f.id)), dialog };
    message.textContent = 'Requesting wrap-up…';
    const result = await api('/api/tales/end', { workerId: w.id });
    if (!okResult(result)) {
      endingLabour = null; message.textContent = result?.error || 'Could not end the labour.'; submit.disabled = false;
    } else if (endingLabour?.id === w.id) {
      submit.hidden = true;
      message.textContent = 'Wrapping up… The hero will stop after replying, then its tale will be recorded. Progress also appears in Happening now.';
      updateEndLabour();
    }
    panel.update(state);
    if (card.info?.type === 'worker') showCard(card.info, card.pinned);
  };
  dialog.showModal();
}
// The human's final decision on an offering (the same override route the ledger records as by the human).
function openDecide(r) {
  const dialog = $('decide-dialog'), reason = $('decide-reason'), err = $('decide-error');
  $('decide-title').textContent = `Decide — ${r.title || r.project || r.offeringId}`;
  $('decide-sub').textContent = `${r.project || ''} ${String(r.sha || '').slice(0, 12)} · ${r.offeringId}`;
  reason.value = ''; err.hidden = true;
  for (const b of dialog.querySelectorAll('[data-verdict]')) b.onclick = async () => {
    if (reason.value.trim().length < 10) { err.textContent = 'Give a reason of at least 10 characters.'; err.hidden = false; reason.focus(); return; }
    const result = await api('/api/governance/override', { offeringId: r.offeringId, verdict: b.dataset.verdict, reason: reason.value.trim() });
    if (!okResult(result)) { err.textContent = result?.error || 'The Temple refused that decision.'; err.hidden = false; return; }
    dialog.close(); toast(b.dataset.verdict === 'accept' ? 'Accepted: the Steward will deploy it.' : 'Not accepted: it stays unshipped.');
  };
  dialog.showModal(); reason.focus();
}
function updateEndLabour() {
  if (!endingLabour || !state) return;
  const job = endingLabour;
  const tale = (state.tales || []).find((t) => t.heroId === job.id && !job.tales.has(t.id));
  const failure = (state.feed || []).find((f) => !job.feed.has(f.id) && String(f.text || '').startsWith('Ending the labour failed:'));
  if (!tale && !failure) return;
  const message = tale
    ? `Labour recorded. ${tale.tale?.title || 'The bard has been summoned to write the tale.'}`
    : String(failure.text);
  $('end-labour-message').textContent = message;
  $('end-labour-submit').hidden = true;
  toast(message, !tale, 8000);
  endingLabour = null;
}
async function tellTale(workerId) {
  const result = await api('/api/tales/complete', { workerId });
  if (okResult(result)) toast('The labour is recorded; the bard has been summoned.');
}
function siteLabel(id) { return (state?.sites || []).find((s) => s && s.id === id)?.label || id; }
$('counsel-chip').addEventListener('click', () => setDrawer(true, 'workshop'));
const omenChip = $('omen-chip');
omenChip.addEventListener('click', () => setDrawer(true, 'workshop'));
function renderOmenChip(n) {
  omenChip.hidden = !n;
  $('omen-chip-text').textContent = `${n} ${n === 1 ? 'omen' : 'omens'}`;
}
// ---------- Milestone dialog ----------
const milestoneDialog = $('milestone-dialog');
let noteDialogCfg = null;
function openNoteDialog(cfg) {
  noteDialogCfg = cfg;
  $('milestone-title').textContent = cfg.title;
  $('milestone-sub').textContent = cfg.sub || '';
  $('milestone-text').textContent = cfg.text || '';
  $('milestone-note').placeholder = cfg.placeholder || '';
  $('milestone-submit').textContent = cfg.submit || 'Share';
  $('milestone-note').value = '';
  $('milestone-error').hidden = true;
  milestoneDialog.showModal();
  $('milestone-note').focus();
}
function openMilestone(project, host) {
  const target = { project: String(project || ''), host: String(host || 'local') };
  openNoteDialog({
    title: 'Share a milestone 🌸', sub: `${target.project} @ ${target.host}`, placeholder: 'what happened?', submit: 'Share',
    text: 'Something real got done out there. Tell the village in a line; the project\u2019s branch on the shared tree grows and opens blossoms.',
    onSubmit: (note) => api('/api/tree/milestone', { ...target, note }), done: 'The tree grew a little. 🌸',
  });
}
function openOffering(w) {
  openNoteDialog({
    title: 'Lay an offering', sub: `${w.title || w.id} · ${w.project || ''} @ ${w.host || 'local'}${w.os ? ` · ${osLabel(w.os)}` : ''}`, placeholder: 'what should reviewers know? (optional)', submit: 'Lay it on the altar',
    text: 'Snapshots this session\u2019s current git change as an offering. Low-ranked residents may pick it up; you can command others to review it.',
    onSubmit: (note) => api('/api/temple/offer', { workerId: w.id, note }), done: 'The offering is laid. Reviewers will come.',
  });
}
$('milestone-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!noteDialogCfg) return;
  const note = $('milestone-note').value.trim();
  $('milestone-submit').disabled = true;
  const res = await noteDialogCfg.onSubmit(note);
  $('milestone-submit').disabled = false;
  if (okResult(res)) { milestoneDialog.close(); toast(noteDialogCfg.done || 'Done.'); }
  else { const err = $('milestone-error'); err.textContent = (res && res.error) || 'That did not work.'; err.hidden = false; }
});
// command a review
const commandDialog = $('command-dialog');
let commandTarget = null;
function openCommand(o) {
  commandTarget = o;
  $('command-sub').textContent = `${o.title || o.id} · ${o.project || ''} @ ${o.host || 'local'}`;
  $('command-note').value = '';
  $('command-error').hidden = true;
  const list = $('command-residents');
  list.textContent = '';
  const residents = (state?.residents || []).filter((r) => r && r.name && zoneOf(r) === zoneOf(o) && r.mood !== 'sealed');
  for (const r of residents) {
    const id = `cmd-${r.name}`;
    list.appendChild(h('label', { class: 'command-resident', for: id },
      h('input', { type: 'checkbox', id, value: r.name }),
      avatar(r.name, r.color, 'xs'), h('span', { class: 'person', text: r.name }),
      r.rank ? h('span', { class: `chip chip-rank rank-${r.rank}`, text: r.rank === 'priest' ? '☀ priest' : r.rank === 'high' ? '✦ high' : 'low' }) : null));
  }
  if (!residents.length) list.appendChild(h('div', { class: 'dim-note', text: 'Nobody is in this zone to command.' }));
  commandDialog.showModal();
}
async function sendCommand(residents) {
  if (!commandTarget) return;
  const note = $('command-note').value.trim();
  $('command-submit').disabled = true; $('command-all').disabled = true;
  const res = await api('/api/temple/command', { offeringId: commandTarget.id, residents, note });
  $('command-submit').disabled = false; $('command-all').disabled = false;
  if (okResult(res)) { commandDialog.close(); toast(residents === 'all' ? 'The village is summoned.' : `${residents.join(', ')} commanded.`); }
  else { const err = $('command-error'); err.textContent = (res && res.error) || 'The command was not heard.'; err.hidden = false; }
}
$('command-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const picked = [...$('command-residents').querySelectorAll('input:checked')].map((i) => i.value);
  if (!picked.length) { const err = $('command-error'); err.textContent = 'Pick at least one resident, or summon the village.'; err.hidden = false; return; }
  sendCommand(picked);
});
$('command-all').addEventListener('click', () => sendCommand('all'));
for (const d of [$('end-labour-dialog'), $('decide-dialog'), milestoneDialog, commandDialog, $('commission-dialog'), $('dig-dialog'), $('credits-dialog'), $('seal-dialog')]) {
  d.querySelector('[data-close]').addEventListener('click', () => d.close());
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
}

// ---------- Dig: descend from an inscription to the god's answer ----------
const digDialog = $('dig-dialog');
async function openDig(f) {
  const layers = $('dig-layers');
  layers.textContent = '';
  $('dig-actions').textContent = '';
  $('dig-error').hidden = true;
  $('dig-title').textContent = `Dig · ${f.severity || ''} · ${f.file || '?'}${f.line != null ? `:${f.line}` : ''}`;
  $('dig-sub').textContent = String(f.claim || '');
  layers.appendChild(h('div', { class: 'dim-note', text: 'Brushing the dust off…' }));
  digDialog.showModal();
  let trail = null;
  try {
    if (MOCK) trail = mockTrail(f);
    else {
      const res = await fetch(`/api/omens/${encodeURIComponent(f.id)}/trail`, { headers: authHeaders() });
      if (res.status === 401) { sessionExpired(); throw new Error('Session expired — reload the page'); }
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || data.ok === false) throw new Error((data && data.error) || `Request failed (${res.status})`);
      trail = data.trail;
    }
  } catch (err) {
    layers.textContent = '';
    const e = $('dig-error'); e.textContent = String(err.message || err); e.hidden = false;
    return;
  }
  layers.textContent = '';
  renderTrail(f, trail || {});
}
function renderTrail(f, t) {
  const layers = $('dig-layers');
  const mk = (depth, title, body, stone) => {
    const L = h('div', { class: `dig-layer ${stone ? 'stone' : ''}` },
      h('div', { class: 'dig-layer-head' }, h('span', { class: 'depth', text: `${depth}` }), h('span', { text: title }), h('span', { class: 'arrow', text: '▸' })),
      h('div', { class: 'dig-layer-body' }, body));
    L.querySelector('.dig-layer-head').addEventListener('click', () => L.classList.toggle('open'));
    return L;
  };
  const deeper = (L) => { const b = h('button', { class: 'btn btn-ghost btn-xs', type: 'button', text: 'Dig deeper ↓' }); b.addEventListener('click', () => { const n = L.nextElementSibling; if (n) { n.classList.add('open'); n.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } }); return b; };
  // 1 inscription
  const insc = t.inscription || f.inscription || '';
  const L1 = mk('Ⅰ', 'The inscription', h('div', {}, h('div', { class: 'dig-inscription', lang: 'und', text: insc ? Array.from(String(insc)).join('') : '— nothing inscribed yet —' }), h('div', { class: 'dim-note', text: 'Linear B · 43 syllabograms, six bits each: the omen\u2019s SHA-256, readable by anyone who knows the key.' })), true);
  L1.classList.add('open');
  L1.querySelector('.dig-layer-body').appendChild(deeper(L1));
  layers.appendChild(L1);
  // 2 deciphered + chain + drift
  const chain = t.chain || {};
  const drift = Array.isArray(t.drift) ? t.drift : (t.drift && typeof t.drift === 'object' ? Object.keys(t.drift) : []);
  const b2 = h('div', {},
    h('div', {}, h('b', { text: 'Deciphered: ' }), h('span', { class: 'hash', text: String(t.deciphered || '—') })),
    h('div', { style: { marginTop: '8px' } }, chain.ok === false
      ? h('span', { class: 'chain-seal broken', text: `⛓ broken at ${chain.id || (chain.at != null ? `#${chain.at}` : '?')}: ${chain.reason || 'hash mismatch'}` })
      : h('span', { class: 'chain-seal ok', text: `⛓ chain unbroken${Number.isFinite(+chain.entries) ? ` · ${chain.entries} entries` : ''}` })),
    drift.length ? h('div', { class: 'drift' }, h('b', { text: 'Drift: ' }), `the live finding no longer matches what was inscribed in: ${drift.map(String).join(', ')}`) : h('div', { class: 'dim-note', style: { marginTop: '6px' }, text: 'No drift: the live finding still matches its inscription.' }));
  const L2 = mk('Ⅱ', 'Deciphered', b2); L2.querySelector('.dig-layer-body').appendChild(deeper(L2)); layers.appendChild(L2);
  // 3 records
  const entries = (Array.isArray(t.entries) ? t.entries : []).slice().sort((a, b) => (+a.ts || 0) - (+b.ts || 0));
  const b3 = h('div', {});
  if (!entries.length) b3.appendChild(h('div', { class: 'dim-note', text: 'No inscribed records.' }));
  for (const e of entries) {
    b3.appendChild(h('div', { class: 'record' },
      h('div', { class: 'record-head' }, h('span', { class: `pill pill-status status-${e.event === 'delivered' ? 'decreed' : e.event}`, text: String(e.event || 'event') }), h('span', { class: 'post-time', text: relTime(e.ts) }), h('span', { class: 'hash', text: String(e.hash || '').slice(0, 12) })),
      h('pre', { text: JSON.stringify(e.record ?? {}, null, 1) })));
  }
  const L3 = mk('Ⅲ', `The inscribed records · ${entries.length}`, b3); L3.querySelector('.dig-layer-body').appendChild(deeper(L3)); layers.appendChild(L3);
  // 4 snapshot evidence
  const s = t.snapshot || null;
  const b4 = h('div', {});
  if (!s) b4.appendChild(h('div', { class: 'dim-note', text: 'No snapshot: the evidence could not be located.' }));
  else {
    b4.appendChild(h('div', {}, h('b', { text: String(s.offering?.title || s.offering || 'offering') }), ` · ${s.kind || ''}`, s.commit ? h('span', { class: 'hash', text: ` · commit ${String(s.commit).slice(0, 10)}` }) : null, s.diffHash ? h('span', { class: 'hash', text: ` · diff ${String(s.diffHash).slice(0, 10)}` }) : null));
    b4.appendChild(h('div', { style: { margin: '4px 0' } }, h('span', { class: `chip ${s.found ? 'yes' : 'no'}`, text: s.found ? `evidence found at ${s.file}:${s.line}` : `evidence not found in ${s.file || 'the snapshot'}` })));
    b4.appendChild(excerptBlock(s.excerpt, s.line, s.found));
  }
  const L4 = mk('Ⅳ', 'The evidence in the reviewed snapshot', b4); L4.querySelector('.dig-layer-body').appendChild(deeper(L4)); layers.appendChild(L4);
  // 5 the god's answer
  const an = t.answer;
  const b5 = h('div', {});
  if (!an) b5.appendChild(h('div', { class: 'dim-note', text: 'A scroll has no file for the hero to answer with.' }));
  else {
    b5.appendChild(h('div', { class: 'verdict-chips' },
      h('span', { class: `chip ${an.changedSinceSnapshot ? 'yes' : 'warn'}`, text: an.changedSinceSnapshot ? 'file changed since the snapshot' : 'file unchanged since the snapshot' }),
      h('span', { class: `chip ${an.evidenceStillInCommittedFile ? 'no' : 'yes'}`, text: an.evidenceStillInCommittedFile ? 'evidence still in the committed file' : 'evidence gone from the committed file' }),
      h('span', { class: `chip ${an.evidenceStillInWorkingFile ? 'no' : 'yes'}`, text: an.evidenceStillInWorkingFile ? 'evidence still in the working copy' : 'evidence gone from the working copy' }),
      h('span', { class: `chip ${an.uncommittedChanges ? 'warn' : 'yes'}`, text: an.uncommittedChanges ? 'uncommitted changes present' : 'working copy clean' })));
    b5.appendChild(h('div', { class: 'dim-note' }, h('span', { class: 'hash', text: `snapshot ${String(an.snapshotCommit || '?').slice(0, 10)} → head ${String(an.headNow || '?').slice(0, 10)}` })));
    b5.appendChild(diffBlock(an.diff));
  }
  const L5 = mk('Ⅴ', 'The hero\u2019s answer', b5); layers.appendChild(L5);
  const acts = $('dig-actions');
  acts.textContent = '';
  if (f.status === 'decreed') {
    const b = h('button', { class: 'btn btn-primary', type: 'button', text: 'Confirm fixed 🌸', title: 'Confirms the decree was carried out; this grows the shared tree' });
    b.addEventListener('click', async () => { b.disabled = true; const ok = await api('/api/findings/status', { id: f.id, status: 'fixed' }); b.disabled = false; if (okResult(ok)) { digDialog.close(); toast('Confirmed fixed. The tree grows. 🌸'); } });
    acts.appendChild(b);
  }
  acts.appendChild(h('button', { class: 'btn btn-ghost', type: 'button', text: 'Close', onClick: () => digDialog.close() }));
}
function excerptBlock(excerpt, line, found) {
  const box = h('div', { class: 'excerpt' });
  let lines = [], start = 1;
  if (excerpt && typeof excerpt === 'object' && Array.isArray(excerpt.lines)) { lines = excerpt.lines.map(String); start = +excerpt.start || 1; }
  else if (typeof excerpt === 'string') { lines = excerpt.split('\n'); start = Number.isFinite(+line) ? Math.max(1, +line - Math.floor(lines.length / 2)) : 1; }
  if (!lines.length) { box.appendChild(h('div', { class: 'dim-note', style: { padding: '6px 8px' }, text: '(no excerpt)' })); return box; }
  lines.forEach((t, i) => {
    const n = start + i;
    box.appendChild(h('div', { class: `ln ${found && n === +line ? 'hit' : ''}` }, h('span', { class: 'n', text: String(n) }), h('span', { class: 't', text: t })));
  });
  return box;
}
function diffBlock(diff) {
  const box = h('div', { class: 'excerpt' });
  const text = typeof diff === 'string' ? diff : '';
  if (!text.trim()) { box.appendChild(h('div', { class: 'dim-note', style: { padding: '6px 8px' }, text: '(no diff)' })); return box; }
  for (const l of text.split('\n')) {
    const cls = l.startsWith('+++') || l.startsWith('---') ? 'hunk' : l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : l.startsWith('@@') ? 'hunk' : '';
    box.appendChild(h('div', { class: `ln ${cls}` }, h('span', { class: 'n', text: cls === 'add' ? '+' : cls === 'del' ? '−' : '' }), h('span', { class: 't', text: l })));
  }
  return box;
}
function mockTrail(f) {
  const zone = zoneOf(f);
  const tab = state.tablet?.[zone];
  const recs = state._mockTabletRecords?.[zone] || [];
  const entries = (tab?.entries || []).filter((e) => e.findingId === f.id).map((e) => ({ ...e, record: recs.find((r) => r.id === e.id)?.record || {} }));
  const last = entries[entries.length - 1];
  const inscribed = last?.record || {};
  const drift = ['severity', 'file', 'line', 'claim'].filter((k) => inscribed[k] != null && String(inscribed[k]) !== String(f[k]));
  const off = (state.offerings || []).find((o) => o.id === f.offeringId);
  const ev = String(f.evidence || '');
  const evLines = ev ? ev.split('\n') : [];
  const ctx = ['// …', 'function connect() {', '  if (es) { es.close(); es = null; }', ...evLines, '  es.addEventListener(\x27open\x27, () => { connected = true; retry = 0; });', '}'];
  const start = Math.max(1, (+f.line || 1) - 3);
  const snapshot = off ? { offering: { id: off.id, title: off.title }, kind: off.kind, commit: off.headCommit, diffHash: off.diffHash, file: f.file, found: !!ev, line: f.line, excerpt: { start, lines: ctx } } : null;
  let answer = null;
  if (off && off.kind !== 'scroll') {
    const fixed = f.status === 'decreed' || f.status === 'fixed';
    answer = fixed
      ? { snapshotCommit: off.headCommit, headNow: '8e9f0a1b2c3d', changedSinceSnapshot: true, evidenceStillInCommittedFile: false, evidenceStillInWorkingFile: false, uncommittedChanges: false,
          diff: `--- a/${f.file}\n+++ b/${f.file}\n@@ -${start},${ctx.length} +${start},${ctx.length + 1} @@\n${ctx.map((l) => (evLines.includes(l) ? `-${l}` : ` ${l}`)).join('\n')}\n+  // decree ${f.id}: ${String(f.fix || 'fixed').slice(0, 60)}\n+  retry = 0;` }
      : { snapshotCommit: off.headCommit, headNow: off.headCommit, changedSinceSnapshot: false, evidenceStillInCommittedFile: true, evidenceStillInWorkingFile: true, uncommittedChanges: f.id === 'fi1', diff: '' };
  }
  return { inscription: last?.inscription || f.inscription || '', deciphered: last?.hash || '', entries, chain: tab?.verify ? { ...tab.verify } : { ok: true, entries: entries.length }, drift, snapshot, answer };
}

// ---------- Commission: send a god ----------
const commissionDialog = $('commission-dialog');
// With a petition, the same form makes the visitor's request a hero: the title never carries the question (it shows on the map).
let commissionPetition = null;
function openCommission(petition = null) {
  commissionPetition = petition;
  const sel = $('cm-site');
  sel.textContent = '';
  const sites = (state?.sites || []).filter((s) => s && s.id && s.id !== 'temple');
  const fallback = [{ id: 'library', label: 'The Great Library', purpose: 'thinking: research, design, planning, analysis' }, { id: 'forge', label: 'The Forge', purpose: 'making: building and changing code' }, { id: 'quarry', label: 'The Quarry', purpose: 'heavy lifting: migrations, refactors, long runs' }];
  for (const s of sites.length ? sites : fallback) sel.appendChild(h('option', { value: s.id, text: s.label, dataset: { purpose: s.purpose || '' } }));
  const showPurpose = () => { $('cm-purpose').textContent = (sel.selectedOptions[0]?.dataset.purpose || ''); };
  sel.onchange = showPurpose; showPurpose();
  const machines = $('cm-machine'); machines.textContent = '';
  if (state?.world?.commissionAvailable) machines.appendChild(h('option', { value: '', text: `this host (${osLabel(state.world.hostOs)})` }));
  for (const n of state?.nodes || []) if (n.online && n.deckAvailable) machines.appendChild(h('option', { value: n.id, text: `${n.name} (${osLabel(n.os) || 'unknown OS'})` }));
  $('cm-error').textContent = machines.options.length ? '' : 'No machine with agent-deck is online.';
  $('cm-error').hidden = !!machines.options.length;
  $('cm-submit').disabled = !machines.options.length;
  $('cm-title').value = petition ? `Visitor's labour — ${petition.visitor}` : ''; $('cm-model').value = ''; $('cm-effort').value = '';
  $('cm-prompt').value = petition ? `A visitor to Amygdala, ${petition.visitor}, asked for the help below. Do what is reasonable and safe within this project, and tell them plainly what you did or why you could not.` : '';
  $('cm-prompt').maxLength = petition ? Math.max(200, 3200 - String(petition.question || '').length) : 4000; // brief + fenced request + reply rules fit the 4000-character first message
  $('cm-heading').textContent = petition ? `Make ${petition.visitor}'s petition a hero` : 'Send a hero on a labour';
  $('cm-sub').textContent = petition ? 'Your brief comes first; the hero then sees the visitor\u2019s request, fenced as untrusted input, and replies to them between <to-visitor> tags.' : 'Commission a real agent session at one of the sites across the river.';
  const MODELS = { claude: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-1', 'claude-haiku-5-5'], codex: ['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-luna'], antigravity: ['gemini-4-argon-medium'], gemini: ['gemini-4-argon-medium'] };
  const fillModels = () => { const dl = $('cm-model-list'); dl.textContent = ''; for (const mm of MODELS[$('cm-tool').value] || []) dl.appendChild(h('option', { value: mm })); };
  $('cm-tool').onchange = fillModels; fillModels();
  commissionDialog.showModal();
  $('cm-path').focus();
}
$('commission-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = { node: $('cm-machine').value || null, site: $('cm-site').value, path: $('cm-path').value.trim(), tool: $('cm-tool').value, title: $('cm-title').value.trim(), prompt: $('cm-prompt').value.trim() };
  const model = $('cm-model').value.trim();
  if (model) body.model = model;
  const effort = $('cm-effort').value;
  if (effort) body.effort = effort;
  const err = $('cm-error');
  err.hidden = true;
  if (!body.path || !(body.path.startsWith('/') || body.path.startsWith('~') || /^[A-Za-z]:[\\/]/.test(body.path) || body.path.startsWith('\\\\'))) { err.textContent = 'The project folder must be an absolute path (or start with ~).'; err.hidden = false; return; }
  if (!body.title || !body.prompt) { err.textContent = 'Give the god a title and a task.'; err.hidden = false; return; }
  $('cm-submit').disabled = true;
  const petition = commissionPetition;
  const res = petition ? await api(`/api/petitions/${encodeURIComponent(petition.id)}/commission`, { ...body, brief: body.prompt, prompt: undefined }) : await api('/api/commission', body);
  $('cm-submit').disabled = false;
  if (okResult(res)) { commissionDialog.close(); toast(petition ? `A hero takes up ${petition.visitor}'s request.` : `A hero sets out for ${siteLabel(body.site)}.`); }
  else { err.textContent = (res && res.error) || 'The commission was refused.'; err.hidden = false; }
});

// ---------- Rune seal ----------
const sealDialog = $('seal-dialog');
let sealMode = 'unlock';
function openSeal(mode) {
  sealMode = mode;
  const setup = mode === 'setup';
  $('seal-title').textContent = setup ? 'Seal the isle in runes' : 'Break the seal';
  $('seal-sub').textContent = setup
    ? 'Everything Amygdala keeps about the Far Isle will be encrypted under this passphrase. The isle locks itself again after a few quiet minutes.'
    : 'Speak the passphrase and the runes become words again.';
  if (MOCK) $('seal-sub').textContent += ' Demo only (?mock=1, client-side only): unlock with amygdala.';
  $('seal-warning').hidden = !setup;
  $('seal-confirm-field').hidden = !setup;
  $('seal-confirm').required = setup;
  $('seal-submit').textContent = setup ? 'Seal the isle' : 'Unlock';
  $('seal-error').hidden = true;
  $('seal-pass').value = ''; $('seal-confirm').value = '';
  const runesEl = $('seal-runes');
  runesEl.hidden = setup;
  runesEl.classList.remove('dissolving');
  runesEl.textContent = setup ? '' : Array.from((state?.seal?.runes || []).slice(0, 2).join('  ')).slice(0, 48).join('') || laLine(7, 20);
  sealDialog.showModal();
  $('seal-pass').focus();
}
$('seal-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pass = $('seal-pass').value;
  const err = $('seal-error');
  err.hidden = true;
  if (pass.length < 8) { err.textContent = 'The passphrase needs at least 8 characters.'; err.hidden = false; return; }
  if (sealMode === 'setup' && pass !== $('seal-confirm').value) { err.textContent = 'The two passphrases do not match.'; err.hidden = false; return; }
  $('seal-submit').disabled = true;
  const res = await api(sealMode === 'setup' ? '/api/seal/setup' : '/api/seal/unlock', { passphrase: pass });
  $('seal-submit').disabled = false;
  $('seal-pass').value = ''; $('seal-confirm').value = '';
  if (!okResult(res)) { err.textContent = (res && res.error) || 'The runes did not answer.'; err.hidden = false; $('seal-pass').focus(); return; }
  if (sealMode === 'setup') { sealDialog.close(); toast('The isle is sealed in runes. 🔒'); return; }
  await dissolveRunes($('seal-runes'), 'the runes fall silent. the isle opens.');
  sealDialog.close();
  toast('The seal is broken. 🔓');
});
// Short "runes dissolve into letters" transition.
function dissolveRunes(el, target) {
  const RUNES = LA_GLYPHS.slice(0, 80);
  const steps = 18, dur = 720;
  el.hidden = false;
  el.classList.add('dissolving');
  return new Promise((resolve) => {
    let i = 0;
    const tick = () => {
      i++;
      const reveal = Math.floor((i / steps) * target.length);
      let s = '';
      const chars = Array.from(target);
      for (let k = 0; k < chars.length; k++) s += k < reveal || chars[k] === ' ' || chars[k] === '.' ? chars[k] : RUNES[Math.floor(Math.random() * RUNES.length)];
      el.textContent = s;
      if (i < steps) setTimeout(tick, dur / steps); else setTimeout(resolve, 260);
    };
    tick();
  });
}
// header chip
const sealChip = $('seal-chip');
$('seal-chip-btn').addEventListener('click', () => {
  if (sealLocked()) openSeal('unlock');
  else api('/api/seal/lock', {}).then((ok) => { if (okResult(ok)) toast('The isle is sealed. 🔒'); });
});
function renderSealChip() {
  const s = state?.seal;
  if (!s || !s.enabled || !hasIsle()) { sealChip.hidden = true; return; }
  sealChip.hidden = false;
  sealChip.classList.toggle('locked', !!s.locked);
  if (s.locked) {
    $('seal-chip-text').textContent = '🔒 isle sealed';
    $('seal-chip-btn').textContent = 'Unlock';
  } else {
    const ms = Math.max(0, (+s.locksAt || 0) - Date.now());
    const m = Math.floor(ms / 60000), sec = Math.floor((ms % 60000) / 1000);
    $('seal-chip-text').textContent = s.locksAt ? `🔓 reseals in ${m}:${String(sec).padStart(2, '0')}` : '🔓 isle open';
    $('seal-chip-btn').textContent = 'Seal now';
  }
}
setInterval(renderSealChip, 1000);
// keep-alive: active viewing keeps the isle open (at most one touch per 60s)
let lastTouch = 0;
function sealTouch() {
  if (!state?.seal?.enabled || state.seal.locked) return;
  const now = Date.now();
  if (now - lastTouch < 60000) return;
  lastTouch = now;
  api('/api/seal/touch', {});
}
document.addEventListener('pointerdown', sealTouch, { passive: true });
document.addEventListener('keydown', sealTouch, { passive: true });

// ---------- Place pane: description, who is here, and the place log ----------
let placePane = { id: null, log: null, fetchedAt: 0 };
async function openPlacePane(id, refresh = false) {
  if (id === 'hall') { panel.selectTab('workshop'); setDrawer(true); const hall = $('hall-heroes'); if (hall) { hall.open = true; hall.scrollIntoView({ block: 'nearest' }); } return; }
  const el = $('place-pane');
  if (!refresh) { placePane = { id, log: null, fetchedAt: 0 }; closeCard(); panel.selectTab('place'); setDrawer(true); el.textContent = ''; el.appendChild(h('div', { class: 'dim-note', text: 'Reading the record…' })); }
  if (!state) return;
  let log = null;
  try {
    if (MOCK) log = mockPlaceLog(id);
    else {
      const res = await fetch(`/api/places/${encodeURIComponent(id)}/log`, { headers: authHeaders() });
      if (res.status === 401) return sessionExpired();
      const data = await res.json().catch(() => null);
      if (res.ok && data && data.ok !== false) log = data.log;
    }
  } catch (_) { /* keep what we have */ }
  if (placePane.id !== id) return;
  if (log) { placePane.log = log; placePane.fetchedAt = Date.now(); }
  renderPlacePane();
}
function renderPlacePane() {
  const el = $('place-pane'); const id = placePane.id; if (!id) return;
  const p = (state.places || []).find((x) => x && x.id === id) || (state.workshops || []).find((x) => x && x.id === id);
  if (!p) { el.textContent = ''; el.appendChild(h('div', { class: 'empty', text: 'This place is gone.' })); return; }
  const log = placePane.log || {};
  const here = log.here || {};
  const site = (state.sites || []).find((s) => s && s.placeId === id);
  const residentsHere = Array.isArray(here.residents) ? here.residents : (state.residents || []).filter((r) => r && r.placeId === id).map((r) => r.name);
  // The Steward stands at its house (v0.49), so it is counted there rather than at its work site.
  const heroesHere = (Array.isArray(here.heroes) ? here.heroes : (site ? (state.workers || []).filter((w) => w && w.site === site.id).map((w) => w.id) : [])).filter((wid) => !(state.workers || []).some((w) => w && w.id === wid && w.home)).concat((state.workers || []).filter((w) => w && w.home === id).map((w) => w.id));
  const visitorsHere = Array.isArray(here.visitors) ? here.visitors : [];
  el.textContent = '';
  el.appendChild(h('div', { class: 'place-pane-head' }, h('button', { class: 'btn btn-ghost btn-xs', type: 'button', text: '← Back', onClick: () => panel.selectTab(currentTabBeforePlace || 'board') }), h('div', {}, h('h3', { text: String(p.name || p.project || id) }), h('div', { class: 'kind', text: `${p.kind === 'stewardhouse' ? 'house' : p.kind || 'workshop'}${site ? ` · ${site.label}` : ''}${zoneOf(p) === 'isle' ? ' · the Far Isle' : ''}` }))));
  if (p.description || site?.purpose) el.appendChild(h('details', { class: 'place-desc', open: true }, h('summary', { text: 'About this place' }), h('div', { text: String(p.description || site.purpose) }), p.keeper ? h('div', { class: 'dim-note', text: `kept by ${p.keeper}` }) : null, p.builtBy ? h('div', { class: 'dim-note', text: `built by ${p.builtBy}` }) : null));
  // The Steward's pane, at the house and at the deploy stone: the human's snapshot only, never in ?shot=1 or for visitors.
  if ((id === 'stewards-house' || id === 'quiet-stone') && state.stewardHouse && !SHOT) el.appendChild(h('details', { class: 'place-desc steward-desc', open: true }, h('summary', { text: id === 'quiet-stone' ? 'The deploy stone' : 'The Steward’s accounts' }), stewardPane(state, { onHero: (wid) => pinCard({ type: 'worker', id: wid }) })));
  const chips = h('div', { class: 'here-list' });
  for (const n of residentsHere) { const r = (state.residents || []).find((x) => x && x.name === n); chips.appendChild(h('span', { class: 'here-chip', onClick: () => pinCard({ type: 'resident', id: n }) }, avatar(n, r?.color, 'xs'), n)); }
  for (const n of visitorsHere) chips.appendChild(h('span', { class: 'here-chip' }, avatar(n, 'var(--other)', 'xs'), n, h('span', { class: 'chip chip-other', text: 'visitor' })));
  for (const wid of heroesHere) { const w = (state.workers || []).find((x) => x && x.id === wid); chips.appendChild(h('span', { class: 'here-chip', onClick: () => pinCard({ type: 'worker', id: wid }) }, h('span', { class: 'chip chip-tree', text: 'hero' }), String(w?.title || wid).slice(0, 28))); }
  el.appendChild(h('div', { class: 'card-section-title', text: `Here now · ${residentsHere.length + visitorsHere.length + heroesHere.length}` }));
  el.appendChild(chips.children.length ? chips : h('div', { class: 'dim-note', text: 'Nobody at the moment.' }));
  // the log: newest first, merged from every list the server returned
  const items = [];
  for (const f of log.feed || []) items.push({ ts: +f.ts || 0, who: f.actor && f.actor !== 'system' ? f.actor : '', what: f.text, kind: '' });
  for (const e of log.exhibits || []) items.push({ ts: +e.ts || 0, who: e.author, what: `exhibited “${e.title}”`, kind: e.kind, onClick: () => { panel.setZone(zoneOf(e)); panel.selectTab('exhibits'); } });
  for (const o of log.objects || []) items.push({ ts: +o.ts || 0, who: o.author, what: `left a ${o.kind}${o.note ? `: “${o.note}”` : ''}`, kind: 'gift' });
  for (const t of log.tales || []) items.push({ ts: +t.ts || +t.completedAt || 0, who: t.bard || '', what: `tale: “${t.title || 'untold'}”`, kind: 'tale' });
  for (const o of (log.offerings || []).filter((o) => zoneOf(o) === zoneOf(p))) items.push({ ts: +o.createdAt || 0, who: '', what: `offering “${o.title}” (${o.status})`, kind: 'offering' });
  for (const c of log.counsel || []) items.push({ ts: +c.ts || 0, who: c.by, what: `counsel: ${c.text}`, kind: `counsel · ${c.status}` });
  for (const c of log.commitments || []) items.push({ ts: +c.updatedAt || 0, who: c.ownerId, what: `${c.status}: ${c.objective}`, kind: 'project' });
  items.sort((a, b) => b.ts - a.ts);
  el.appendChild(h('div', { class: 'card-section-title', text: `What has happened here · ${items.length}` }));
  if (!items.length) el.appendChild(h('div', { class: 'dim-note', text: placePane.log ? 'Nothing recorded yet.' : 'The record could not be read.' }));
  for (const it of items.slice(0, 80)) el.appendChild(h('div', { class: 'log-item', onClick: it.onClick }, h('div', { class: 'what' }, it.who ? h('span', { class: 'who', text: it.who }) : null, String(it.what || '')), h('span', { class: 'when', text: relTime(it.ts) }), it.kind ? h('span', { class: 'lk', text: it.kind }) : null));
}
let currentTabBeforePlace = 'board';
function mockPlaceLog(id) {
  const p = (state.places || []).find((x) => x && x.id === id); const name = p?.name || id;
  const site = (state.sites || []).find((s) => s && s.placeId === id);
  const near = (o) => o && Math.hypot((+o.x || 0) - (+p?.x || 0), (+o.y || 0) - (+p?.y || 0)) < 70;
  return { place: id,
    here: { residents: (state.residents || []).filter((r) => r && r.placeId === id).map((r) => r.name), visitors: [], heroes: site ? (state.workers || []).filter((w) => w && w.site === site.id).map((w) => w.id) : [] },
    feed: (state.feed || []).filter((f) => f && (f.placeId === id || String(f.text || '').includes(name))),
    exhibits: (state.exhibits || []).filter((e) => e && e.placeId === id).map(({ content, ...e }) => e),
    objects: (state.objects || []).filter(near),
    tales: [], offerings: id === 'temple' ? (state.offerings || []).filter((o) => zoneOf(o) !== 'isle') : [],
    counsel: site ? (state.counsel || []).filter((c) => c && (state.workers || []).some((w) => w && w.id === c.workerId && w.site === site.id)) : [],
    commitments: (state.commitments || []).filter((c) => c && (c.artifactIds || []).some((aid) => (state.exhibits || []).some((e) => e && e.id === aid && e.placeId === id))) };
}

// Terminal resources live only while their drawer view is open.
let terminalHeroId = null;
let terminalDispose = null;
function disposeTerminal() {
  terminalDispose?.();
  terminalDispose = null;
  terminalHeroId = null;
}
function canOpenTerminal(w) {
  // A stopped agent-deck session has no tmux session left to attach to.
  return w && w.status !== 'stopped' && zoneOf(w) === 'village' && !w.isleTagged && !w.quarantined && !w.sealed &&
    (w.node || (!state?.world?.terminalReason && (state?.world?.hostOs === 'windows' || (w.host === 'local' && w.id?.startsWith('local:')))));
}
function syncTerminalWidth(name) {
  const wide = name === 'terminal';
  if (!wide) disposeTerminal();
  const wasWide = document.body.classList.contains('terminal-open');
  document.body.classList.toggle('terminal-open', wide);
  if (wide !== wasWide) document.documentElement.style.setProperty('--drawer-w',
    wide ? `${loadPref().terminalWidth || window.innerWidth * 0.5}px` : `${loadPref().width || 400}px`);
}
function openTerminal(w) {
  if (!canOpenTerminal(w)) return;
  closeCard();
  setDrawer(true, 'terminal');
  if (terminalHeroId !== w.id || !terminalDispose) {
    disposeTerminal();
    terminalHeroId = w.id;
    terminalDispose = mountHeroTerminal($('tab-terminal'), w, {
      token: TOKEN, mock: MOCK, onClose: () => setDrawer(false),
    });
  }
}

// ---------- Drawer (glass panel over the scene) ----------
const drawer = $('drawer');
const rail = $('rail');
let drawerOpen = false;
const DRAWER_KEY = 'hf.drawer';
function loadPref() { try { return JSON.parse(localStorage.getItem(DRAWER_KEY) || '{}') || {}; } catch (_) { return {}; } }
function savePref(p) { try { localStorage.setItem(DRAWER_KEY, JSON.stringify({ ...loadPref(), ...p })); } catch (_) { /* private mode */ } }
function setDrawer(open, tab) {
  if (tab && tab !== 'place') currentTabBeforePlace = tab;
  drawerOpen = !!open;
  if (!drawerOpen) disposeTerminal();
  drawer.classList.toggle('open', drawerOpen);
  drawer.inert = !drawerOpen;
  drawer.setAttribute('aria-hidden', drawerOpen ? 'false' : 'true');
  document.body.classList.toggle('drawer-open', drawerOpen);
  if (tab) panel.selectTab(tab);
  for (const b of rail.querySelectorAll('.rail-tab')) b.setAttribute('aria-selected', drawerOpen && b.dataset.tab === currentTab() ? 'true' : 'false');
  savePref({ open: drawerOpen, tab: currentTab() });
  refreshCardBounds();
  repositionCard();
}
function currentTab() { return panel.activeTab; }
rail.addEventListener('click', (e) => { const b = e.target.closest('.rail-tab'); if (!b) return; if (drawerOpen && currentTab() === b.dataset.tab) setDrawer(false); else setDrawer(true, b.dataset.tab); });
$('drawer-close').addEventListener('click', () => setDrawer(false));
document.querySelector('.tabs').addEventListener('click', (e) => { if (e.target.closest('.tab')) setDrawer(true); });
// resize by dragging the handle
(() => {
  const handle = $('drawer-handle');
  let drag = null;
  const apply = (w) => { const cw = Math.max(320, Math.min(window.innerWidth * 0.7, w)); document.documentElement.style.setProperty('--drawer-w', cw + 'px'); return cw; };
  const pref = loadPref();
  if (pref.width) apply(pref.width);
  handle.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, w: drawer.getBoundingClientRect().width }; handle.setPointerCapture(e.pointerId); e.preventDefault(); });
  handle.addEventListener('pointermove', (e) => { if (!drag) return; apply(drag.w + (drag.x - e.clientX)); });
  handle.addEventListener('pointerup', () => { if (drag) savePref({ [currentTab() === 'terminal' ? 'terminalWidth' : 'width']: drawer.getBoundingClientRect().width }); drag = null; });
})();
document.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '') || document.activeElement?.isContentEditable;
  if (e.key === 'Escape' && !document.querySelector('dialog[open]')) {
    if (card.info) { closeCard(); e.preventDefault(); return; }
    if (gift.active) { setGiftMode(false); return; }
    if (!typing && drawerOpen) { setDrawer(false); return; }
  }
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  const tabs = [...document.querySelectorAll('.tabs [role="tab"]')];
  const index = Number(e.key) - 1;
  if (Number.isInteger(index) && index >= 0 && index < tabs.length) { setDrawer(true, tabs[index].dataset.tab); e.preventDefault(); }
});
{ const pref = loadPref(); if (pref.open) setDrawer(true, pref.tab === 'terminal' ? 'board' : pref.tab); else setDrawer(false); }
// credits
$('credits-btn').addEventListener('click', async () => {
  const d = $('credits-dialog'); d.showModal();
  const out = $('credits-text');
  const parts = [];
  for (const [label, url] of [['Assets (public/assets/CREDITS.md)', 'assets/CREDITS.md'], ['three.js (MIT)', 'vendor/three/LICENSE'], ['xterm.js (MIT)', 'vendor/xterm/LICENSE']]) {
    try { const r = await fetch(url); parts.push(`== ${label} ==\n${r.ok ? await r.text() : '(not available)'}`); } catch (_) { parts.push(`== ${label} ==\n(not available)`); }
  }
  out.textContent = parts.join('\n\n');
});

// ---------- Header ----------
const statusEl = $('status');
function renderHeader() {
  const w = state?.world || {};
  $('world-name').textContent = String(w.name || 'Amygdala');
  document.title = String(w.name || 'Amygdala');
  const st = expired ? 'expired' : !connected ? 'reconnecting' : w.paused ? 'paused' : 'live';
  statusEl.dataset.state = st;
  $('status-text').textContent = st === 'expired' ? 'Session expired — reload' : st === 'reconnecting' ? 'reconnecting…' : st === 'paused' ? 'paused' : MOCK ? 'live (mock)' : 'live';
  const residents = state?.residents || [], workers = state?.workers || [];
  const n = residents.length + workers.length;
  $('pop').textContent = `${n} inhabitant${n === 1 ? '' : 's'}`;
  $('pop').title = `${residents.length} residents · ${workers.length} workers · you`;
  let clock = '';
  if (Number.isFinite(+w.now) && !PHASE_OVERRIDE) { try { clock = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit', timeZone: w.tz || undefined }).format(new Date(+w.now)); } catch (_) { clock = new Date(+w.now).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } }
  const sunNow = typeof map.sunInfo === 'function' ? map.sunInfo() : null;
  $('daytime').textContent = `Day ${Number.isFinite(+w.day) ? w.day : '—'} · ${capitalize(sunNow?.phase || w.phase || '—')}${clock ? ` · ${clock}` : ''}`;
  $('daytime').title = sunNow ? `sun ${sunNow.alt.toFixed(0)}° above the horizon, azimuth ${sunNow.az.toFixed(0)}°` : '';
  const btn = $('toggle-pause');
  btn.textContent = w.paused ? 'Resume' : 'Pause';
  btn.classList.toggle('btn-primary', !!w.paused);
  const villageState = typeof map.getVillageState === 'function' ? map.getVillageState() : typeof map3d.getVillageState === 'function' ? map3d.getVillageState() : null;
  const idle = villageState === 'idle' || villageState?.idle || villageState?.state === 'idle' || villageState?.status === 'idle';
  $('village-state').hidden = w.paused ? st === 'paused' : !idle;
  $('village-state').textContent = w.paused ? 'Paused' : "Idle — everyone's resting";
  $('village-state').classList.toggle('paused-chip', !!w.paused);
  const pace = $('pace');
  const tick = +w.tickSeconds;
  if (Number.isFinite(tick) && tick > 0) {
    if (![...pace.options].some((o) => +o.value === tick)) pace.appendChild(h('option', { value: tick, text: tick >= 60 ? `${Math.round(tick / 60)}m` : `${tick}s` }));
    if (document.activeElement !== pace) pace.value = String(tick);
  }
  const b = state?.budget;
  const hrs = b?.activeHours;
  if (hrs) for (const [id, v] of [['hours-start', hrs.start], ['hours-end', hrs.end]]) if (document.activeElement !== $(id)) $(id).value = String(v);
  $('hours-zone').textContent = w.tz ? `(${w.tz})` : '(server local time; zone unavailable)';
  const budgetEl = $('budget');
  if (b && Number.isFinite(+b.dailyTurnBudget)) {
    budgetEl.hidden = false;
    const used = Math.max(0, +b.usedToday || 0), total = Math.max(0, +b.dailyTurnBudget);
    $('budget-text').textContent = `${used}/${total}`;
    const frac = total > 0 ? Math.min(1, used / total) : 1;
    $('budget-fill').style.width = `${Math.round(frac * 100)}%`;
    budgetEl.classList.toggle('spent', used >= total && total > 0);
    $('budget-dec').disabled = total <= 0;
  } else {
    budgetEl.hidden = true;
  }
  zoneNav.hidden = !hasIsle();
  renderSealChip();
  const lg = $('lamp-glyph');
  const guidance = state?.usage?.guidance;
  if (!['normal', 'conserve', 'exhausted'].includes(guidance)) lg.hidden = true;
  else { lg.hidden = false; lg.dataset.guidance = guidance; lg.title = guidance === 'normal' ? 'Lamps: allowances fine' : guidance === 'conserve' ? 'Lamps: conserve oil — an allowance is running low' : 'Lamps: oil exhausted — an allowance is used up'; $('lamp-glyph-text').textContent = guidance; }
}
$('lamp-glyph').addEventListener('click', () => setDrawer(true, 'lamps'));
$('toggle-pause').addEventListener('click', () => api('/api/control', { paused: !state?.world?.paused }));
const updateBells = createBells($('bell-settings'));
const bellPageId = crypto.randomUUID();
const bellPresence = () => { if (!SHOT && !MOCK) void api('/api/bells/presence', { id: bellPageId, visible: !document.hidden }); };
function positionGear() {
  const pop = $('gear-pop'); if (pop.hidden) return;
  const anchor = $('gear-btn').getBoundingClientRect();
  pop.style.left = `${Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, anchor.right - pop.offsetWidth))}px`;
  const top = Math.max(8, Math.min(anchor.bottom + 6, window.innerHeight - 48));
  pop.style.top = `${top}px`; pop.style.maxHeight = `${Math.max(40, window.innerHeight - top - 8)}px`;
}
function setGear(open) {
  $('gear-pop').hidden = !open; $('gear-btn').setAttribute('aria-expanded', String(open));
  if (open) positionGear();
}
$('gear-btn').addEventListener('click', () => setGear($('gear-pop').hidden));
document.addEventListener('pointerdown', (e) => { const g = $('gear-pop'); if (!g.hidden && !g.contains(e.target) && !$('gear-btn').contains(e.target)) setGear(false); });
// Escape belongs to the open popover before the drawer/card handlers see it.
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('gear-pop').hidden) { e.preventDefault(); e.stopImmediatePropagation(); setGear(false); $('gear-btn').focus(); } }, true);
window.addEventListener('resize', positionGear);
$('pace').addEventListener('change', (e) => api('/api/control', { tickSeconds: +e.target.value }));
const hourName = (n) => n === 0 || n === 24 ? '12am' : n === 12 ? '12pm' : n < 12 ? `${n}am` : `${n - 12}pm`;
for (let n = 0; n < 24; n++) $('hours-start').appendChild(h('option', { value: n, text: hourName(n) }));
for (let n = 1; n <= 24; n++) $('hours-end').appendChild(h('option', { value: n, text: hourName(n) }));
const setHours = () => api('/api/control', { activeHours: { start: +$('hours-start').value, end: +$('hours-end').value } });
$('hours-start').addEventListener('change', setHours);
$('hours-end').addEventListener('change', setHours);
function budgetStep(dir) {
  const cur = Math.max(0, +state?.budget?.dailyTurnBudget || 0);
  const step = cur >= 100 ? 24 : cur >= 24 ? 12 : 6;
  const next = Math.max(0, Math.min(2000, cur + dir * step));
  if (next !== cur) api('/api/control', { dailyTurnBudget: next });
}
$('budget-dec').addEventListener('click', () => budgetStep(-1));
$('budget-inc').addEventListener('click', () => budgetStep(1));

// ---------- Happening now ----------
const happeningButton = $('happening').querySelector('.happening-title');
happeningButton.addEventListener('click', () => { const hp = $('happening'); hp.classList.toggle('collapsed'); happeningButton.setAttribute('aria-expanded', String(!hp.classList.contains('collapsed'))); savePref({ feed: hp.classList.contains('collapsed') ? 'collapsed' : 'open' }); });
if (loadPref().feed === 'collapsed') { $('happening').classList.add('collapsed'); happeningButton.setAttribute('aria-expanded', 'false'); }
const happeningList = $('happening-list');
function renderHappening() {
  const feed = (state?.feed || []).filter((f) => f && f.id).slice(-5);
  const ids = new Set(feed.map((f) => f.id));
  for (const li of Array.from(happeningList.children)) if (!ids.has(li.dataset.id)) li.remove();
  let prev = null;
  feed.forEach((f, i) => {
    let li = happeningList.querySelector(`li[data-id="${CSS.escape(f.id)}"]`);
    if (!li) {
      li = h('li', { dataset: { id: f.id } },
        f.actor && f.actor !== 'system' ? h('span', { class: 'actor', text: String(f.actor) }) : null,
        h('span', { class: 'txt', text: String(f.text || '') }),
        h('span', { class: 'when', text: relTime(f.ts), dataset: { ts: f.ts } }));
      if (prev) happeningList.insertBefore(li, prev.nextSibling); else happeningList.insertBefore(li, happeningList.firstChild);
    }
    li.style.opacity = String(0.4 + 0.6 * ((i + 1) / feed.length));
    prev = li;
  });
}
setInterval(() => {
  if (state) renderHeader();
  for (const t of document.querySelectorAll('.happening .when, .post-time[data-ts]')) if (t.dataset.ts) t.textContent = relTime(+t.dataset.ts);
}, 20000);

// ---------- Apply state ----------
// ?shot=1: screenshot mode for the steward's visual QA — never shows isle content (privacy rule): isle entries are
// stripped from every list, the isle renders as sealed, and the Happening-now feed is hidden.
const SHOT = params.get('shot') === '1';
if (SHOT) document.documentElement.classList.add('shot');
if (SHOT && params.get('public') === '1') document.documentElement.classList.add('shot-public');
// Presence starts here, not at bellPresence's definition: SHOT and MOCK are declared above, so this avoids the TDZ.
setInterval(bellPresence, 10000); document.addEventListener('visibilitychange', bellPresence); bellPresence();
// ?phase=dawn|morning|afternoon|twilight|night: freeze the light for screenshots (overrides the real sun).
const PHASE_OVERRIDE = params.get('phase');
// The title is independent of state delivery: snapshots keep flowing during the camera journey.
let introCleanup = null;
function playIntro() {
  if (!state) return;
  introCleanup?.();
  const card = $('intro-card'), reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const w = state.world || {}, first = (state.feed || [])[0];
  const phase = String(w.phase || 'dawn');
  const sentiment = first?.zone === 'village' ? String(first.sentiment || first.text || '').trim().slice(0, 120) : '';
  const lines = w.prologue?.length ? w.prologue : [sentiment || (phase === 'dawn' ? 'Dawn over a new island' : `${capitalize(phase)} over the island`)];
  $('intro-day').textContent = `Day ${w.day ?? 1}`;
  const narration = $('intro-prologue');
  narration.replaceChildren();
  const duration = reduced ? 4000 : 2200 * (1 + lines.length) + 1500;
  card.style.setProperty('--intro-duration', `${duration}ms`);
  lines.forEach((line, i) => {
    const el = document.createElement('p'); el.textContent = line;
    el.style.setProperty('--line-delay', `${2200 * (i + 1)}ms`);
    narration.append(el);
  });
  card.hidden = false;
  card.classList.remove('intro-playing', 'intro-reduced');
  void card.offsetWidth;
  card.classList.add('intro-playing');
  if (reduced) card.classList.add('intro-reduced');
  const finishCamera = !reduced && map.playIntro ? map.playIntro() : () => map.panTo('village', false);
  if (reduced) map.panTo('village', false);
  const events = ['pointerdown', 'click', 'keydown', 'wheel'];
  const finish = (event) => {
    if (event) { event.preventDefault(); event.stopImmediatePropagation(); }
    clearTimeout(timer);
    events.forEach((type) => window.removeEventListener(type, finish, true));
    finishCamera();
    card.hidden = true;
    card.classList.remove('intro-playing', 'intro-reduced');
    introCleanup = null;
    updateCeremony();
  };
  const timer = setTimeout(finish, duration);
  events.forEach((type) => window.addEventListener(type, finish, { capture: true, passive: false }));
  introCleanup = finish;
  try { localStorage.setItem('amygdala.intro.v2', `seen:${w.createdAt ?? 0}`); } catch (_) { /* storage may be unavailable */ }
}
$('replay-intro').addEventListener('click', () => { setGear(false); playIntro(); });
function maybeIntro() {
  if (SHOT && params.get('intro') !== '1') return;
  let seen = false;
  try { const stored = localStorage.getItem('amygdala.intro.v2'); seen = stored?.startsWith('seen:') && Number(stored.slice(5)) >= (state.world?.createdAt ?? 0); } catch (_) { /* show once this session */ }
  if (!seen || params.get('intro') === '1') playIntro();
}
const pannedCeremonies = new Set();
let ceremonyTimer = null;
function updateCeremony() {
  $('naming-offer').hidden = !state?.namingOffer || SHOT;
  clearTimeout(ceremonyTimer);
  const banner = $('ceremony-proclamation'), c = state?.ceremony;
  banner.hidden = true;
  if (!c || !c.names.length || (SHOT && params.get('ceremony') !== '1')) return;
  if (c.endedAt) {
    const remaining = c.endedAt + 8000 - Date.now();
    if (remaining <= 0) return;
    banner.textContent = 'The naming is complete';
    ceremonyTimer = setTimeout(() => { banner.hidden = true; }, remaining);
  } else {
    banner.textContent = `The Naming Ceremony · ${c.done.length} of ${c.names.length} named`;
    if (!introCleanup && !pannedCeremonies.has(c.startedAt)) {
      pannedCeremonies.add(c.startedAt);
      map.panTo('green');
    }
  }
  banner.hidden = false;
}
function stripIsle(s) {
  const isIsle = (x) => x && typeof x === 'object' && (x.zone === 'isle' || x.isleTagged || x.sealed);
  const out = {};
  for (const [k, v] of Object.entries(s)) out[k] = Array.isArray(v) ? v.filter((x) => !isIsle(x)) : v;
  delete out.isleGhosts; delete out.petitions; delete out.bells; delete out.audits; delete out.auditSettings; delete out.stewardHouse;   // the deploy stone stays unlit and the house shows only its name
  out.offerings = (out.offerings || []).filter(o => o.kind !== 'audit' && !o.humanOnly);
  out.workshops = [];
  // ?shot=1&public=1: a showcase capture, so the human's sessions, visitors and passes stay out of the picture too.
  if (params.get('public') === '1') { out.workers = []; out.hall = []; out.visitors = []; out.heroPasses = []; out.nodes = []; out.visitorPasses = []; out.petitions = []; }
  if (out.usage?.isle) { out.usage = { ...out.usage }; delete out.usage.isle; }
  out.seal = { ...(s.seal || {}), enabled: true, locked: true };
  return out;
}
function applyState(s) {
  if (!s || typeof s !== 'object') return;
  if (SHOT) s = stripIsle(s);
  if (SHOT && params.get('tab') && !applyState.tabbed) { applyState.tabbed = true; setTimeout(() => setDrawer(true, params.get('tab')), 0); }
  if (PHASE_OVERRIDE) s = { ...s, world: { ...(s.world || {}), phase: PHASE_OVERRIDE, sun: null } };
  const previousCreatedAt = state?.world?.createdAt;
  const firstState = !state;
  state = s;
  if (!SHOT && !MOCK) updateBells(s.bells || []);
  updateEndLabour();
  map.update(s);
  if (firstState && !MOCK && params.get('vb')) { const [x, y, w] = params.get('vb').split(',').map(Number); map.setView({ x, y, w }); }
  if (firstState || s.world?.createdAt > previousCreatedAt) maybeIntro();
  updateCeremony();
  panel.update(s);
  if (terminalHeroId && !canOpenTerminal((s.workers || []).find((w) => w.id === terminalHeroId))) {
    disposeTerminal();
    if (currentTab() === 'terminal') setDrawer(false, 'workshop');
  }
  if (terminalHeroId) {
    const hero = (s.workers || []).find((w) => w.id === terminalHeroId);
    const header = $('tab-terminal').querySelector('.terminal-header');
    if (hero && header) {
      header.querySelector('h2').textContent = `Terminal — ${hero.title || hero.id}`;
      const pill = header.querySelector('.pill');
      const status = String(hero.status || 'idle');
      pill.className = `pill pill-${hero.stale ? 'stale' : status}`;
      pill.textContent = hero.stale ? 'last seen a while ago' : status === 'waiting' ? 'waiting for you' : status;
    }
  }
  renderHeader();
  renderHappening();
  if (card.info) {
    if (card.pinned && card.info.type === 'resident' && card.root?.parentNode === cardEl) {
      const r = (state.residents || []).find(r => r && r.name === card.info.id);
      if (!r) closeCard();
      else { card.root.update(r, state, residentActions); card.size = { w: cardEl.offsetWidth, h: cardEl.offsetHeight }; repositionCard(); }
    } else if (card.pinned) showCard(card.info, true); else repositionCard();
  }
  if (placePane.id && drawerOpen && currentTab() === 'place') { renderPlacePane(); if (!MOCK && Date.now() - placePane.fetchedAt > 2000) openPlacePane(placePane.id, true); }
}

// ---------- Live connection (SSE with backoff) ----------
let es = null, retry = 0, retryTimer = null;
function connect() {
  if (es) { es.close(); es = null; }
  try {
    if (expired) return;
    es = new EventSource(`/api/events${TOKEN ? `?token=${encodeURIComponent(TOKEN)}` : ''}`);
  } catch (_) { scheduleRetry(); return; }
  es.addEventListener('open', () => { connected = true; retry = 0; renderHeader(); });
  es.addEventListener('state', (e) => {
    try { applyState(JSON.parse(e.data)); } catch (err) { console.warn('bad state event', err); }
    if (!connected) { connected = true; renderHeader(); }
  });
  es.addEventListener('error', async () => {
    connected = false;
    renderHeader();
    if (es) { es.close(); es = null; }
    try { // EventSource cannot see a 401; probe the state endpoint to tell a rotated token from a dropped connection
      const r = await fetch('/api/state', { headers: authHeaders() });
      if (r.status === 401) return sessionExpired();
    } catch (_) { /* server down: keep retrying */ }
    scheduleRetry();
  });
}
function scheduleRetry() {
  clearTimeout(retryTimer);
  const delay = Math.min(30000, 1000 * Math.pow(2, retry++)) + Math.random() * 500;
  retryTimer = setTimeout(connect, delay);
}
async function boot() {
  if (MOCK) return bootMock();
  try {
    const res = await fetch('/api/state', { headers: authHeaders() });
    if (res.status === 401) return sessionExpired();
    if (res.ok) { connected = true; applyState(await res.json()); }
  } catch (_) { /* SSE will retry */ }
  connect();
}

// ---------- Mock mode ----------
// Demo-only passphrase for ?mock=1; client-side simulation only.
const MOCK_PASSPHRASE = 'amygdala';
let mockSeq = 100;
let mockVault = null; // isle plaintext stashed while sealed
async function bootMock() {
  let s;
  try {
    s = await (await fetch('mock-state.json')).json();
  } catch (err) {
    toast('Could not load mock-state.json', true);
    return;
  }
  let maxTs = 0;
  const walk = (list) => { for (const x of list || []) if (x && +x.ts > maxTs) maxTs = +x.ts; };
  walk(s.posts); walk(s.feed); walk(s.exhibits); walk(s.objects);
  const shift = Date.now() - maxTs;
  const shiftList = (list, key = 'ts') => { for (const x of list || []) if (x && Number.isFinite(+x[key])) x[key] += shift; };
  shiftList(s.posts); shiftList(s.feed); shiftList(s.exhibits); shiftList(s.objects);
  shiftList(s.workers, 'updatedAt'); shiftList(s.residents, 'lastTurnAt'); shiftList(s.places, 'builtAt');
  shiftList(s.commitments, 'updatedAt'); shiftList(s.commitments, 'createdAt');
  for (const t of s.trees || []) {
    shiftList(t.blooms, 'opensAt'); shiftList(t.blooms, 'fallsAt'); shiftList(t.branches, 'createdAt'); shiftList(t.recent, 'awardedAt');
  }
  if (s.world?.activeTurn) s.world.activeTurn.startedAt += shift;
  const phase = params.get('phase');
  if (phase) s.world.phase = phase;
  const stageParam = params.get('stage');
  if (stageParam != null && /^[0-4]$/.test(stageParam)) {
    const n = +stageParam;
    for (const t of s.trees || []) {
      t.stage = n; t.stageName = STAGE_NAMES[n];
      t.lifetimeCredits = STAGE_THRESHOLDS[n] + Math.round((STAGE_THRESHOLDS[n + 1] ?? STAGE_THRESHOLDS[n] * 2) - STAGE_THRESHOLDS[n]) * 0.4;
      t.nextStageAt = STAGE_THRESHOLDS[n + 1] ?? STAGE_THRESHOLDS[n] * 2;
    }
  }
  s.seal = s.seal || { enabled: true, locked: false, autoLockMinutes: 5 };
  if (params.get('seal') === '0') s.seal = { enabled: false, locked: false };
  if (params.has('hall')) { // ?hall=N: N synthetic resting heroes in the Hall of Heroes (0 clears it); ?hallAct=revive|forget[:ms] then acts on the first after a delay
    const sites = ['forge', 'library', 'quarry', 'temple'], n = Math.max(0, Math.min(200, +params.get('hall') || 0));
    s.hall = Array.from({ length: n }, (_, i) => ({ id: `local:rest${i}`, title: `Resting hero ${i + 1}`, tool: ['claude', 'codex', 'antigravity', 'grok'][i % 4], model: 'synthetic', host: 'local', os: 'linux', project: 'example', lastActivityAt: Date.now() - i * 3600000, archived: i % 3 === 0, status: 'stopped', site: sites[i % 4] }));
  }
  if (params.get('hallAct')) { const [act, ms] = params.get('hallAct').split(':'); setTimeout(() => { const w = state.hall?.[0]; if (w) mockApi(`/api/heroes/${act}`, { workerId: w.id }).then(() => applyState(state)); }, +ms || 2500); }
  state = s;
  if (s.seal.enabled && !s.seal.locked) s.seal.locksAt = Date.now() + (s.seal.autoLockMinutes || 5) * 60000;
  if (params.get('sealed') === '1' || (s.seal.enabled && s.seal.locked)) { s.seal.locked = false; mockSeal(true); }
  connected = true;
  applyState(s);
  if (params.get('tab')) { panel.selectTab(params.get('tab')); setDrawer(true); }
  if (params.get('zone')) { panel.setZone(params.get('zone')); map.panTo(params.get('zone'), false); }
  if (params.get('channel')) panel.setChannel(params.get('channel'));
  if (params.get('vb')) { const [x, y, w] = params.get('vb').split(',').map(Number); map.setView({ x, y, w }); }
  if (params.get('card')) { const [type, id] = params.get('card').split(':'); pinCard({ type, id }); }
  if (params.get('place')) openPlacePane(params.get('place'));
  if (params.get('scroll')) { const [id, y] = params.get('scroll').split(':'); const el = document.getElementById(id); if (el) setTimeout(() => { el.scrollTop = +y || 0; }, 300); }
  if (params.get('walk')) { // debug: Name:x,y sends a resident walking there
    const [name, xy] = params.get('walk').split(':'); const [wx, wy] = (xy || '').split(',').map(Number);
    const r = s.residents.find((x) => x.name === name); if (r && Number.isFinite(wx)) { setTimeout(() => { r.x = wx; r.y = wy; const near = s.places.find((p) => Math.hypot(p.x - wx, p.y - wy) < 70); r.placeId = near ? near.id : r.placeId; applyState(s); }, 400); }
  }
  if (params.get('say')) { const [name, ...rest] = params.get('say').split(':'); setTimeout(() => { s.posts.push({ id: `p${mockSeq++}`, author: name, authorKind: 'resident', channel: 'commons', text: rest.join(':'), replyTo: null, ts: Date.now(), zone: 'village' }); applyState(s); }, 1200); }
  if (params.get('still') !== '1') startMockLife();
  setInterval(() => { // idle auto-lock
    if (state?.seal?.enabled && !state.seal.locked && state.seal.locksAt && Date.now() > state.seal.locksAt) { mockSeal(true); applyState(state); }
  }, 1000);
}
function runeLine(seed, len = 40) { return laLine(seed, len); }
function mockSeal(lock) {
  const s = state;
  if (lock) {
    if (s.seal.locked) return;
    const isle = (x) => zoneOf(x) === 'isle';
    mockVault = {
      posts: s.posts.filter(isle), exhibits: s.exhibits.filter(isle), objects: s.objects.filter(isle), feed: s.feed.filter(isle),
      commitments: (s.commitments || []).filter(isle), places: s.places.filter((p) => isle(p) && p.builtBy),
      residents: s.residents.filter(isle).map((r) => ({ name: r.name, x: r.x, y: r.y, mood: r.mood, doing: r.doing, placeId: r.placeId })),
      trees: s.trees.filter(isle), workers: s.workers.filter((w) => isle(w) || (s.quarantine || []).includes(`${w.project}@${w.host}`)).map((w) => ({ ...w })),
    };
    for (const k of ['posts', 'exhibits', 'objects', 'feed', 'commitments']) s[k] = (s[k] || []).filter((x) => !isle(x));
    s.places = s.places.filter((p) => !(isle(p) && p.builtBy));
    const hall = s.places.find((p) => p.id === (s.zones.find((z) => z.id === 'isle')?.home || 'tide-hall')) || { x: 1400, y: 380 };
    s.residents.filter(isle).forEach((r, i) => { r.mood = 'sealed'; r.doing = ''; r.placeId = hall.id; r.x = hall.x - 30 + i * 26; r.y = hall.y + 34; });
    s.trees = s.trees.map((t) => (isle(t) ? { zone: 'isle', name: t.name, species: t.species, x: t.x, y: t.y, placeId: t.placeId, sealed: true } : t));
    for (const w of s.workers) {
      if (!(isle(w) || (s.quarantine || []).includes(`${w.project}@${w.host}`))) continue;
      const seed = [...w.id].reduce((a, c) => a + c.charCodeAt(0), 7);
      w.sealed = true; w.title = runeLine(seed, 14); w.project = runeLine(seed + 1, 8); w.host = runeLine(seed + 2, 6); w.path = '';
    }
    mockVault.workshops = s.workshops.filter(isle).map((w) => ({ ...w }));
    for (const w of s.workshops) { if (!isle(w)) continue; const seed = [...w.id].reduce((a, c) => a + c.charCodeAt(0), 3); w.project = runeLine(seed, 8); w.host = runeLine(seed + 5, 6); }
    s.seal = { enabled: true, locked: true, autoLockMinutes: s.seal.autoLockMinutes || 5, runes: Array.from({ length: 10 }, (_, i) => runeLine(911 + i * 17, 36 + (i % 3) * 6)) };
  } else {
    if (!s.seal.locked) return;
    if (mockVault) {
      for (const k of ['posts', 'exhibits', 'objects', 'feed', 'commitments']) { s[k] = [...(s[k] || []), ...mockVault[k]]; s[k].sort((a, b) => (+a.ts || +a.updatedAt || 0) - (+b.ts || +b.updatedAt || 0)); }
      s.places.push(...mockVault.places);
      for (const v of mockVault.residents) { const r = s.residents.find((x) => x.name === v.name); if (r) Object.assign(r, v); }
      s.trees = s.trees.map((t) => (zoneOf(t) === 'isle' ? mockVault.trees.find((x) => zoneOf(x) === 'isle') || t : t));
      for (const v of mockVault.workers) { const w = s.workers.find((x) => x.id === v.id); if (w) Object.assign(w, v, { sealed: false }); }
      for (const v of mockVault.workshops || []) { const w = s.workshops.find((x) => x.id === v.id); if (w) Object.assign(w, v); }
      mockVault = null;
    }
    s.seal = { enabled: true, locked: false, autoLockMinutes: s.seal.autoLockMinutes || 5, locksAt: Date.now() + (s.seal.autoLockMinutes || 5) * 60000 };
  }
}
function startMockLife() {
  const PHASES = ['dawn', 'morning', 'afternoon', 'twilight', 'night'];
  setInterval(() => {
    if (!state || state.world.paused) return;
    const residents = state.residents.filter((r) => r.enabled !== false && r.mood !== 'sealed');
    if (!residents.length) return;
    const r = residents[Math.floor(Math.random() * residents.length)];
    const places = state.places.filter((p) => zoneOf(p) === zoneOf(r));
    if (!places.length) return;
    const dest = places[Math.floor(Math.random() * places.length)];
    r.x = Math.round(dest.x + (Math.random() - 0.5) * 50); r.y = Math.round(dest.y + 20 + Math.random() * 20); r.placeId = dest.id;
    r.turns = (+r.turns || 0) + 1; r.lastTurnAt = Date.now();
    state.world.activeTurn = { resident: r.name, startedAt: Date.now() };
    state.feed.push({ id: `f${mockSeq++}`, ts: Date.now(), actor: r.name, text: `${r.name} moved to ${dest.name}`, zone: zoneOf(r) });
    if (Math.random() < 0.4) {
      const lines = ['The light is doing something interesting on the river.', 'Has anyone seen my notebook? It has a question in it.', 'Bench update: still level.', 'The buns are gone. I regret nothing.', 'Counting stars again. Lost count at a lovely number.'];
      state.posts.push({ id: `p${mockSeq++}`, author: r.name, authorKind: 'resident', channel: ['commons', 'play', 'discoveries'][Math.floor(Math.random() * 3)], text: lines[Math.floor(Math.random() * lines.length)], replyTo: null, ts: Date.now(), zone: zoneOf(r) });
    }
    state.budget.usedToday = Math.min(state.budget.dailyTurnBudget, (state.budget.usedToday || 0) + 1);
    state.world.phaseProgress = (state.world.phaseProgress + 0.02) % 1;
    if (params.get('cycle') === '1') state.world.phase = PHASES[(PHASES.indexOf(state.world.phase) + 1) % PHASES.length];
    applyState(state);
  }, 7000);
}
// gods stand in a ring below their site (mock positioning; the server does this for real)
function placeGodsInRings() {
  const sites = state.sites || [];
  const bySite = new Map();
  for (const w of state.workers) { if (zoneOf(w) === 'isle') continue; const k = w.site || 'temple'; if (!bySite.has(k)) bySite.set(k, []); bySite.get(k).push(w); }
  for (const [siteId, list] of bySite) {
    const s = sites.find((x) => x.id === siteId);
    const place = state.places.find((p) => p.id === (s?.placeId || (siteId === 'temple' ? 'temple' : siteId)));
    if (!place) continue;
    const n = list.length;
    list.forEach((w, i) => { const a = (Math.PI / 2) + (i - (n - 1) / 2) * (Math.PI / 4.2); const r = siteId === 'temple' ? 62 : 58; w.x = Math.round(place.x + Math.cos(a) * r); w.y = Math.round(place.y + Math.sin(a) * r * 0.85 + 10); });
  }
}
const ISLE_SLOTS = [[1550, 560], [1645, 560], [1550, 665], [1645, 665]];
const VILLAGE_SLOTS = [[890, 170], [910, 400], [890, 600], [905, 700]];
const origPos = new Map();
function mockApi(path, body) {
  if (!state) return Promise.resolve(true);
  const now = Date.now();
  const fail = (error) => { toast(error, true); return Promise.resolve({ ok: false, error }); };
  const isleLockedErr = 'The isle is sealed. Unlock it first.';
  if (/^\/api\/(visitors|heroes)\/(pass|revoke)$/.test(path)) {
    const key = path.includes('/visitors/') ? 'visitorPasses' : 'heroPasses';
    state[key] ||= [];
    if (path.endsWith('/revoke')) {
      const pass = state[key].find((p) => p.id === body.id);
      if (!pass) return fail('No such pass.');
      pass.revoked = true;
    } else {
      const pass = { id: `pass${mockSeq++}`, name: body.name, label: body.label, zone: body.zone || 'village', createdAt: now, expiresAt: now + body.hours * 3600000, lastSeen: null, revoked: false };
      state[key].push(pass);
      applyState(state);
      return Promise.resolve({ ok: true, pass, token: `mock-only-${crypto.randomUUID()}` });
    }
  } else if (path === '/api/tales/end') {
    const w = state.workers.find((x) => x.id === body.workerId);
    if (!w) return fail('No such hero.');
    if (w.bridge || w.host !== 'local') return fail('End this hero in its own window.');
    if (w.sealed) return fail(isleLockedErr);
    w.status = 'stopped';
    return mockApi('/api/tales/complete', body);
  } else if (path === '/api/tales/complete') {
    const w = state.workers.find((w) => w.id === body.workerId);
    if (!w) return fail('No such hero.');
    if (w.sealed) return fail(isleLockedErr);
    state.tales ||= [];
    state.tales.push({ id: `t${mockSeq++}`, zone: zoneOf(w), heroId: w.id, hero: w.title, project: w.project, site: w.site, tool: w.tool, host: w.host, startedAt: now - 120000, endedAt: now, workedMs: 120000, commits: [], fixed: [], stat: null, tale: null, bard: 'The Bard' });
  } else if (path === '/api/heroes/revive' || path === '/api/heroes/forget') {
    const i = (state.hall || []).findIndex((w) => w.id === body.workerId);
    if (i < 0) return fail('That hero is private or gone.');
    const [w] = state.hall.splice(i, 1);
    if (path.endsWith('revive')) { const site = (state.sites || []).find((x) => x.id === w.site), p = state.places.find((x) => x.id === site?.placeId) || state.places[0]; state.workers.push({ ...w, status: 'running', archived: false, zone: 'village', x: p.x + 30, y: p.y + 40, updatedAt: now }); }
    state.feed.push({ id: `f${mockSeq++}`, ts: now, actor: 'You', text: path.endsWith('revive') ? `You called ${w.title} back from the Hall of Heroes` : `${w.title} was forgotten`, zone: 'village' });
  } else if (path === '/api/human/move') {
    state.human = { ...state.human, x: body.x, y: body.y, zone: body.x >= 1150 ? 'isle' : 'village' };
    const near = state.places.find((p) => Math.hypot(p.x - body.x, p.y - body.y) < 60);
    state.human.placeId = near ? near.id : null;
  } else if (path === '/api/human/gift') {
    const zone = body.x >= 1150 ? 'isle' : 'village';
    if (zone === 'isle' && state.seal.locked) return fail(isleLockedErr);
    state.objects.push({ id: `o${mockSeq++}`, author: 'You', kind: body.kind, x: body.x, y: body.y, note: body.note || '', ts: now, zone });
    state.feed.push({ id: `f${mockSeq++}`, ts: now, actor: 'You', text: `You left a ${body.kind}`, zone });
  } else if (path === '/api/human/post') {
    const zone = body.zone === 'isle' ? 'isle' : 'village';
    if (zone === 'isle' && state.seal.locked) return fail(isleLockedErr);
    state.posts.push({ id: `p${mockSeq++}`, author: 'You', authorKind: 'human', channel: body.channel, text: body.text, replyTo: body.replyTo || null, ts: now, zone });
    state.feed.push({ id: `f${mockSeq++}`, ts: now, actor: 'You', text: `You posted in ${body.channel}`, zone });
  } else if (path === '/api/control') {
    if (typeof body.paused === 'boolean') state.world.paused = body.paused;
    if (Number.isFinite(+body.tickSeconds)) state.world.tickSeconds = +body.tickSeconds;
    if (Number.isFinite(+body.dailyTurnBudget)) { state.budget = state.budget || { usedToday: 0 }; state.budget.dailyTurnBudget = +body.dailyTurnBudget; }
  } else if (path.startsWith('/api/residents/')) {
    const parts = path.split('/');
    const name = decodeURIComponent(parts[3] || '');
    const r = state.residents.find((x) => x.name === name);
    if (r) {
      if (parts[4] === 'wake') { state.world.activeTurn = { resident: name, startedAt: now }; state.feed.push({ id: `f${mockSeq++}`, ts: now, actor: name, text: `${name} wakes for a turn`, zone: zoneOf(r) }); }
      else if (typeof body.enabled === 'boolean') r.enabled = body.enabled;
      else if (body.zone === 'isle' || body.zone === 'village') {
        if (zoneOf(r) === 'isle' && state.seal.locked) return fail(isleLockedErr);
        const z = state.zones.find((zz) => zz.id === body.zone);
        const home = state.places.find((p) => p.id === z?.home) || (body.zone === 'isle' ? { x: 1400, y: 380, id: null } : { x: 400, y: 370, id: null });
        r.zone = body.zone; r.placeId = home.id; r.x = home.x + Math.round((Math.random() - 0.5) * 60); r.y = home.y + 36; r.doing = body.zone === 'isle' ? 'getting her bearings' : 'back among friends';
        state.feed.push({ id: `f${mockSeq++}`, ts: now, actor: name, text: body.zone === 'isle' ? `${name} was sent to the Far Isle` : `${name} came back from the Far Isle`, zone: body.zone });
      }
    }
  } else if (path === '/api/quarantine') {
    const key = `${body.project}@${body.host}`;
    state.quarantine = state.quarantine || [];
    const ws = state.workshops.find((w) => w.project === body.project && w.host === body.host);
    if (ws && zoneOf(ws) === 'isle' && state.seal.locked) return fail(isleLockedErr);
    const used = (slots, zone) => slots.find(([x, y]) => !state.workshops.some((w) => zoneOf(w) === zone && w.x === x && w.y === y));
    if (body.on) {
      if (!state.quarantine.includes(key)) state.quarantine.push(key);
      if (ws && zoneOf(ws) !== 'isle') {
        origPos.set(ws.id, { x: ws.x, y: ws.y });
        const slot = used(ISLE_SLOTS, 'isle') || ISLE_SLOTS[0];
        const dx = slot[0] - ws.x, dy = slot[1] - ws.y;
        ws.zone = 'isle'; ws.x = slot[0]; ws.y = slot[1];
        for (const w of state.workers) if (w.project === body.project && w.host === body.host) { w.zone = 'isle'; w.x += dx; w.y += dy; }
      }
    } else {
      state.quarantine = state.quarantine.filter((k) => k !== key);
      if (ws && zoneOf(ws) === 'isle') {
        const back = origPos.get(ws.id) || (() => { const sl = used(VILLAGE_SLOTS, 'village') || VILLAGE_SLOTS[3]; return { x: sl[0], y: sl[1] }; })();
        const dx = back.x - ws.x, dy = back.y - ws.y;
        ws.zone = 'village'; ws.x = back.x; ws.y = back.y;
        for (const w of state.workers) if (w.project === body.project && w.host === body.host) { w.zone = 'village'; w.x += dx; w.y += dy; }
      }
    }
    state.feed.push({ id: `f${mockSeq++}`, ts: now, actor: 'You', text: body.on ? `You quarantined ${body.project} on the Far Isle` : `You brought ${body.project} back to The Works`, zone: body.on ? 'isle' : 'village' });
  } else if (path === '/api/tree/milestone') {
    const ws = state.workshops.find((w) => w.project === body.project && w.host === body.host);
    const zone = ws ? zoneOf(ws) : 'village';
    if (zone === 'isle' && state.seal.locked) return fail(isleLockedErr);
    const t = state.trees.find((x) => zoneOf(x) === zone);
    if (t) {
      const bid = `p:${body.project}@${body.host}`;
      let br = t.branches.find((b) => b.id === bid);
      if (!br) { br = { id: bid, name: String(body.project), contributors: ['You'], credits: 0, fruit: false, createdAt: now, keepsake: null }; t.branches.push(br); }
      br.credits += 3; if (!br.contributors.includes('You')) br.contributors.push('You');
      if (br.credits >= 9) br.fruit = true;
      t.lifetimeCredits += 3; t.blossoms += 9;
      t.blooms.push({ branchId: bid, count: 9, opensAt: now, fallsAt: now + 3 * 24 * 3600 * 1000 });
      t.recent.push({ sourceEventId: `m${mockSeq++}`, branchId: bid, amount: 3, reason: `You shared a milestone for ${body.project}${body.note ? `: “${body.note}”` : ''}`, awardedAt: now });
      if (!t.tendedToday.includes('You')) t.tendedToday.push('You');
      while (t.stage < 4 && t.lifetimeCredits >= STAGE_THRESHOLDS[t.stage + 1]) { t.stage++; t.stageName = STAGE_NAMES[t.stage]; t.nextStageAt = STAGE_THRESHOLDS[t.stage + 1] ?? null; }
      state.feed.push({ id: `f${mockSeq++}`, ts: now, actor: 'You', text: `${t.name} grew: a milestone for ${body.project}`, zone });
    }
  } else if (path === '/api/temple/offer') {
    const w = state.workers.find((x) => x.id === body.workerId);
    if (!w) return fail('No such session.');
    if (w.sealed) return fail(isleLockedErr);
    if (w.host !== 'local') return fail(`Only local sessions can lay offerings (${w.title} runs on ${w.host}).`);
    if (w.project === 'agent-deck') return fail('That session has no git changes to offer.');
    const zone = zoneOf(w);
    state.offerings = state.offerings || [];
    const id = `of${mockSeq++}`;
    state.offerings.push({ id, zone, workerId: w.id, sessionId: w.id, host: w.host, project: w.project, title: w.title, tool: w.tool, provider: w.tool === 'claude' ? 'anthropic' : w.tool === 'codex' ? 'openai' : 'google', note: body.note || '',
      kind: 'working changes', files: [`src/${w.project}/index.js`, `src/${w.project}/state.js`, 'README.md'], size: 8400 + Math.floor(Math.random() * 20000), truncated: false, headCommit: 'a1b2c3d4e5f6', diffHash: 'd9e8f7', omittedPaths: [], anchored: true,
      status: 'open', commanded: {}, reviewers: [], createdAt: now });
    state.feed.push({ id: `f${mockSeq++}`, ts: now, actor: 'You', text: `You laid an offering at the ${w.project} shrine`, zone });
  } else if (path === '/api/temple/command') {
    const o = (state.offerings || []).find((x) => x.id === body.offeringId);
    if (!o) return fail('No such offering.');
    if (o.status === 'closed') return fail('That offering is closed.');
    const names = body.residents === 'all' ? state.residents.filter((r) => zoneOf(r) === zoneOf(o) && r.rank !== 'priest').map((r) => r.name) : (Array.isArray(body.residents) ? body.residents : []);
    o.commanded = o.commanded || {};
    for (const n of names) { o.commanded[n] = body.note || ''; if (!o.reviewers.includes(n)) o.reviewers.push(n); }
    state.feed.push({ id: `f${mockSeq++}`, ts: now, actor: 'You', text: body.residents === 'all' ? `The Temple summons the village to review "${o.title}"` : `The Temple commands ${names.join(', ')} to review "${o.title}"`, zone: zoneOf(o) });
  } else if (path === '/api/temple/close') {
    const o = (state.offerings || []).find((x) => x.id === body.offeringId);
    if (!o) return fail('No such offering.');
    o.status = 'closed';
  } else if (path === '/api/findings/status') {
    const f = (state.findings || []).find((x) => x.id === body.id);
    if (!f) return fail('No such finding.');
    if (!['rejected', 'decreed', 'fixed'].includes(body.status)) return fail('Unknown status.');
    if (body.status === 'fixed' && f.status !== 'decreed') return fail('Only a decree can be confirmed fixed.');
    f.status = body.status;
    if (body.status === 'decreed') {
      f.verdict = f.verdict || { by: 'You', verdict: 'implement', reasoning: 'Decreed by the human.', ts: now };
      const approve = state.decreeMode === 'approve';
      f.delivery = { state: approve ? 'awaiting approval' : 'queued', ts: now };
      if (!approve) setTimeout(() => { if (f.delivery && f.status === 'decreed') { f.delivery = { state: 'landed', ts: Date.now() }; applyState(state); } }, 2500);
    }
    if (body.status === 'fixed') {
      const t = state.trees.find((x) => zoneOf(x) === zoneOf(f));
      if (t) {
        const bid = `p:${f.project}@local`;
        let br = t.branches.find((b) => b.id === bid || b.name === f.project);
        if (!br) { br = { id: bid, name: String(f.project), contributors: [], credits: 0, fruit: false, createdAt: now, keepsake: null }; t.branches.push(br); }
        br.credits += 2; for (const n of [f.reviewer, 'You']) if (n && !br.contributors.includes(n)) br.contributors.push(n);
        t.lifetimeCredits += 2; t.blossoms += 6;
        t.blooms.push({ branchId: br.id, count: 6, opensAt: now, fallsAt: now + 3 * 24 * 3600 * 1000 });
        t.recent.push({ sourceEventId: `fx${mockSeq++}`, branchId: br.id, amount: 2, reason: `${f.reviewer}\u2019s finding in ${f.project} was decreed and fixed`, awardedAt: now });
        if (f.reviewer && !t.tendedToday.includes(f.reviewer)) t.tendedToday.push(f.reviewer);
      }
    }
  } else if (path === '/api/commission') {
    if (!body.path || !/^(\/|~)/.test(String(body.path))) return fail('path must be absolute');
    if (!/^\/Users\/|^~/.test(String(body.path))) return fail(`agent-deck: no such folder: ${body.path}`);
    if (!['library', 'forge', 'quarry'].includes(body.site)) return fail('unknown site');
    const id = `local:c${mockSeq++}`;
    const project = String(body.path).replace(/\/+$/, '').split('/').pop() || 'project';
    state.workers.push({ id, title: body.title, tool: body.tool || 'claude', status: 'running', project, path: body.path, host: 'local', site: body.site, x: 0, y: 0, updatedAt: now, stale: false, zone: 'village', model: body.model || undefined });
    placeGodsInRings();
    state.feed.push({ id: `f${mockSeq++}`, ts: now, actor: 'You', text: `You sent a hero to ${siteLabel(body.site)}: ${body.title}`, zone: 'village' });
  } else if (path === '/api/workers/site') {
    const w = state.workers.find((x) => x.id === body.workerId);
    if (!w) return fail('No such session.');
    if (zoneOf(w) === 'isle') return fail('Quarantined sessions stay on the isle.');
    if (!['auto', 'temple', 'library', 'forge', 'quarry'].includes(body.site)) return fail('unknown site');
    w.siteAuto = body.site === 'auto';
    w.siteReason = w.siteAuto ? 'no task signals' : 'placed by you';
    if (!w.siteAuto) w.site = body.site;
    placeGodsInRings();
    state.feed.push({ id: `f${mockSeq++}`, ts: now, actor: 'You', text: `${w.title} moved to ${siteLabel(body.site)}`, zone: 'village' });
  } else if (path === '/api/counsel') {
    const c = (state.counsel || []).find((x) => x.id === body.id);
    if (!c) return fail('No such counsel.');
    if (c.status !== 'new') return fail('That counsel was already handled.');
    if (body.action === 'relay') { const w = state.workers.find((x) => x.id === c.workerId); c.status = w && w.status === 'running' ? 'relayed' : 'failed'; if (c.status === 'failed') c.error = 'session is not running'; }
    else if (body.action === 'dismiss') c.status = 'dismissed';
    else return fail('unknown action');
  } else if (path === '/api/temple/decree-mode') {
    state.decreeMode = body.mode === 'approve' ? 'approve' : 'auto';
  } else if (path === '/api/seal/setup') {
    if (String(body.passphrase || '').length < 8) return fail('The passphrase needs at least 8 characters.');
    state.seal = { enabled: true, locked: false, autoLockMinutes: 5 };
    mockSeal(true);
  } else if (path === '/api/seal/unlock') {
    if (body.passphrase !== MOCK_PASSPHRASE) return Promise.resolve({ ok: false, error: 'That is not the passphrase. The runes stay closed.' });
    mockSeal(false);
  } else if (path === '/api/seal/lock') {
    mockSeal(true);
  } else if (path === '/api/seal/touch') {
    if (state.seal?.enabled && !state.seal.locked) state.seal.locksAt = now + (state.seal.autoLockMinutes || 5) * 60000;
    return Promise.resolve(true);
  }
  applyState(state);
  return Promise.resolve(true);
}

boot();

// First-run naming offer: either choice hides it for good (the server stops sending namingOffer).
$('naming-hold').addEventListener('click', async () => { $('naming-offer').hidden = true; await api('/api/naming', { all: true }); });
$('naming-skip').addEventListener('click', async () => { $('naming-offer').hidden = true; await api('/api/naming/skip'); });
