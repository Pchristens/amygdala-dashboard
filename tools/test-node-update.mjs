// v0.45: nodes keep themselves current from their own origin, under a supervisor, so the human never has to visit them.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import { selfUpdate, supervise, jobReason } from './amygdala-node.mjs';
import { Nodes } from '../lib/nodes.js';
import { Sites } from '../lib/sites.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amygdala-node-update-')), origin = path.join(dir, 'origin.git'), work = path.join(dir, 'work'), clone = path.join(dir, 'clone');
const git = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { stdio: 'pipe' }).toString().trim();
const commit = (msg, file, text) => { fs.mkdirSync(path.dirname(path.join(work, file)), { recursive: true }); fs.writeFileSync(path.join(work, file), text); git(work, 'add', '.'); git(work, 'commit', '-qm', msg); git(work, 'push', '-q', 'origin', 'HEAD:main'); return git(work, 'rev-parse', 'HEAD'); };
try {
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]); execFileSync('git', ['init', '-q', '-b', 'main', work]);
  for (const r of [work]) { git(r, 'config', 'user.email', 't@example.com'); git(r, 'config', 'user.name', 'T'); git(r, 'remote', 'add', 'origin', origin); }
  const v1 = commit('one', 'lib/a.js', 'export const a = 1;\n'); commit('node', 'tools/amygdala-node.mjs', 'export const n = 1;\n');
  execFileSync('git', ['clone', '-q', origin, clone]);
  const base = git(clone, 'rev-parse', 'HEAD');

  // Current: the server's commit is HEAD or behind it (a dev clone that is ahead never moves).
  assert.equal(await selfUpdate(clone, base), 'current'); assert.equal(await selfUpdate(clone, v1), 'current');
  assert.equal(await selfUpdate(clone, 'HEAD; rm -rf x'), 'bad version');
  // Behind: fast-forward to exactly the server's commit, and remember where it came from.
  const v2 = commit('two', 'lib/a.js', 'export const a = 2;\n'), v3 = commit('three', 'lib/a.js', 'export const a = 3;\n');
  assert.equal(await selfUpdate(clone, v2), 'updated'); assert.equal(git(clone, 'rev-parse', 'HEAD'), v2);
  assert.equal(fs.readFileSync(path.join(clone, '.git', 'amygdala-node-prev'), 'utf8'), base);
  // Local edits are never touched.
  fs.writeFileSync(path.join(clone, 'lib/a.js'), 'export const a = "mine";\n');
  assert.equal(await selfUpdate(clone, v3), 'local edits'); assert.equal(fs.readFileSync(path.join(clone, 'lib/a.js'), 'utf8'), 'export const a = "mine";\n');
  git(clone, 'checkout', '-q', '--', 'lib/a.js');
  // A commit origin doesn't have (a server running unpushed work) is refused.
  assert.equal(await selfUpdate(clone, 'f'.repeat(40)), 'version not on origin');
  // New code that fails its checks is undone, keeping the running code.
  const broken = commit('broken', 'lib/a.js', 'export const = ;\n');
  assert.equal(await selfUpdate(clone, broken), 'new code failed its checks; kept the old'); assert.equal(git(clone, 'rev-parse', 'HEAD'), v2);
  // Diverged: a local commit the server lacks blocks the fast-forward.
  git(clone, 'config', 'user.email', 't@example.com'); git(clone, 'config', 'user.name', 'T');
  fs.writeFileSync(path.join(clone, 'local.txt'), 'x'); git(clone, 'add', '.'); git(clone, 'commit', '-qm', 'local');
  assert.equal(await selfUpdate(clone, v3), 'diverged');

  // The supervisor restarts its worker after an update (exit 75) at once, and after a crash with backoff.
  const kids = [], timers = [], realSet = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms) => { timers.push(ms); fn(); };
  const start = (cmd, args, opts) => { const c = new EventEmitter(); c.kill = () => {}; c.opts = opts; kids.push(c); return c; };
  const listeners = ['SIGTERM', 'SIGINT', 'SIGHUP'].map(s => process.listenerCount(s));
  supervise(['--server', 'http://x'], start);
  assert.equal(kids.length, 1); assert.equal(kids[0].opts.env.AMYGDALA_NODE_WORKER, '1');
  kids[0].emit('exit', 75); assert.equal(kids.length, 2); assert.equal(timers.at(-1), 500);
  kids[1].emit('exit', 1); assert.equal(kids.length, 3); assert(timers.at(-1) >= 1000);
  globalThis.setTimeout = realSet;
  for (const [i, s] of ['SIGTERM', 'SIGINT', 'SIGHUP'].entries()) for (const l of process.listeners(s).slice(listeners[i])) process.off(s, l);

  // A failed commission says why, with the home folder masked.
  assert.equal(jobReason(new Error(`agent-deck: no such folder ${os.homedir()}/x`)), 'Could not send the hero: agent-deck: no such folder ~/x');
  assert(jobReason(new Error('y'.repeat(500))).length <= 240);

  // The server tells nodes which commit it runs, and only a full hash.
  let seq = 0;
  const world = { s: {}, workers: [], version: 'a'.repeat(40), id: () => `t-${++seq}`, changed() {}, refreshWorkers() { this.workers = this.nodes.workers(); }, usage: { mergeDeck() {} } };
  world.sites = new Sites(world); world.nodes = new Nodes(world);
  const n = world.nodes, p = n.auth(n.issue('Test PC', 24).token), body = { hostname: 'h', os: 'linux', deckAvailable: true, sessions: [], results: [] };
  assert.equal(n.report(p, body).version, 'a'.repeat(40));
  world.version = 'nope'; n.live.get(p.id).at -= 2000;
  assert.equal(n.report(p, body).version, undefined);
  console.log('node update: self-update, supervisor, commission reasons and version passed');
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
