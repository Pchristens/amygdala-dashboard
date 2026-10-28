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
  // The Temple tab: open and closed offerings with findings in every state, counsel and audit lines, all invented and
  // all in the village, so the preview shows what needs the human and what is history.
  const by = (role, i = 0) => roster.find(r => r.role === role)?.name || roster[i % roster.length].name;
  const examiner = by('examiner', 7), smith = by('smith', 10), librarian = by('librarian', 2), priest = by('priest', 9);
  const prov = (n) => ({ examiner: 'openai', smith: 'google', librarian: 'anthropic', priest: 'anthropic' })[roster.find(r => r.name === n)?.role] || 'other';
  const files = ['src/tides/table.js', 'src/tides/moon.js', 'src/harbour/charter.md', 'lib/reef/chart.js', 'lib/reef/depth.js', 'tools/test-tides.mjs', 'public/app.js', 'public/style.css', 'README.md'];
  const offering = (n, w, extra) => ({ id: `of${n}`, zone: 'village', workerId: w.id, sessionId: w.sessionId, host: w.host, project: w.project, title: w.title, tool: w.tool, provider: ['anthropic', 'openai', 'google', 'xai'][tools.indexOf(w.tool)], path: w.path,
    note: '', kind: 'diff', headCommit: `${n}a7f3c9e0b1d2`, diffHash: `${n}f0e1d2c3`, files: files.slice(0, 3 + n), omittedPaths: [], size: 4200 + n * 900, truncated: false, status: 'open', commanded: {}, reviewers: [], anchored: [], createdAt: now - n * 5400000, ...extra });
  const finding = (n, o, extra) => ({ id: `fi${n}`, zone: 'village', offeringId: o.id, project: o.project, reviewer: examiner, provider: prov(examiner), authorProvider: o.provider, file: o.files[n % o.files.length], line: 40 + n * 7, severity: ['high', 'medium', 'critical', 'low'][n % 4],
    claim: ['The spring tide offset is applied twice when the table wraps past midnight.', 'Depth soundings are summed in feet and metres without conversion.', 'The charter parser trusts the visitor’s own name field when it builds the file path.', 'The test fixture leaves a temp directory behind on failure.'][n % 4],
    scenario: 'Run the nightly rebuild on the last day of a month: the wrapped row is offset again and the morning table is an hour late.', evidence: `+  const offset = springOffset(row) + springOffset(wrap(row));\n+  table.push(apply(row, offset));`, fix: 'Compute the offset once per row before wrapping.', missingContext: '', independent: true, seconds: [], disputes: [], status: 'open', createdAt: now - n * 3600000, ...extra });
  const open1 = offering(1, live[0], { note: 'Second pass at the wrap-around bug; the test is new.', reviewers: [examiner, smith], commanded: { [smith]: 'check the moon table too' } });
  const open2 = offering(2, live[2], { kind: 'scroll', files: ['scroll'], reviewers: [librarian], headCommit: '', diffHash: '', title: 'Draft the harbour charter', project: 'granary',
    text: Array.from({ length: 14 }, (_, i) => `§${i + 1}. ${['Every vessel that moors at the harbour shall register with the harbourmaster before the next high tide.', 'Petitions are carried to the village by the ferryman and answered within a day.', 'No hero may lay the same offering twice without a note saying what changed.'][i % 3]}`).join('\n\n') });
  const closed = Array.from({ length: 5 }, (_, i) => offering(3 + i, live[i % 3], { status: 'closed', reviewers: [examiner, smith, librarian].slice(0, 1 + i % 3) }));
  world.s.offerings.push(open1, open2, ...closed);
  const second = { by: smith, provider: prov(smith), kind: 'second', note: 'Reproduced on the month boundary.', evidence: '', ts: now - 1800000 };
  world.s.findings.push(
    finding(1, open1, {}),
    finding(2, open1, { status: 'omen', seconds: [second], omenAt: now - 1500000 }),
    finding(3, open1, { status: 'decreed', seconds: [second], omenAt: now - 7200000, verdict: { by: priest, verdict: 'implement', reasoning: 'The evidence is a plain double application; answer it.', ts: now - 3600000 }, delivery: { state: 'awaiting approval', ts: now - 3600000 } }),
    finding(4, closed[0], { status: 'fixed', seconds: [second], omenAt: now - 90000000, verdict: { by: priest, verdict: 'implement', reasoning: 'Clear and reproducible.', ts: now - 88000000 }, delivery: { state: 'landed', ts: now - 87000000 }, fixedAt: now - 80000000, fixCheck: { verdict: 'holds', note: 'The offset is computed once now; the new test covers the wrap.', by: smith, ts: now - 82000000 } }),
    finding(5, closed[1], { status: 'rejected', seconds: [second], omenAt: now - 95000000, verdict: { by: 'You', verdict: 'reject', reasoning: 'Set aside by the human.', ts: now - 94000000 } }),
    finding(6, closed[2], { status: 'insufficient_evidence', seconds: [second], omenAt: now - 99000000, verdict: { by: priest, verdict: 'insufficient_evidence', reasoning: 'The quoted lines are not in the diff.', ts: now - 98000000 } }),
    finding(7, closed[3], { status: 'refuted', disputes: [{ by: librarian, provider: prov(librarian), kind: 'counterexample', note: 'Metres are converted on read.', evidence: '+  const depth = toMetres(sounding);', ts: now - 100000000 }] }));
  world.s.counsel.push({ id: 'c1', zone: 'village', workerId: live[1].id, by: librarian, text: 'The reef chart you are tracing has a newer survey in the archive; use the 1911 soundings, not the 1880 ones.', status: 'new', ts: now - 600000 });
  world.s.steward ??= { enabled: true, festivalEnabled: true, idleHours: 2, sevenDayHours: 12, sevenDaySpare: 15, fiveHourHours: 1.5, fiveHourSpare: 30 };
  world.s.auditSettings ??= { enabled: true, tier1: 'examiner', tier2: 'smith', dailyCap: 20, optOut: [] };
  world.s.audits = [0, 1, 2].map(i => ({ id: `au${i}`, heroId: live[0].id, severity: ['low', 'medium', 'low'][i], rule: ['secrets', 'scope', 'destructive'][i], status: 'pending', excerpt: ['printed an env var name', 'edited a file outside the project', 'ran rm on a build directory'][i], ts: now - i * 1200000 }));
  const snap = world.snapshot({ human: true });
  snap.world = { ...snap.world, name: 'Amygdala', paused: false, day: 12, phase: 'morning', sun: null, now };
  fs.writeFileSync(out, JSON.stringify(snap));
  console.log(`${path.basename(out)}: ${snap.residents.length} residents, ${snap.workers.length} heroes at work, ${snap.hall.length} resting`);
} finally { if (world) { clearTimeout(world.saveTimer); clearInterval(world.seal.timer); } fs.rmSync(dir, { recursive: true, force: true }); }
