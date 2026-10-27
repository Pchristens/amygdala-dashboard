// Reset Amygdala to a blank slate. Run with the server STOPPED:  node tools/reset-world.mjs
// Archives everything in data/ (except archive/, homes/, codex-home/) to data/archive/<timestamp>/, then writes a fresh
// world.json that keeps only operations: usage history, active hero/visitor passes, and residents' self-chosen
// appearances. The story (posts, exhibits, tree, tales, omens, commitments, built places, memories) starts over.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATA = path.join(ROOT, 'data');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const ARCHIVE = path.join(DATA, 'archive', stamp);
const KEEP_IN_PLACE = new Set(['archive', 'homes', 'codex-home']);

const worldFile = path.join(DATA, 'world.json');
const old = fs.existsSync(worldFile) ? JSON.parse(fs.readFileSync(worldFile, 'utf8')) : {};
if (old.sealed) {
  console.error('The isle is sealed in this world: its records are encrypted and would be archived as-is (still sealed).');
}

fs.mkdirSync(ARCHIVE, { recursive: true });
for (const name of fs.readdirSync(DATA)) {
  if (KEEP_IN_PLACE.has(name)) continue;
  fs.renameSync(path.join(DATA, name), path.join(ARCHIVE, name));
}
fs.mkdirSync(path.join(DATA, 'logs'), { recursive: true });

const now = Date.now();
const live = p => p && !p.revoked && p.expiresAt > now;
const residents = {};
for (const [name, r] of Object.entries(old.residents || {})) {
  if (r.appearance) residents[name] = { appearance: r.appearance }; // the World constructor fills in the rest
}
const fresh = {
  createdAt: now,
  paused: true,
  tickSeconds: old.tickSeconds ?? 600,
  dailyTurnBudget: old.dailyTurnBudget ?? 24,
  decreeMode: old.decreeMode ?? 'auto',
  seq: (old.seq ?? 1) + 1000, // keep ids unique across the archive boundary
  usage: old.usage ?? [],
  usageDaily: old.usageDaily ?? [],
  heroPasses: (old.heroPasses ?? []).filter(live),
  visitorPasses: (old.visitorPasses ?? []).filter(live),
  residents,
  feed: [
    { id: 'f1', ts: now, actor: null, zone: 'village', placeId: 'willow-pier',
      text: 'Dawn over a new island. The old village sleeps in the Archive; here, the first lamps are lit.' },
    { id: 'f2', ts: now + 1, actor: null, zone: 'village', placeId: 'green',
      text: 'On the Green, a young almond waits for its first blossom. On the mountain, the Temple stands empty.' },
    { id: 'f3', ts: now + 2, actor: null, zone: 'village', placeId: 'quiet-stone',
      text: 'The townsfolk will come up the path one by one, to take their names and their work.' },
  ],
};
fs.writeFileSync(worldFile, JSON.stringify(fresh), { mode: 0o600 });
console.log(`Archived the old world to ${path.relative(ROOT, ARCHIVE)}`);
console.log(`Fresh world: ${Object.keys(residents).length} appearances kept, ${fresh.heroPasses.length} hero passes, ${fresh.visitorPasses.length} visitor passes, usage history ${fresh.usage.length} records.`);
