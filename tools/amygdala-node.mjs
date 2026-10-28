import { IsleScanner } from '../lib/isle-ghosts.js';
import { AuditScanner } from '../lib/audit.js';
import { HeroScanner, scanAllowed } from '../lib/hero-apprentices.js';
import { notify } from '../lib/notify.js';
// Only redacted audit excerpts cross the node boundary.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { spawn, bin, execFile, hostOs, deckAvailable, env } from '../lib/bin.js';
import { toWorker, mergeDeckLists } from '../lib/deck.js';
import { extractSignals, classifyHero, isleTagged } from '../lib/heroclass.js';
import { Sites, transcriptTail } from '../lib/sites.js';
const exec = promisify(execFile);
import { createInterface } from 'node:readline';
import { probeGrok } from '../lib/fleet.js';
import { decodeImage, savePaste, pasteDir } from '../lib/pastes.js';
export function reportSessions(sessions, village = []) {
  return sessions.map(s => {
    const w = toWorker(s, s.remote_name || s.ssh_host || 'local'), tagged = w.zone === 'isle' || w.isleTagged || isleTagged(w);
    const signals = scanAllowed({ ...w, id: s.id, zone: s.zone || 'village' }, village) ? classifyHero({ ...w, ...extractSignals(w.transcriptPath, w.tool) }) : undefined;
    return { id: s.id, title: String(w.title).slice(0, 160), project: String(w.project).slice(0, 160), path: w.path, group: w.group, status: w.status, tool: w.tool, model: w.model, archived: w.archived, lastActivityAt: w.lastActivityAt, private: w.private, quarantined: w.quarantined, sealed: w.sealed, isleTagged: tagged, ...(signals && { signals }) };
  });
}
// A live claude process resuming this conversation (another terminal, another tmux): a second one would garble it.
export function resumingElsewhere(table, claudeId, self = process.pid) {
  return String(table).split('\n').some(line => {
    const m = line.trim().match(/^(\d+)\s+(.*)$/); if (!m || +m[1] === self || !/claude/i.test(m[2])) return false;
    const a = m[2].split(/\s+/).map(x => x.replace(/^['"]+|['"]+$/g, ''));
    return a.some((x, i) => ['--resume', '-r', '--session-id'].includes(x) && a[i + 1] === claudeId || [`--resume=${claudeId}`, `--session-id=${claudeId}`].includes(x));
  });
}
const refuse = message => Object.assign(new Error(message), { safe: true });
async function claudeId(s, run) {
  let id = s.claude_session_id;
  if (!id) { try { id = JSON.parse((await run('agent-deck', ['session', 'show', s.id, '--json'], { timeout: 15000, maxBuffer: 1 << 20 })).stdout).claude_session_id; } catch {} }
  return typeof id === 'string' && /^[\w-]{8,80}$/.test(id) ? id : null;
}
const psTable = async run => (await run('ps', ['-eo', 'pid,args'], { timeout: 15000, maxBuffer: 8 << 20 })).stdout;
// agent-deck calls the Steward down when it was resumed in a plain terminal instead; the server should know it is alive.
export async function stewardLive(sessions, steward, run = exec, ps = () => psTable(run), platform = process.platform) {
  const s = steward && sessions.find(s => s.id === steward && !s.archived), w = s && toWorker(s, 'local');
  if (!w || s.remote_name || s.ssh_host || w.tool !== 'claude' || !['error', 'stopped'].includes(w.status) || platform === 'win32') return false;
  const id = await claudeId(s, run); if (!id) return false;
  try { return resumingElsewhere(await ps(), id); } catch { return false; }
}
// opts.steward: the session the server named as the Steward; opts.ps: process table reader (tests stub it).
export async function executeJob(job, latestJobs, sessions, village, run = exec, tail = transcriptTail, pastes = null, opts = {}) {
  if (!latestJobs.some(j => j.id === job.id && j === job) || !['commission', 'send', 'tail', 'stop', 'revive', 'forget', 'image', 'start'].includes(job.kind)) throw new Error('Unrequested job.');
  if (job.kind === 'commission') {
    const fake = { s: {}, changed() {}, addFeed() {} }, sites = new Sites(fake);
    const result = await sites.commission({ ...job.commission, node: null }); return JSON.stringify(result);
  }
  const s = sessions.find(s => s.id === job.sessionId && (!s.archived || ['revive', 'forget'].includes(job.kind))), w = s && toWorker(s, 'local');
  if (!w || w.zone === 'isle' || w.isleTagged || w.private || w.quarantined || w.sealed || isleTagged(w) || !village.includes(job.sessionId)) throw new Error('Session is private or unrequested.');
  // A pasted image is saved here, on the hero's machine; a remote (ssh) hero would never see it.
  if (job.kind === 'image') { if (s.remote_name || s.ssh_host) throw new Error('Remote sessions cannot take images.'); return savePaste(decodeImage(job.type, job.d), job.type, { dir: pastes || pasteDir() }); }
  if (job.kind === 'tail') {
    if (!Number.isInteger(job.maxChars) || job.maxChars < 1 || job.maxChars > 20000) throw new Error('Invalid tail bound.');
    return tail(w.transcriptPath, job.maxChars) || '';
  }
  if (['revive', 'forget'].includes(job.kind)) {
    if (!w.archived && w.status !== 'stopped') throw new Error('Hero is still active.');
    if (job.kind === 'forget') return (await run('agent-deck', ['session', 'remove', s.id], { timeout: 60000 })).stdout;
    if (w.archived) await run('agent-deck', ['session', 'unarchive', s.id], { timeout: 60000 });
    return (await run('agent-deck', ['session', 'start', s.id], { timeout: 60000 })).stdout;
  }
  if (job.kind === 'start') {
    if (!opts.steward || job.sessionId !== opts.steward) throw refuse('Only the Steward may be started this way.');
    if (s.remote_name || s.ssh_host || w.tool !== 'claude') throw refuse('Only a local Claude session can be started this way.');
    if (!['error', 'stopped'].includes(w.status)) throw refuse('The Steward is already running.');
    if ((opts.platform || process.platform) === 'win32') throw refuse('Cannot check for a duplicate here.');
    const id = await claudeId(s, run); if (!id) throw refuse('No Claude conversation to check.');
    let table; try { table = await (opts.ps || (() => psTable(run)))(); } catch { throw refuse('Could not check for a duplicate.'); }
    if (resumingElsewhere(table, id)) throw refuse('Already running elsewhere.');
    return (await run('agent-deck', ['session', 'start', s.id], { timeout: 60000 })).stdout;
  }
  if (job.kind === 'stop') return (await run('agent-deck', ['session', 'stop', s.id], { timeout: 60000 })).stdout;
  if (typeof job.message !== 'string' || job.message.length > 12000) throw new Error('Invalid message.');
  return await new Promise((resolve, reject) => {
    const child = execFile('agent-deck', ['session', 'send', s.id, '--message-file', '-', ...(job.wait ? ['--wait', '--defer-if-busy', '--timeout', '10m'] : ['--queue']), '--json'], { timeout: 12 * 60000, maxBuffer: 24000 }, (e, out) => e ? reject(new Error('Session send failed.')) : resolve(String(out)));
    child.stdin.end(job.message);
  });
}
export function termSession(term, sessions, village) {
  const s = sessions.find(s => s.id === term.sessionId && !s.archived), w = s && toWorker(s, 'local');
  if (!w || isleTagged(w) || s.quarantined || s.sealed || !village.includes(s.id) || !s.tmux_session || s.remote_name || s.ssh_host) throw new Error('Terminal is private or unavailable.');
  return s;
}
export function openNodeTerm(term, requested, sessions, village, start = spawn, tmux = () => bin('tmux')) {
  if (!requested.includes(term) || term.open !== true) throw new Error('Unrequested terminal.');
  const s = termSession(term, sessions, village);
  return start('python3', ['-I', fileURLToPath(new URL('./ptybridge.py', import.meta.url)), tmux(), 'attach-session', '-t', s.tmux_session], { stdio: ['pipe', 'pipe', 'ignore'] });
}
export function terminalOutput(term, child, terminals, output, wake) {
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
    if (!terminals.has(term.id)) return;
    try {
      const m = JSON.parse(line);
      if (m.t === 'o') {
        output.push({ id: term.id, d: m.d });
        // Pause producers rather than discard terminal escape sequences under load.
        if (output.length >= 24) for (const t of terminals.values()) t.lines?.pause();
        wake();
      }
    } catch {}
  });
  return lines;
}
// Output wakes the poll immediately; an idle node only checks for opens every two seconds.
export function terminalPoller(poll, active, { schedule = setTimeout, cancel = clearTimeout } = {}) {
  let timer, busy = false, again = false, stopped = false;
  const arm = delay => { cancel(timer); timer = schedule(run, delay); timer?.unref?.(); };
  async function run() {
    if (stopped) return;
    if (busy) { again = true; return; }
    busy = true;
    try { await poll(); } finally { busy = false; if (!stopped) { arm(again ? 0 : active() ? 25 : 2000); again = false; } }
  }
  arm(0);
  return { wake() { if (busy) again = true; else arm(0); }, dispose() { stopped = true; cancel(timer); } };
}
export async function main(args = process.argv.slice(2)) {
  const options = {}; for (let i = 0; i < args.length; i += 2) { if (args[i] === '--no-notify') { options.noNotify = true; i--; continue; } if (!['--server', '--pass-file'].includes(args[i]) || !args[i + 1]) throw new Error('Usage: --server URL --pass-file FILE'); options[args[i]] = args[i + 1]; }
  const server = new URL(options['--server'] || env('SERVER')), token = (env('NODE_PASS') || fs.readFileSync(options['--pass-file'], 'utf8')).trim();
  if (!['http:', 'https:'].includes(server.protocol) || server.username || server.password || !/^hfn_[\w-]+$/.test(token)) throw new Error('Invalid node configuration.');
  const scanner = new HeroScanner(), auditScanner = new AuditScanner(), isleScanner = new IsleScanner();
  const pendingGhosts = new Map();
  let isle = [], islePublicKey = null, isleHeroPrefix = '';
  let audit = { enabled: false, optOut: [] };
  let bellAck = 0;
  let village = [], results = [], lastUsage = 0, lastGrok = 0, latestSessions = [], steward = null, live = false, lastLive = 0;
  const terminals = new Map(); let output = [], pendingGrok = null;
  const poller = terminalPoller(async () => {
    try {
      for (const [id, t] of terminals) { try { termSession(t.term, latestSessions, village); } catch { terminals.delete(id); t.child.kill(); } }
      const batch = output.splice(0, 8);
      if (output.length < 16) for (const t of terminals.values()) t.lines?.resume();
      const res = await fetch(new URL('/node/term', server), { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ output: batch }), signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error('Terminal refused.');
      const { terms } = await res.json();
      for (const [id, t] of terminals) if (!terms.some(x => x.id === id)) { terminals.delete(id); t.child.kill(); }
      for (const term of terms) {
        let t = terminals.get(term.id);
        if (!t) {
          try {
            const child = openNodeTerm(term, terms, latestSessions, village); t = { term, child }; terminals.set(term.id, t);
            t.lines = terminalOutput(term, child, terminals, output, () => poller.wake());
            const ended = () => { if (!terminals.delete(term.id)) return; output.push({ id: term.id, exit: true }); poller.wake(); };
            child.on('error', ended); child.on('close', ended);
          } catch { output.push({ id: term.id, exit: true }); continue; }
        }
        termSession(term, latestSessions, village);
        for (const line of term.input) { if (line.length > 140000) throw new Error('Invalid terminal input.'); t.child.stdin.write(line); }
      }
    } catch { village = []; for (const t of terminals.values()) t.child.kill(); terminals.clear(); output = []; }
  }, () => terminals.size || output.length);
  for (;;) {
    try {
      const available = deckAvailable(), sessions = [];
      if (available) {
        const list = async args => JSON.parse((await exec('agent-deck', ['list', '--json', ...args], { timeout: 15000, maxBuffer: 8 << 20 })).stdout);
        const local = mergeDeckLists(await list([]), await list(['--all']).catch(() => []));
        sessions.push(...(Array.isArray(local) ? local : local.sessions || []));
        try { const remote = JSON.parse((await exec('agent-deck', ['remote', 'sessions', '--json'], { timeout: 15000, maxBuffer: 8 << 20 })).stdout); sessions.push(...(Array.isArray(remote) ? remote : remote.sessions || [])); } catch {}
      }
      latestSessions = sessions;
      let usage;
      if (available && Date.now() - lastUsage > 300000) { try { usage = JSON.parse((await exec('agent-deck', ['usage', '--json'], { timeout: 15000 })).stdout).providers?.find(p => p.id === 'claude'); lastUsage = Date.now(); } catch {} }
      if (usage) usage = { id: usage.id, windows: (usage.windows || []).map(({ kind, label, used_percentage, resets_at, stale }) => ({ kind, label, used_percentage, resets_at, stale })) };
      if (Date.now() - lastGrok > 1800000) { lastGrok = Date.now(); probeGrok(os.homedir()).then(u => { if (u) pendingGrok = u; }).catch(() => {}); }
      if (pendingGrok) { usage = pendingGrok; pendingGrok = null; }
      for (const id of scanner.cache.keys()) if (!village.includes(id)) scanner.cache.delete(id);
      auditScanner.retain(audit.enabled ? sessions.filter(s => !s.archived && village.includes(s.id) && !audit.optOut.includes(s.id)).map(s => s.id) : []);
      const apprentices = [], auditHits = [], isleGhosts = [];
      isleScanner.retain(islePublicKey ? isle : []);
      for (const s of sessions.filter(s => isle.includes(s.id) && !s.archived)) {
        const w = { ...toWorker(s, s.remote_name || s.ssh_host || 'local'), id: s.id, zone: 'isle' };
        const boxes = isleScanner.scan(w, isle, islePublicKey, Date.now(), isleHeroPrefix + s.id); for (const box of boxes) pendingGhosts.set(box.slot, { heroId: s.id, box });
      }
      let ghostBytes = 0;
      for (const [slot, g] of pendingGhosts) { if (!islePublicKey || !isle.includes(g.heroId)) { pendingGhosts.delete(slot); continue; } const size = JSON.stringify(g.box).length; if (ghostBytes + size > 768000) continue; let group = isleGhosts.find(x => x.heroId === g.heroId); if (group?.boxes.length >= 12) continue; if (!group) { group = { heroId: g.heroId, boxes: [] }; isleGhosts.push(group); } group.boxes.push(g.box); ghostBytes += size; }
      while (pendingGhosts.size > 200) pendingGhosts.delete(pendingGhosts.keys().next().value);
      for (const s of sessions.filter(s => village.includes(s.id) && !s.archived)) {
        const w = { ...toWorker(s, s.remote_name || s.ssh_host || 'local'), id: s.id, zone: s.zone || 'village' };
        auditHits.push(...auditScanner.scan({ ...w, auditOptOut: !audit.enabled || audit.optOut.includes(w.id) }, village));
        let children = sessions.map(c => toWorker(c, 'local'));
        if (w.host === 'local' && scanner.due(w, village)) {
          try { const out = JSON.parse((await exec('agent-deck', ['session', 'children', s.id, '--json'], { timeout: 15000, maxBuffer: 1 << 20 })).stdout); children = [...children, ...(Array.isArray(out) ? out : out.children || out.sessions || []).map(c => ({ ...toWorker(c, 'local'), parentId: s.id }))]; } catch {}
        }
        apprentices.push({ heroId: s.id, subagents: scanner.scan(w, village, children) });
      }
      if (Date.now() - lastLive > 30000) { lastLive = Date.now(); live = await stewardLive(sessions, steward, exec); }
      const batch = results.slice(0, 40);
      const response = await fetch(new URL('/node/report', server), { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ bellAck, hostname: os.hostname(), os: hostOs(), deckAvailable: available, sessions: reportSessions(sessions, village), apprentices, isleGhosts, auditHits: auditHits.slice(0, 500), results: batch, ...(live && { stewardLive: true }), ...(usage && { usage }) }), signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error('Report refused.');
      const next = await response.json(); for (const g of isleGhosts) for (const b of g.boxes) pendingGhosts.delete(b.slot); village = next.village || []; steward = next.steward || null; isle = next.isle || []; islePublicKey = next.islePublicKey || null; isleHeroPrefix = next.isleHeroPrefix || ''; audit = next.audit || { enabled: false, optOut: [] }; results.splice(0, batch.length);
      for (const bell of next.bells || []) { if (bell.id <= bellAck) continue; bellAck = bell.id; if (!options.noNotify) await notify(bell); }
      // Jobs run concurrently so a long wrap-up cannot interrupt heartbeats.
      // A start's refusals are fixed sentences; the catch-all text is what the server reads as an un-updated node.
      for (const job of next.jobs || []) executeJob(job, next.jobs, sessions, village, exec, transcriptTail, null, { steward }).then(output => results.push({ id: job.id, ok: true, output: String(output || '').slice(0, 24000), error: '' }), e => results.push({ id: job.id, ok: false, output: '', error: job.kind === 'start' ? (e?.safe ? e.message : 'The Steward could not be started.') : 'Local node job failed; check folder and agent-deck.' }));
    } catch { village = []; steward = null; isle = []; isleScanner.retain([]); auditScanner.retain([]); console.error('Node report failed; retrying.'); }
    await new Promise(resolve => setTimeout(resolve, 4000));
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => { console.error('Could not start node; check server and pass file.'); process.exitCode = 1; });
