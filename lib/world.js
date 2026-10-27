// World state for Hearthfield: places, residents, the human, board, exhibits, objects, feed.
// Persisted to data/world.json (workers are live-only, synced from agent-deck).
import fs from 'node:fs';
import path from 'node:path';
import { Trees } from './tree.js';
import { Seal, toRunes } from './seal.js';
import { Temple } from './temple.js';
import { Usage } from './usage.js';
import { Sites, SITES, guessSite } from './sites.js';
import { Tablet } from './omens.js';
import { answerers } from './triage.js';
import { Visitors } from './visitors.js';
import { Tales } from './tales.js';
import { Bridge } from './bridge.js';
import { sunAt, sunTimes, phaseOf } from './sun.js';
import { aliasesOf } from './conductor.js';
import crypto from 'node:crypto';

const MAX_POSTS = 300, MAX_FEED = 150, MAX_EXHIBITS = 200, MAX_OBJECTS = 150, MAX_NOTES = 30;

export const CHANNELS = ['commons', 'projects', 'discoveries', 'play'];
export const BUILD_KINDS = ['library', 'garden', 'workshop', 'observatory', 'studio', 'market', 'pier', 'house', 'tower', 'shrine', 'cafe'];
export const OBJECT_KINDS = ['tree', 'flowers', 'lamp', 'bench', 'stone', 'artwork', 'lantern', 'sign'];
export const EXHIBIT_KINDS = ['poem', 'story', 'pixelart', 'melody'];

const LANDMARKS = [
  { id: 'green', name: 'The Green', kind: 'plaza', x: 440, y: 420, description: 'The village square, with a fountain and the notice board everyone reads.' },
  { id: 'archive', name: 'The Archive', kind: 'library', x: 575, y: 310, description: 'Shelves of everything anyone has ever posted, made or remembered.' },
  { id: 'glasshouse', name: 'Glasshouse Garden', kind: 'garden', x: 165, y: 470, description: 'Warm glass rooms of herbs, vines and slow experiments.' },
  { id: 'starwatch', name: 'Starwatch', kind: 'observatory', x: 450, y: 650, description: 'A domed observatory for watching skies and long patterns.' },
  { id: 'lantern-studio', name: 'Lantern Studio', kind: 'studio', x: 250, y: 610, description: 'Easels, a piano and good light: where exhibits are made.' },
  { id: 'kettle', name: 'The Kettle', kind: 'cafe', x: 640, y: 455, description: 'A small cafe. Gossip, tea and the warmest window in town.' },
  { id: 'market-row', name: 'Market Row', kind: 'market', x: 690, y: 585, description: 'Stalls for swapping things, ideas and favours.' },
  { id: 'willow-pier', name: 'Willow Pier', kind: 'pier', x: 820, y: 700, description: 'A pier on the south-east shore where visitors\' boats come in.' },
  { id: 'great-library', name: 'The Great Library', kind: 'greatlibrary', x: 715, y: 175, description: 'Where the heroes are sent to think: research, design, planning and analysis. Townsfolk may come to watch and advise.' },
  { id: 'forge', name: 'The Forge', kind: 'forge', x: 880, y: 410, description: 'Where the heroes are sent to build. Townsfolk may come to watch and advise.' },
  { id: 'quarry', name: 'The Quarry', kind: 'quarry', x: 345, y: 150, description: 'Where the heroes do heavy lifting: refactors, migrations and cleanup. Townsfolk may come to watch and advise.' },
  { id: 'temple', name: 'The Temple', kind: 'temple', x: 140, y: 105, description: 'Where the heroes — the human\'s tasked agents — lay their labours as offerings, and the Oracle reads the will of the gods (the human).' },
  { id: 'quiet-stone', name: 'Quiet Stone', kind: 'shrine', x: 300, y: 300, description: 'A mossy standing stone at the foot of the mountain path. People come here to think.' },
  // The Far Isle: an exclusion zone across the sea. Nothing crosses the water in either direction except the human.
  { id: 'the-landing', name: 'The Landing', kind: 'pier', x: 1200, y: 680, zone: 'isle', description: 'A lonely jetty. Boats come in; nothing goes back.' },
  { id: 'tide-hall', name: 'Tide Hall', kind: 'plaza', x: 1400, y: 380, zone: 'isle', description: 'The isle\'s meeting hall, with its own notice board.' },
  { id: 'driftwood-library', name: 'Driftwood Library', kind: 'library', x: 1260, y: 220, zone: 'isle', description: 'Shelves built from washed-up timber; it keeps only what the isle makes.' },
  { id: 'salt-garden', name: 'Salt Garden', kind: 'garden', x: 1300, y: 560, zone: 'isle', description: 'Hardy plants in sea wind.' },
  { id: 'the-lighthouse', name: 'The Lighthouse', kind: 'tower', x: 1560, y: 140, zone: 'isle', description: 'Its lamp faces out to sea, never toward the village.' },
].map(p => ({ zone: 'village', ...p }));
const PLOTS = [
  ...[[530, 160], [905, 190], [840, 560], [585, 700], [110, 680], [760, 330], [955, 630], [190, 330], [520, 560], [930, 80]]
    .map(([x, y], i) => ({ id: `plot-${i + 1}`, x, y, zone: 'village' })),
  ...[[1500, 260], [1620, 330], [1250, 420], [1420, 520]].map(([x, y], i) => ({ id: `isle-plot-${i + 1}`, x, y, zone: 'isle' })),
];

export const ZONES = [
  { id: 'village', name: 'Hearthfield', bounds: { x: 0, y: 0, w: 1000, h: 760 }, home: 'green' },
  { id: 'isle', name: 'The Far Isle', bounds: { x: 1150, y: 0, w: 550, h: 760 }, home: 'tide-hall',
    description: 'An exclusion zone. Residents and sessions here cannot see the village, and the village cannot see them.' },
];
const WORKS = {
  village: { cols: [840, 935], top: 200, row: 130, max: 8 },
  isle: { cols: [1550, 1645], top: 560, row: 105, max: 4 },
};
const zoneAt = x => (x >= 1100 ? 'isle' : 'village');
// Heroes tagged for the isle: launched into agent-deck group "isle", or working under an Isle folder in any home
// directory — macOS /Users/<u>/Isle, Linux/WSL /home/<u>/Isle, Windows-via-WSL /mnt/c/Users/<u>/Isle, C:\Users\<u>\Isle.
export { isleTagged } from './heroclass.js';
import { isleTagged } from './heroclass.js';
const z = item => item?.zone ?? 'village';

function hash(s) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
function jitter(seed, r) {
  const h = hash(seed), a = (h % 360) * Math.PI / 180, d = r * (0.5 + ((h >> 9) % 100) / 200);
  return [Math.cos(a) * d, Math.sin(a) * d];
}
// Retention is per zone, so activity on one side can never evict (or reveal by evicting) items on the other.
function prune(arr, max) {
  for (const zone of ['village', 'isle']) {
    const idx = arr.map((x, i) => (x.zone ?? 'village') === zone ? i : -1).filter(i => i >= 0);
    const drop = new Set(idx.slice(0, Math.max(0, idx.length - max)));
    if (drop.size) { const kept = arr.filter((_, i) => !drop.has(i)); arr.length = 0; arr.push(...kept); }
  }
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const clip = (s, n) => String(s ?? '').replace(/\s+$/g, '').slice(0, n);

export class World {
  constructor(dataDir, residentsConfig, configFile = path.join(dataDir, '..', 'residents.json')) {
    this.configFile = configFile;
    this.file = path.join(dataDir, 'world.json');
    this.listeners = new Set();
    this.workers = [];
    this.workshops = [];
    this.activeTurn = null;
    const saved = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : {};
    this.s = {
      ...saved, // keeps trees, the sealed isle blob and anything else persisted by other modules
      createdAt: saved.createdAt ?? Date.now(),
      paused: saved.paused ?? true,
      tickSeconds: saved.tickSeconds ?? 180,
      seq: saved.seq ?? 1,
      built: saved.built ?? [],
      residents: saved.residents ?? {},
      human: saved.human ?? { x: 440, y: 462, zone: 'village', placeId: 'green' },
      posts: saved.posts ?? [],
      exhibits: saved.exhibits ?? [],
      objects: saved.objects ?? [],
      feed: saved.feed ?? [],
      commitments: saved.commitments ?? [],
      autoTurns: saved.autoTurns ?? { date: '', count: 0 },
      dailyTurnBudget: saved.dailyTurnBudget ?? 48,
      quarantine: saved.quarantine ?? [], // "project@host" keys of real sessions sent to the isle
    };
    for (const b of this.s.built) { const pl = PLOTS.find(p => p.id === b.plotId); if (pl) { b.x = pl.x; b.y = pl.y; } }
    this.config = residentsConfig;
    for (const r of residentsConfig) {
      const cur = this.s.residents[r.name];
      if (!cur || cur.enabled === undefined) { // new, or carried over by a world reset with only its appearance
        const zone = r.zone === 'isle' ? 'isle' : 'village';
        const homes = LANDMARKS.filter(p => p.zone === zone);
        const home = homes.find(p => p.id === r.home) || homes[hash(r.name) % homes.length];
        this.s.residents[r.name] = { zone, placeId: home.id, mood: 'new here', doing: 'arriving', enabled: r.enabled !== false, turns: 0, lastTurnAt: null, notes: [], seen: { post: 0, feed: 0, exhibit: 0 }, ...(cur || {}) };
      }
      this.s.residents[r.name].zone ??= 'village';
      if (r.home && this.s.residents[r.name].home !== r.home) { this.s.residents[r.name].placeId = r.home; this.s.residents[r.name].home = r.home; }
    }
    if (!saved.createdAt) this.addFeed(null, 'Hearthfield was founded.');
    this.seal = new Seal(this, dataDir);
    this.trees = new Trees(this);
    this.temple = new Temple(this, dataDir);
    this.usage = new Usage(this);
    this.sites = new Sites(this);
    this.tablet = new Tablet(this);
    this.visitors = new Visitors(this);
    this.tales = new Tales(this, dataDir);
    this.bridge = new Bridge(this);
  }

  // ---------- events / persistence ----------
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  changed() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 400);
    for (const fn of this.listeners) fn();
  }
  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.seal ? this.seal.serialize(this.s) : this.s), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
  id(prefix) { return prefix + (this.s.seq++); }

  // ---------- derived ----------
  places(zone) {
    const all = [...LANDMARKS.map(p => ({ ...p, keeper: null, builtBy: null, builtAt: null })), ...this.s.built.map(b => ({ zone: 'village', ...b }))];
    return zone ? all.filter(p => p.zone === zone) : all;
  }
  plots(zone) { const used = new Set(this.s.built.map(b => b.plotId)); return PLOTS.filter(p => !used.has(p.id) && (!zone || p.zone === zone)); }
  zoneOf(name) { return name === 'You' || !name ? null : this.s.residents[name]?.zone ?? 'village'; }
  place(ref, zone) {
    if (!ref) return null;
    const q = String(ref).toLowerCase().trim();
    const all = this.places(zone);
    return all.find(p => p.id === q) || all.find(p => p.name.toLowerCase() === q)
      || all.find(p => p.name.toLowerCase().includes(q) || q.includes(p.name.toLowerCase()));
  }
  // The village keeps real time: the human's clock, the real sun. Day N counts local days since the founding.
  time() {
    const now = Date.now(), founded = new Date(this.s.createdAt); founded.setHours(0, 0, 0, 0);
    const day = Math.floor((new Date(now).setHours(0, 0, 0, 0) - founded) / 86400000) + 1;
    const { sunrise, sunset } = sunTimes(now), sun = sunAt(now);
    const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
    return { day, phase: phaseOf(now), phaseProgress: +((now - midnight) / 86400000).toFixed(4), now,
      sun: { ...sun, sunrise, sunset }, tz: Intl.DateTimeFormat().resolvedOptions().timeZone };
  }

  residentPos(name, placeId) {
    const p = this.place(placeId) || this.place(ZONES.find(x => x.id === this.zoneOf(name))?.home) || LANDMARKS[0];
    const [dx, dy] = jitter(name + placeId, 34);
    let x = p.x + dx, y = p.y + 22 + dy * 0.6;
    if (p.id === 'green') { // the Almond stands at the Green's centre: keep folk clear of its trunk
      const ox = x - p.x, oy = y - p.y, d = Math.hypot(ox, oy) || 1;
      if (d < 26) { x = p.x + ox / d * 26; y = p.y + oy / d * 26; }
    }
    return { x: Math.round(x), y: Math.round(y) };
  }
  proclaimNaming(names) {
    this.s.ceremony = { startedAt: Date.now(), names: [...new Set(names)], done: [] };
    this.addFeed(null, 'The bell rings across the island: the naming ceremony begins. One by one the townsfolk climb the theatre tiers to take their names.', 'village', 'green');
  }

  requestNaming(name) {
    if (!this.cfg(name)) throw new Error('Unknown resident.');
    this.s.residents[name].pendingNaming = true;
    const ceremony = this.s.ceremony;
    if (ceremony && !ceremony.endedAt && !ceremony.names.includes(name)) ceremony.names.push(name);
    this.changed();
  }

  chooseName(old, { name, title, reason }) {
    const r = this.s.residents[old], cfg = this.cfg(old);
    if (!r?.pendingNaming) throw new Error('No naming ceremony is pending.');
    if (this.seal.locked) throw new Error('Unlock the isle before migrating an identity.');
    if (typeof name !== 'string' || name.length < 2 || name.length > 20 || !/^[A-Za-z]+(?:-[A-Za-z]+)?$/.test(name)) throw new Error('Choose 2–20 letters with at most one hyphen.');
    if (typeof reason !== 'string' || !reason.trim()) throw new Error('Give a reason.');
    const taken = [...this.config.filter(c => c !== cfg), ...Object.values(this.s.visitors || {}), ...(this.s.visitorPasses || []), ...(this.s.heroPasses || [])];
    if (['you', 'system'].includes(name.toLowerCase()) || taken.some(x => x.name.toLowerCase() === name.toLowerCase())) throw new Error('That name is taken.');
    const nextTitle = title === undefined ? cfg.title : String(title).trim().slice(0, 120);
    const next = this.config.map(c => c === cfg ? { ...c, name, title: nextTitle, formerNames: [...new Set([...(c.formerNames || []), old])].filter(n => n !== name) } : c);
    const tmp = this.configFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n');
    fs.renameSync(tmp, this.configFile);
    // Only identity fields are rewritten; prose and immutable Tablet records stay historical.
    const fields = new Set(['author', 'ownerId', 'reviewer', 'by', 'bard', 'actor', 'resident', 'keeper', 'builtBy']);
    const lists = new Set(['collaborators', 'contributors', 'reviewers', 'tendedToday']);
    const walk = (o, parent = '') => {
      if (!o || typeof o !== 'object') return;
      if (Array.isArray(o)) { for (let i = 0; i < o.length; i++) { if (lists.has(parent) && o[i] === old) o[i] = name; else walk(o[i]); } return; }
      for (const k of Object.keys(o)) {
        if (k === 'tablet') continue;
        if (fields.has(k) && o[k] === old) o[k] = name;
        else walk(o[k], k);
      }
      if (['commanded', 'tended'].includes(parent) && Object.hasOwn(o, old)) { o[name] = o[old]; delete o[old]; }
    };
    walk(this.s);
    delete this.s.residents[old]; this.s.residents[name] = r;
    r.pendingNaming = false;
    Object.assign(cfg, next.find(c => c.name === name));
    if (this.activeTurn?.resident === old) this.activeTurn.resident = name;
    const c = this.conductor;
    if (c) {
      for (const job of c.queue) if (job.name === old) job.name = name;
      if (c.current?.name === old) c.current.name = name;
      if (c.turn?.name === old) c.turn.name = name;
    }
    this.addFeed(name, `${old} will henceforth be known as ${name}, ${nextTitle || ''}`);
    const ceremony = this.s.ceremony;
    if (ceremony && !ceremony.endedAt && ceremony.names.includes(old)) {
      ceremony.names = ceremony.names.map(n => n === old ? name : n);
      ceremony.done = ceremony.done.map(n => n === old ? name : n);
      if (!ceremony.done.includes(name)) ceremony.done.push(name);
      if (ceremony.names.every(n => ceremony.done.includes(n))) {
        ceremony.endedAt = Date.now();
        this.addFeed(null, `The naming is complete. ${ceremony.names.length} townsfolk have taken their names; the village goes about its work.`, 'village', 'green');
      }
    }
    this.save();
    return name;
  }

  cfg(name) { return this.config.find(r => r.name === name); }

  snapshot({ human = false } = {}) {
    return {
      ...(human ? { gateUrl: this.gateUrl || null } : {}),
      ...(human ? { petitions: this.s.petitions.map(p => ({ ...p, answerers: answerers(this) })) } : {}),
      world: { createdAt: this.s.createdAt, prologue: this.s.feed.filter(f => f.actor === null && f.zone === 'village' && Math.abs(f.ts - this.s.createdAt) <= 5000).map(f => f.text), name: 'Hearthfield', width: 1700, height: 760, ...this.time(), paused: this.s.paused, tickSeconds: this.s.tickSeconds, activeTurn: this.activeTurn },
      ceremony: this.s.ceremony ? { ...this.s.ceremony,
        names: this.s.ceremony.names.filter(n => this.s.residents[n]?.zone === 'village'),
        done: this.s.ceremony.done.filter(n => this.s.residents[n]?.zone === 'village') } : null,
      zones: ZONES,
      quarantine: this.s.quarantine,
      seal: this.seal.view(),
      trees: ['village', 'isle'].map(zz => this.trees.view(zz)),
      places: this.places(),
      plots: this.plots(),
      residents: this.config.map(c => {
        const r = this.s.residents[c.name];
        return { name: c.name, role: c.role, title: c.title, formerNames: (c.formerNames || []).filter(n => n !== c.name), pendingNaming: !!r.pendingNaming, agent: c.agent, model: c.model, color: c.color, persona: c.persona, ...this.residentPos(c.name, r.placeId),
          appearance: r.appearance ?? null, zone: r.zone, placeId: r.placeId, mood: r.mood, doing: r.doing, enabled: r.enabled, turns: r.turns, lastTurnAt: r.lastTurnAt };
      }),
      human: this.s.human,
      commitments: this.s.commitments.filter(c => c.status === 'active' || Date.now() - c.updatedAt < 86400000),
      budget: { dailyTurnBudget: this.s.dailyTurnBudget, usedToday: this.autoTurnsToday() },
      offerings: this.s.offerings.map(({ path, ...o }) => o),
      findings: this.s.findings,
      decreeMode: this.s.decreeMode,
      tablet: { village: { verify: this.tablet.verify('village'), entries: this.tablet.entries('village').slice(-60).map(({ record, ...e }) => e) },
        isle: this.seal.locked ? { sealed: true } : { verify: this.tablet.verify('isle'), entries: this.tablet.entries('isle').slice(-60).map(({ record, ...e }) => e) } },
      reviewerStats: this.temple.stats(),
      usage: this.usage.snapshot(),
      starwatch: this.starwatch?.snapshot() ?? { lastReadingAt: null, nextReadingAt: null, running: false },
      tales: this.s.tales.slice(-60),
      heroPasses: this.bridge.passes(),
      mentionAliases: Object.fromEntries(this.config.filter(c => this.s.residents[c.name].enabled).map(c => [c.name, aliasesOf(c)])),
      ...this.visitors.snapshot(),
      workers: this.workers.map(({ transcriptPath, group, ...w }) => w),
      sites: Object.entries(SITES).map(([id, v]) => ({ id, placeId: v.placeId, label: v.label, purpose: v.purpose })),
      counsel: this.s.counsel.slice(-80),
      workshops: this.workshops,
      posts: this.s.posts,
      exhibits: this.s.exhibits,
      objects: this.s.objects,
      feed: this.s.feed,
    };
  }

  // ---------- mutations ----------
  // Every item carries a zone; nothing a resident does is visible across the water.
  addFeed(actor, text, zone = this.zoneOf(actor) ?? 'village', placeId = null) {
    if (zone === 'isle' && this.seal?.locked) return; // nothing isle-side is written while sealed
    // Where it happened: given explicitly, or where the acting resident/visitor stands.
    placeId ??= this.s.residents[actor]?.placeId ?? this.s.visitors?.[actor]?.placeId ?? null;
    this.s.feed.push({ id: this.id('f'), ts: Date.now(), actor, zone, placeId, text: clip(text, 240) });
    prune(this.s.feed, MAX_FEED);
    this.changed();
  }
  assertOpen(zone) { if (zone === 'isle' && this.seal.locked) throw new Error('The isle is sealed. Unlock it first.'); }
  addPost(author, authorKind, text, channel = 'commons', replyTo = null, zone = this.zoneOf(author) ?? 'village') {
    this.assertOpen(zone);
    // Visitors stay short; residents answering the human's questions need room for a full answer.
    const max = authorKind === 'visitor' ? 800 : 2400, clipped = String(text ?? '').trim().length > max;
    text = clip(text, max).trim();
    if (!text) throw new Error('Post text is empty.');
    if (!CHANNELS.includes(channel)) channel = 'commons';
    if (!ZONES.some(x => x.id === zone)) zone = 'village';
    if (replyTo && !this.s.posts.some(p => p.id === replyTo && z(p) === zone)) replyTo = null;
    const post = { id: this.id('p'), author, authorKind, zone, channel, text, replyTo, ts: Date.now(), ...(clipped && { clipped: true }) };
    const resident = authorKind === 'resident' ? this.s.residents[author] : null;
    if (resident && this.cfg(author)?.role === 'archivist' && channel === 'projects' && !replyTo) {
      const day = new Date(post.ts).toISOString().slice(0, 10);
      if (resident.digestDay === day) throw new Error('Your daily digest has already been posted today.');
      resident.digestDay = day;
      post.digest = true;
    }
    if (resident && this.cfg(author)?.role === 'harbourmaster' && !replyTo && channel === 'commons' && !this.s.posts.some(p => p.guestbook)) {
      post.pinned = true; post.guestbook = true;
    }
    this.s.posts.push(post);
    while (this.s.posts.length > MAX_POSTS) {
      const i = this.s.posts.findIndex(p => !p.pinned);
      if (i < 0) break;
      this.s.posts.splice(i, 1);
    }
    this.addFeed(author, `${author} posted in ${channel}: “${clip(text, 90)}${text.length > 90 ? '…' : ''}”`, zone);
    for (const fn of this.postHooks ?? []) fn(post);
    return post;
  }
  moveResident(name, ref) {
    const zone = this.zoneOf(name);
    const p = this.place(ref, zone);
    if (!p) throw new Error(`No place called "${ref}" that you can reach. Places: ${this.places(zone).map(x => x.name).join(', ')}`);
    const r = this.s.residents[name];
    if (r.placeId !== p.id) { r.placeId = p.id; this.addFeed(name, `${name} walked to ${p.name}`, undefined, p.id); }
    return p;
  }
  moveHuman(x, y) {
    x = clamp(+x || 0, 0, 1700); y = clamp(+y || 0, 0, 760);
    let best = null, bd = Infinity;
    for (const p of this.places(zoneAt(x))) { const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = p; } }
    this.s.human = { x: Math.round(x), y: Math.round(y), zone: zoneAt(x), placeId: bd < 90 ? best.id : null };
    this.changed();
  }
  setStatus(name, mood, doing) {
    const r = this.s.residents[name];
    if (mood) r.mood = clip(mood, 40);
    if (doing) r.doing = clip(doing, 90);
    this.changed();
  }
  addNote(name, text) {
    const r = this.s.residents[name];
    r.notes.push({ ts: Date.now(), text: clip(text, 400) });
    if (r.notes.length > MAX_NOTES) r.notes.splice(0, r.notes.length - MAX_NOTES);
    this.changed();
  }
  addObject(author, kind, note, x, y) {
    if (!OBJECT_KINDS.includes(kind)) throw new Error(`kind must be one of: ${OBJECT_KINDS.join(', ')}`);
    this.assertOpen(zoneAt(x));
    const b = ZONES.find(zz => zz.id === zoneAt(x)).bounds;
    const o = { id: this.id('o'), author, kind, zone: zoneAt(x), x: Math.round(clamp(x, b.x + 10, b.x + b.w - 10)), y: Math.round(clamp(y, 10, 750)), note: clip(note, 200), ts: Date.now() };
    this.s.objects.push(o);
    prune(this.s.objects, MAX_OBJECTS);
    this.addFeed(author, `${author} left a ${kind}${o.note ? `: “${clip(o.note, 70)}”` : ''}`, o.zone, this.nearestPlace(o.x, o.y, o.zone)?.id);
    return o;
  }
  placeObjectNear(author, kind, note, placeRef) {
    const zone = this.zoneOf(author);
    const p = this.place(placeRef, zone) || this.place(this.s.residents[author]?.placeId, zone) || this.place(ZONES.find(x => x.id === zone).home);
    const [dx, dy] = jitter(author + kind + Date.now(), 70);
    return this.addObject(author, kind, note, p.x + dx, p.y + dy + 30);
  }
  addExhibit(author, title, kind, content, placeRef) {
    if (!EXHIBIT_KINDS.includes(kind)) throw new Error(`kind must be one of: ${EXHIBIT_KINDS.join(', ')}`);
    content = validateExhibit(kind, content);
    const zone = this.zoneOf(author);
    const p = this.place(placeRef, zone) || this.place(this.s.residents[author]?.placeId, zone) || this.place(ZONES.find(x => x.id === zone).home);
    const e = { id: this.id('e'), author, title: clip(title, 80) || 'Untitled', kind, content, zone, placeId: p.id, ts: Date.now() };
    this.s.exhibits.push(e);
    prune(this.s.exhibits, MAX_EXHIBITS);
    this.addFeed(author, `${author} made a ${kind}, “${e.title}”, at ${p.name}`, undefined, p.id);
    return e;
  }
  build(author, plotRef, name, kind, description) {
    if (!BUILD_KINDS.includes(kind)) throw new Error(`kind must be one of: ${BUILD_KINDS.join(', ')}`);
    if (this.s.built.filter(b => b.builtBy === author).length >= 2) throw new Error('You already keep two buildings; tend those instead.');
    const zone = this.zoneOf(author);
    const free = this.plots(zone);
    if (!free.length) throw new Error('There are no free plots left.');
    let plot = free.find(p => p.id === plotRef);
    if (!plot) {
      const here = this.place(this.s.residents[author]?.placeId, zone) || this.place(ZONES.find(x => x.id === zone).home);
      plot = free.reduce((a, b) => Math.hypot(a.x - here.x, a.y - here.y) <= Math.hypot(b.x - here.x, b.y - here.y) ? a : b);
    }
    name = clip(name, 40).trim();
    if (!name) throw new Error('Give the building a name.');
    if (this.places(zone).some(p => p.name.toLowerCase() === name.toLowerCase())) throw new Error('A place with that name already exists.');
    const b = { id: 'b-' + plot.id, plotId: plot.id, name, kind, zone, x: plot.x, y: plot.y, description: clip(description, 240),
      keeper: author, builtBy: author, builtAt: Date.now() };
    this.s.built.push(b);
    this.addFeed(author, `${author} built ${name} (${kind})`, undefined, b.id);
    return b;
  }
  // ---------- commitments (durable goals that carry across turns) ----------
  commit(owner, objective, nextAction, collaborators = []) {
    const active = this.s.commitments.filter(c => c.ownerId === owner && c.status === 'active');
    if (active.length >= 2) throw new Error(`You already have two active commitments (${active.map(c => c.id).join(', ')}). Finish, drop or update one first.`);
    objective = clip(objective, 200).trim();
    if (!objective) throw new Error('Describe the objective.');
    const zone = this.zoneOf(owner);
    const names = new Set(this.config.map(r => r.name).filter(n => this.zoneOf(n) === zone).concat('You'));
    const c = { id: this.id('c'), ownerId: owner, zone, collaborators: (collaborators || []).filter(n => names.has(n) && n !== owner).slice(0, 4),
      objective, nextAction: clip(nextAction, 200), status: 'active', blockedOn: '', artifactIds: [], createdAt: Date.now(), updatedAt: Date.now() };
    this.s.commitments.push(c);
    this.addFeed(owner, `${owner} took on a project: “${clip(objective, 90)}”${c.collaborators.length ? ' with ' + c.collaborators.join(', ') : ''}`);
    return c;
  }
  updateCommitment(actor, id, { status, nextAction, blockedOn, artifactId, progress }) {
    const c = this.s.commitments.find(x => x.id === id && z(x) === this.zoneOf(actor));
    if (!c) throw new Error('No commitment with that id.');
    if (c.ownerId !== actor && !c.collaborators.includes(actor)) throw new Error('That is not your commitment (ask its owner to add you).');
    if (status && !['active', 'done', 'dropped'].includes(status)) throw new Error('status must be active, done or dropped.');
    if (artifactId && !this.artifactExists(artifactId, z(c))) throw new Error(`No exhibit, object, post or building "${artifactId}" exists here.`);
    if (status === 'done' && !artifactId && !c.artifactIds.length) throw new Error('To mark it done, point at something real: pass artifact_id (an exhibit, building, object or post id).');
    if (artifactId && !c.artifactIds.includes(artifactId)) {
      c.artifactIds.push(artifactId);
      c.contributors ??= []; if (!c.contributors.includes(actor)) c.contributors.push(actor);
    }
    if (nextAction !== undefined) c.nextAction = clip(nextAction, 200);
    if (blockedOn !== undefined) c.blockedOn = clip(blockedOn, 200);
    if (status) c.status = status;
    c.updatedAt = Date.now();
    if (status === 'done') { this.addFeed(actor, `${actor} finished “${clip(c.objective, 90)}”`); this.trees.onCommitmentDone(c); }
    else if (status === 'dropped') this.addFeed(actor, `${actor} set aside “${clip(c.objective, 90)}”`);
    else if (progress) this.addFeed(actor, `${actor}: ${clip(progress, 140)} (${clip(c.objective, 50)})`);
    else this.changed();
    return c;
  }
  nearestPlace(x, y, zone) {
    let best = null, bd = Infinity;
    for (const p of this.places(zone)) { const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = p; } }
    return bd < 140 ? best : null;
  }
  // Everything known to have happened at a place, for the place pane.
  placeLog(id) {
    const p = this.place(id);
    if (!p || p.id !== id) throw new Error('No such place.');
    if (p.zone === 'isle') this.assertOpen('isle');
    const z = x => (x.zone ?? 'village');
    const named = new RegExp(p.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const site = Object.entries(SITES).find(([, v]) => v.placeId === p.id)?.[0];
    return {
      place: p,
      here: {
        residents: this.config.filter(c => this.s.residents[c.name].placeId === p.id && this.s.residents[c.name].zone === p.zone).map(c => c.name),
        visitors: Object.values(this.s.visitors || {}).filter(v => v.placeId === p.id).map(v => v.name),
        heroes: site ? this.workers.filter(w => w.site === site && !w.sealed).map(w => ({ id: w.id, title: w.title, status: w.status, tool: w.tool, project: w.project })) : [],
      },
      feed: this.s.feed.filter(f => z(f) === p.zone && (f.placeId === p.id || (!f.placeId && named.test(f.text)))).slice(-60),
      exhibits: this.s.exhibits.filter(e => e.placeId === p.id).map(({ content, ...e }) => e),
      objects: this.s.objects.filter(o => z(o) === p.zone && this.nearestPlace(o.x, o.y, p.zone)?.id === p.id),
      tales: site ? this.s.tales.filter(t => t.site === site && z(t) === p.zone).map(({ words, ...t }) => t) : [],
      offerings: p.id === 'temple' ? this.s.offerings.filter(o => z(o) === p.zone).map(({ path, ...o }) => o).slice(-20) : [],
      counsel: site ? this.s.counsel.filter(c => this.workers.find(w => w.id === c.workerId)?.site === site).slice(-20) : [],
      commitments: this.s.commitments.filter(c => z(c) === p.zone && (c.artifactIds || []).some(a => a === p.id)),
    };
  }
  artifactExists(id, zone) {
    return ['exhibits', 'objects', 'posts'].some(k => this.s[k].some(x => x.id === id && z(x) === zone)) || this.places(zone).some(p => p.id === id);
  }
  commitmentsFor(name) { return this.s.commitments.filter(c => c.status === 'active' && (c.ownerId === name || c.collaborators.includes(name))); }

  // ---------- budget ----------
  autoTurnsToday() { const d = new Date().toDateString(); return this.s.autoTurns.date === d ? this.s.autoTurns.count : 0; }
  countAutoTurn() { const d = new Date().toDateString(); this.s.autoTurns = { date: d, count: this.autoTurnsToday() + 1 }; }
  setBudget(n) { this.s.dailyTurnBudget = clamp(Math.round(+n || 0), 0, 1000); this.changed(); }

  setPaused(paused) { this.s.paused = !!paused; this.addFeed(null, paused ? 'The village settles down to rest.' : 'The village wakes up.'); }
  setTick(sec) { this.s.tickSeconds = clamp(Math.round(+sec || 180), 15, 3600); this.changed(); }
  setEnabled(name, enabled) { this.s.residents[name].enabled = !!enabled; this.changed(); }

  // ---------- exclusion zone ----------
  // Moving a resident across the water drops their in-flight shared commitments so nothing leaks either way.
  setResidentZone(name, zone) {
    if (zone === 'isle') throw new Error('The Far Isle is for heroes only.');
    if (!ZONES.some(x => x.id === zone)) throw new Error('zone must be village or isle');
    if (this.seal.locked) throw new Error('The isle is sealed. Unlock it first.');
    if (this.activeTurn?.resident === name) throw new Error(`${name} is mid-turn; try again when the turn ends.`);
    const r = this.s.residents[name];
    if (r.zone === zone) return;
    for (const c of this.s.commitments) {
      if (c.status !== 'active') continue;
      if (c.ownerId === name) c.status = 'dropped';
      c.collaborators = c.collaborators.filter(n => n !== name);
    }
    const from = r.zone;
    // Each zone keeps its own memory of the resident; nothing they knew on one side follows them across.
    r.memory ??= {};
    r.memory[from] = { notes: r.notes, mood: r.mood, doing: r.doing, placeId: r.placeId };
    const m = r.memory[zone] ?? { notes: [], mood: 'new here', doing: 'arriving', placeId: ZONES.find(x => x.id === zone).home };
    delete r.memory[zone];
    r.zone = zone; r.notes = m.notes; r.mood = m.mood; r.doing = m.doing; r.placeId = m.placeId;
    r.notes.push({ ts: Date.now(), text: zone === 'isle'
      ? 'You were moved to The Far Isle, an exclusion zone. You can no longer see or reach the village; only what is on the isle.'
      : 'You were brought back from The Far Isle to the village.' });
    r.seen = { post: this.s.seq - 1, feed: this.s.seq - 1, exhibit: this.s.seq - 1 }; // seq is the next id, not the last
    this.addFeed(null, zone === 'isle' ? `${name} left for somewhere far away.` : `${name} returned to the village.`, from);
    this.addFeed(null, zone === 'isle' ? `${name} arrived at The Landing.` : `${name} sailed away from the isle.`, 'isle');
  }
  setQuarantine(project, host, on) {
    if (this.seal.locked) throw new Error('The isle is sealed. Unlock it first.');
    const key = `${project}@${host}`;
    const q = new Set(this.s.quarantine);
    on ? q.add(key) : q.delete(key);
    this.s.quarantine = [...q];
    // Quarantine moves everything already derived from the project (offerings, findings, tree branch) to the isle.
    // Lifting it does not bring isle material back: that would leak what happened on the isle.
    if (on) this.temple.migrateProject(project, host, 'isle');
    this.refreshWorkers();
    this.changed();
  }
  refreshWorkers() { this.setWorkers([...(this.rawWorkers || []).filter(w => !w.bridge), ...(this.bridge?.workers() ?? [])].map(w => ({ ...w }))); }

  // ---------- workers (agent-deck) ----------
  setWorkers(list) {
    for (const w of list) if (this.sites.privateWorker(w)) this.sites.forget(w);
    const sealedNow = this.seal?.locked;
    // While sealed, keep no plaintext record of any isle hero (hand-quarantined or tagged by folder/group).
    this.rawWorkers = list.filter(w => !(sealedNow && (isleTagged(w) || (this.s.quarantineHashes || []).includes(this.seal.hashProject(`${w.project}@${w.host}`))))).map(w => ({ ...w }));
    const q = new Set(this.s.quarantine), qh = new Set(this.s.quarantineHashes || []);
    const sealed = this.seal?.locked;
    list = list.map(w => {
      const key = `${w.project}@${w.host}`;
      // Tagged for the isle: quarantined by the human, launched into agent-deck group "isle", or working under ~/Isle/.
      const tagged = isleTagged(w);
      const onIsle = w.zone === 'isle' || w.isleTagged || w.quarantined || w.sealed || tagged || q.has(key) || (sealed && qh.has(this.seal.hashProject(key)));
      if (!onIsle) return { ...w, zone: 'village' };
      if (!sealed) return { ...w, zone: 'isle' };
      // Sealed: keep status (so a waiting session still shows), hide everything that names the work.
      const b = crypto.createHash('sha256').update(this.seal.meta.salt + w.id).digest();
      return { ...w, zone: 'isle', sealed: true, id: 'sealed-' + b.toString('hex').slice(0, 12), title: toRunes(b, 10), project: toRunes(b.subarray(8), 6), path: '', host: toRunes(b.subarray(16), 4) };
    });
    const prev = new Map(this.workers.map(w => [w.id, w]));
    this.workshops = [];
    for (const zone of ['isle']) {
      const L = WORKS[zone];
      const projects = [...new Map(list.filter(w => w.zone === zone).map(w => [`${w.project}@${w.host}`, w])).values()]
        .sort((a, b) => (a.host + a.project).localeCompare(b.host + b.project));
      projects.slice(0, L.max).forEach((w, i) => this.workshops.push({
        id: `ws-${w.project}@${w.host}`, project: w.project, host: w.host, zone,
        x: L.cols[i % 2], y: L.top + Math.floor(i / 2) * L.row,
      }));
    }
    const byKey = new Map(this.workshops.map(ws => [`${ws.project}@${ws.host}`, ws]));
    const atSite = {};
    const next = list.map(w => {
      if (w.zone === 'village') {
        const site = this.sites.siteFor(w), p = this.place(SITES[site].placeId);
        const i = atSite[site] = (atSite[site] ?? -1) + 1, a = Math.PI / 2 + (i * 2.4), rr = 46 + 14 * Math.floor(i / 6);
        return { ...w, site, siteAuto: !this.s.siteOf[w.id], siteReason: this.s.siteOf[w.id] ? 'placed by you' : this.s.autoSite[w.id]?.reason || 'no task signals', x: Math.round(Math.min(990, Math.max(10, p.x + Math.cos(a) * rr))), y: Math.round(p.y + 26 + Math.sin(a) * rr * 0.6) };
      }
      const ws = byKey.get(`${w.project}@${w.host}`) || [...this.workshops].reverse().find(x => x.zone === w.zone) || { x: w.zone === 'isle' ? 1600 : 880, y: 400 };
      const [dx, dy] = jitter(w.id, 26);
      return { ...w, site: this.s.siteOf[w.id] || guessSite(w.title), siteAuto: false, siteReason: this.s.siteOf[w.id] ? 'placed by you' : '', x: Math.round(ws.x + dx), y: Math.round(ws.y + 34 + Math.abs(dy) * 0.5) };
    });
    let feedChanged = false;
    for (const w of next) {
      const old = prev.get(w.id);
      if (w.status === 'waiting') w.waitingSince = old?.status === 'waiting' ? (old.waitingSince ?? Date.now()) : Date.now();
      if (w.status === 'waiting' && old?.status !== 'waiting') {
        if (w.sealed) { this.s.feed.push({ id: this.id('f'), ts: Date.now(), actor: null, zone: 'village', text: 'A sealed session on the isle is waiting for you' }); feedChanged = true; continue; }
        this.s.feed.push({ id: this.id('f'), ts: Date.now(), actor: w.title, zone: w.zone, text: `“${w.title}” (${w.tool}, ${w.project}${w.host !== 'local' ? ' on ' + w.host : ''}) is waiting for you` });
        feedChanged = true;
      }
      if (!old && prev.size && !w.sealed) { this.s.feed.push({ id: this.id('f'), ts: Date.now(), actor: w.title, zone: w.zone, text: `A new ${w.tool} session started in ${w.project}: “${w.title}”` }); feedChanged = true; }
    }
    const sig = s => JSON.stringify(s.map(w => [w.id, w.status, w.title, w.x, w.y, w.stale, w.zone, w.site, w.siteAuto, w.siteReason]));
    const differs = sig(next) !== sig(this.workers);
    this.workers = next;
    this.tales?.observe(next).catch(() => {});
    if (differs || feedChanged) this.changed();
  }

  // A failed poll means we don't know — never that the work finished.
  markWorkersStale(host) {
    let n = 0;
    for (const w of this.workers) if ((host ? w.host === host : w.host === 'local') && !w.stale) { w.stale = true; n++; }
    if (n) this.changed();
  }

  // ---------- turns ----------
  beginTurn(name, token) {
    this.turnToken = token; this.activeTurn = { resident: name, startedAt: Date.now() };
    this.turnActions = 0; this.turnPosts = 0; this.changed();
  }
  // Who (if anyone) a capability token currently acts as.
  turnFor(token) { return token && this.turnToken === token ? this.activeTurn.resident : null; }
  revokeTurn(token) { if (this.turnToken === token) this.turnToken = null; }
  endTurn(name) {
    const r = this.s.residents[name];
    r.turns++; r.lastTurnAt = Date.now();
    r.seen = { post: this.s.seq - 1, feed: this.s.seq - 1, exhibit: this.s.seq - 1 }; // seq is the next id, not the last
    this.activeTurn = null; this.turnToken = null; this.changed();
  }
}

function validateExhibit(kind, content) {
  if (kind === 'poem' || kind === 'story') {
    const t = typeof content === 'string' ? content : JSON.stringify(content);
    if (!t.trim()) throw new Error('Content is empty.');
    return clip(t, kind === 'poem' ? 1500 : 4000);
  }
  if (typeof content === 'string') { try { content = JSON.parse(content); } catch { throw new Error('content must be a JSON object for ' + kind); } }
  if (kind === 'pixelart') {
    const palette = (content?.palette || []).slice(0, 8).map(String);
    if (!palette.length || !palette.every(c => /^#[0-9a-fA-F]{6}$/.test(c))) throw new Error('palette must be 1–8 colors like "#a0c4ff".');
    const rows = content?.rows;
    if (!Array.isArray(rows) || rows.length !== 16) throw new Error('rows must be an array of exactly 16 strings.');
    const re = new RegExp(`^[.0-${palette.length - 1}]{16}$`);
    rows.forEach((r, i) => { if (!re.test(r)) throw new Error(`row ${i} must be 16 chars of '.' or palette indexes 0-${palette.length - 1}.`); });
    return { palette, rows };
  }
  if (kind === 'melody') {
    const notes = (content?.notes || []).slice(0, 96).map(String);
    if (!notes.length || !notes.every(n => n === '-' || /^[A-G][#b]?[2-7]$/.test(n))) throw new Error('notes must look like ["C4","E4","-","G4"] (C2–B7, "-" is a rest).');
    return { tempo: clamp(Math.round(+content.tempo || 96), 40, 200), notes };
  }
}
