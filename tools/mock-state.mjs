// Writes public/mock-state.json (gitignored; or --out <file>): a synthetic human snapshot for the client-only preview (?mock=1).
// Builds a throwaway World in a temp directory from the committed roster, so the shape always matches the server's,
// with invented heroes only: a few at work and `--hall N` resting in the Hall of Heroes. Nothing here reads data/.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { World } from '../lib/world.js';
import { Usage } from '../lib/usage.js';
Usage.prototype.pollDeck = () => {}; Usage.prototype.probe = () => {};
const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const hallN = Math.max(0, +arg('--hall', 5) || 0), out = arg('--out', path.join(root, 'public', 'mock-state.json'));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amygdala-mock-'));
const roster = JSON.parse(fs.readFileSync(path.join(root, 'residents.json'), 'utf8')).filter(r => r.zone !== 'isle');
let world;
try {
  world = new World(dir, roster, path.join(dir, 'residents.json'));
  const now = Date.now(), tools = ['claude', 'codex', 'antigravity', 'grok'], sites = ['forge', 'library', 'quarry', 'temple'];
  const titles = ['Mend the tide tables', 'Chart the western reef', 'Raise the granary roof', 'Teach the loom a new weave', 'Count the lighthouse stairs', 'Sort the archive by moon', 'Patch the cistern seams', 'Draft the harbour charter', 'Tune the bell tower', 'Trace the old aqueduct'];
  const hero = (i, status, extra) => ({ id: `local:h${i}`, sessionId: `h${i}`, title: titles[i % titles.length] + (i >= titles.length ? ` ${Math.floor(i / titles.length) + 1}` : ''), tool: tools[i % 4], host: 'local', project: ['tideworks', 'reefchart', 'granary'][i % 3], path: `/tmp/${['tideworks', 'reefchart', 'granary'][i % 3]}`, model: 'synthetic', status, updatedAt: now - i * 60000, lastActivityAt: now - i * 3600000, ...extra });
  const live = [hero(0, 'running', {}), hero(1, 'waiting', {}), hero(2, 'idle', {})];
  const resting = Array.from({ length: hallN }, (_, i) => hero(100 + i, 'stopped', { archived: i % 3 === 0 }));
  resting.forEach((w, i) => world.sites.assign(w.id, sites[i % 4]));
  world.setWorkers([...live, ...resting]);
  world.addPost(roster[0].name, 'resident', 'The heroon is swept and the lamps are filled.', 'commons');
  const snap = world.snapshot({ human: true });
  snap.world = { ...snap.world, name: 'Amygdala', paused: false, day: 12, phase: 'morning', sun: null, now };
  fs.writeFileSync(out, JSON.stringify(snap));
  console.log(`${path.basename(out)}: ${snap.residents.length} residents, ${snap.workers.length} heroes at work, ${snap.hall.length} resting`);
} finally { if (world) { clearTimeout(world.saveTimer); clearInterval(world.seal.timer); } fs.rmSync(dir, { recursive: true, force: true }); }
