import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { askingPermission, permissionItems, permissionScan } from '../lib/prompts.js';
import { toWorker } from '../lib/deck.js';
import { Nodes, validateReport } from '../lib/nodes.js';
import { World } from '../lib/world.js';
import { Usage } from '../lib/usage.js';
import { Watch } from '../lib/watch.js';
// Usage polling is unrelated to permission detection; never launch provider probes.
Usage.prototype.pollDeck = () => {}; Usage.prototype.probe = () => {};
const fixtures = {
  claude: ['Do you want to proceed?', 'Do you want to make this edit?', 'Do you want to create file?', 'Do you want to allow Bash?', '❯ 1. Yes\n2. No, and tell Claude'],
  codex: ['Would you like to run the following command?', 'Allow command?', '❯ 1. Approve once', 'Approve execution (y/n)', 'Run command? [y/N]'],
  gemini: ['Allow execution', 'Apply this change?', 'Waiting for user confirmation'],
  antigravity: ['Allow execution', 'Apply this change?', 'Waiting for user confirmation'],
  grok: ['Allow', 'Approve', '❯ 1. Allow once'],
};
for (const [tool, prompts] of Object.entries(fixtures)) {
  for (const prompt of prompts) { assert(askingPermission(tool, prompt), `${tool}: ${prompt}`); assert(!askingPermission(tool, prompt + '\n' + Array(26).fill('Finished working.').join('\n'))); }
  assert(!askingPermission(tool, 'All changes completed.\nTests passed.\n> '));
  assert(!askingPermission(tool, 'I approve of the approach.\nAllowed execution completed.'));
}
const hero = { id: 'local:test', sessionId: 'test', title: 'Builder', project: 'test', host: 'local', zone: 'village', status: 'waiting', tool: 'claude' };
const variants = [{}, { zone: 'isle' }, { isleTagged: true }, { quarantined: true }, { sealed: true }, { private: true }, { group: 'isle' }, { archived: true }, { stale: true }, { status: 'running' }, { host: 'remote' }];
const candidates = variants.map((v, i) => ({ w: { ...hero, ...v, id: `test${i}` }, tmux: 'test-pane' }));
const confirmed = candidates.map(({ w }) => w.id);
assert.deepEqual(permissionItems(candidates, confirmed).map(w => w.id), ['test0']);
assert.equal(permissionItems(candidates, []).length, 0);
let captures = 0;
assert.deepEqual([...await permissionScan(permissionItems(candidates, confirmed), async () => { captures++; return 'Do you want to proceed?'; })], ['test0']); assert.equal(captures, 1);
assert.equal((await permissionScan([{ id: 'err', tool: 'claude', tmux: 'stub' }], async () => { throw Error('capture failed'); })).size, 0);
assert.equal(toWorker({ status: 'waiting', needs_permission: true }, 'local').needsPermission, true);
assert.equal(toWorker({ status: 'running', needs_permission: true }, 'local').needsPermission, false);
for (const file of ['lib/deck.js', 'tools/amygdala-node.mjs']) assert.match(fs.readFileSync(file, 'utf8'), /permissionScan\(permissionItems\(/);
const session = { id: 'test', status: 'waiting', tool: 'claude', title: 'Builder', project: 'test', path: '', group: '', needs_permission: true };
const report = { hostname: 'test', os: 'linux', deckAvailable: true, sessions: [session], results: [] };
assert.equal(validateReport(report).sessions[0].needs_permission, true);
assert.throws(() => validateReport({ ...report, sessions: [{ ...session, needs_permission: 'yes' }] }));
const nodeWorkers = status => Nodes.prototype.workers.call({ passes: () => [{ id: 'test', name: 'test', online: true }], live: new Map([['test', { at: 0, sessions: [{ ...session, status }] }]]) });
assert.equal(nodeWorkers('waiting')[0].needsPermission, true); assert.equal(nodeWorkers('running')[0].needsPermission, false);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amygdala-permission-')); let w;
try {
  w = new World(dir, [], path.join(dir, 'residents.json'));
  w.setWorkers([{ ...hero, status: 'running' }]); const before = w.s.feed.length;
  w.setWorkers([hero]); assert.equal(w.s.feed.length, before);
  const since = w.workers[0].waitingSince;
  w.setWorkers([{ ...hero, needsPermission: true }]); assert.equal(w.s.feed.length, before + 1); assert.match(w.s.feed.at(-1).text, /needs your permission/); assert.equal(w.workers[0].waitingSince, since);
  w.setWorkers([{ ...hero, needsPermission: true }]); assert.equal(w.s.feed.length, before + 1);
  w.setWorkers([hero]); assert.equal(w.workers[0].needsPermission, undefined);
  const watch = new Watch(w, { duty: () => false }, dir, { start: false }); watch.notify = () => {}; watch.stewardScan = () => {};
  w.workers = [{ ...hero, waitingSince: 0 }]; watch.scan(700000); assert(!watch.state.pending.some(e => e.key.startsWith('hero-waiting:')));
  w.workers = [{ ...hero, needsPermission: true, waitingSince: 0 }]; watch.scan(700000); assert(watch.state.pending.some(e => e.key.startsWith('hero-waiting:') && e.summary.includes('your permission')));
} finally { clearTimeout(w?.saveTimer); fs.rmSync(dir, { recursive: true, force: true }); }
const panel = fs.readFileSync('public/panel.js', 'utf8');
assert.match(panel, /waitingHero = .*needsPermission/); assert.match(panel, /const heroes = .*needsPermission/); assert.match(panel, /const st = w.status === 'waiting' && !w.needsPermission \? 'idle'/); assert.match(panel, /badgeWait.hidden = .*needsPermission/);
console.log('needs permission ok');
