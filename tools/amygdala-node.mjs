// No transcript locations or prompt excerpts cross the node boundary.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { spawn, bin, execFile, hostOs, deckAvailable, env } from '../lib/bin.js';
import { toWorker } from '../lib/deck.js';
import { extractSignals, classifyHero, isleTagged } from '../lib/heroclass.js';
import { Sites, transcriptTail } from '../lib/sites.js';
const exec = promisify(execFile);
import { createInterface } from 'node:readline';
import { probeGrok } from '../lib/fleet.js';
export function reportSessions(sessions, village = []) {
  return sessions.filter(s => !s.archived).map(s => {
    const w = toWorker(s, s.remote_name || s.ssh_host || 'local'), tagged = isleTagged(w);
    const signals = !tagged && village.includes(s.id) ? classifyHero({ ...w, ...extractSignals(w.transcriptPath, w.tool) }) : undefined;
    return { id: s.id, title: String(w.title).slice(0, 160), project: String(w.project).slice(0, 160), path: w.path, group: w.group, status: w.status, tool: w.tool, isleTagged: tagged, ...(signals && { signals }) };
  });
}
export async function executeJob(job, latestJobs, sessions, village, run = exec, tail = transcriptTail) {
  if (!latestJobs.some(j => j.id === job.id && j === job) || !['commission', 'send', 'tail', 'stop'].includes(job.kind)) throw new Error('Unrequested job.');
  if (job.kind === 'commission') {
    const fake = { s: {}, changed() {}, addFeed() {} }, sites = new Sites(fake);
    const result = await sites.commission({ ...job.commission, node: null }); return JSON.stringify(result);
  }
  const s = sessions.find(s => s.id === job.sessionId && !s.archived), w = s && toWorker(s, 'local');
  if (!w || isleTagged(w) || !village.includes(job.sessionId)) throw new Error('Session is private or unrequested.');
  if (job.kind === 'tail') {
    if (!Number.isInteger(job.maxChars) || job.maxChars < 1 || job.maxChars > 20000) throw new Error('Invalid tail bound.');
    return tail(w.transcriptPath, job.maxChars) || '';
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
export async function main(args = process.argv.slice(2)) {
  const options = {}; for (let i = 0; i < args.length; i += 2) { if (!['--server', '--pass-file'].includes(args[i]) || !args[i + 1]) throw new Error('Usage: --server URL --pass-file FILE'); options[args[i]] = args[i + 1]; }
  const server = new URL(options['--server'] || env('SERVER')), token = (env('NODE_PASS') || fs.readFileSync(options['--pass-file'], 'utf8')).trim();
  if (!['http:', 'https:'].includes(server.protocol) || server.username || server.password || !/^hfn_[\w-]+$/.test(token)) throw new Error('Invalid node configuration.');
  let village = [], results = [], lastUsage = 0, lastGrok = 0, latestSessions = [], connected = false;
  const terminals = new Map(); let output = [], pendingGrok = null;
  let lastTermPoll = 0;
  setInterval(async () => {
    if (connected || (!terminals.size && Date.now() - lastTermPoll < 2000)) return; connected = true; lastTermPoll = Date.now();
    try {
      for (const [id, t] of terminals) { try { termSession(t.term, latestSessions, village); } catch { terminals.delete(id); t.child.kill(); } }
      const batch = output.splice(0, 8);
      const res = await fetch(new URL('/node/term', server), { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ output: batch }), signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error('Terminal refused.');
      const { terms } = await res.json();
      for (const [id, t] of terminals) if (!terms.some(x => x.id === id)) { terminals.delete(id); t.child.kill(); }
      for (const term of terms) {
        let t = terminals.get(term.id);
        if (!t) {
          try {
            const child = openNodeTerm(term, terms, latestSessions, village); t = { term, child }; terminals.set(term.id, t);
            createInterface({ input: child.stdout }).on('line', line => { if (!terminals.has(term.id)) return; try { const m = JSON.parse(line); if (m.t === 'o' && output.length < 32) output.push({ id: term.id, d: m.d }); } catch {} });
            const ended = () => { if (!terminals.delete(term.id)) return; if (output.length < 32) output.push({ id: term.id, exit: true }); };
            child.on('error', ended); child.on('close', ended);
          } catch { output.push({ id: term.id, exit: true }); continue; }
        }
        termSession(term, latestSessions, village);
        for (const line of term.input) { if (line.length > 140000) throw new Error('Invalid terminal input.'); t.child.stdin.write(line); }
      }
    } catch { village = []; for (const t of terminals.values()) t.child.kill(); terminals.clear(); output = []; }
    finally { connected = false; }
  }, 250).unref();
  for (;;) {
    try {
      const available = deckAvailable(), sessions = [];
      if (available) {
        const local = JSON.parse((await exec('agent-deck', ['list', '--json'], { timeout: 15000, maxBuffer: 8 << 20 })).stdout);
        sessions.push(...(Array.isArray(local) ? local : local.sessions || []));
        try { const remote = JSON.parse((await exec('agent-deck', ['remote', 'sessions', '--json'], { timeout: 15000, maxBuffer: 8 << 20 })).stdout); sessions.push(...(Array.isArray(remote) ? remote : remote.sessions || [])); } catch {}
      }
      latestSessions = sessions;
      let usage;
      if (available && Date.now() - lastUsage > 300000) { try { usage = JSON.parse((await exec('agent-deck', ['usage', '--json'], { timeout: 15000 })).stdout).providers?.find(p => p.id === 'claude'); lastUsage = Date.now(); } catch {} }
      if (usage) usage = { id: usage.id, windows: (usage.windows || []).map(({ kind, label, used_percentage, resets_at, stale }) => ({ kind, label, used_percentage, resets_at, stale })) };
      if (Date.now() - lastGrok > 1800000) { lastGrok = Date.now(); probeGrok(os.homedir()).then(u => { if (u) pendingGrok = u; }).catch(() => {}); }
      if (pendingGrok) { usage = pendingGrok; pendingGrok = null; }
      const batch = results.slice(0, 40);
      const response = await fetch(new URL('/node/report', server), { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ hostname: os.hostname(), os: hostOs(), deckAvailable: available, sessions: reportSessions(sessions, village), results: batch, ...(usage && { usage }) }), signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error('Report refused.');
      const next = await response.json(); village = next.village || []; results.splice(0, batch.length);
      // Jobs run concurrently so a long wrap-up cannot interrupt heartbeats.
      for (const job of next.jobs || []) executeJob(job, next.jobs, sessions, village).then(output => results.push({ id: job.id, ok: true, output: String(output || '').slice(0, 24000), error: '' }), () => results.push({ id: job.id, ok: false, output: '', error: 'Local node job failed; check folder and agent-deck.' }));
    } catch { village = []; console.error('Node report failed; retrying.'); }
    await new Promise(resolve => setTimeout(resolve, 4000));
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => { console.error('Could not start node; check server and pass file.'); process.exitCode = 1; });
