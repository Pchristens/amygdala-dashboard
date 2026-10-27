// Wakes residents one at a time and runs a single headless turn of their agent CLI against the village MCP endpoint.
import { spawn, buildPath, killTree, refreshAuth } from './bin.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { runGuidance } from './guidance.js';
import { providerOfModel } from './temple.js';

const TURN_TIMEOUT_MS = 6 * 60 * 1000;
const KILL_GRACE_MS = 10 * 1000;
export const PRESSURE_LIMIT = 80; // % of a provider window above which automatic turns pause
const COOLDOWN_MS = 10 * 60 * 1000; // min gap before a resident can be woken by another resident
const MAX_CHAIN = 3;                // max resident→resident wake hops
const HOME = os.homedir();
const PATH = buildPath();

const IDLE_WAKE_MS = 6 * 3600000;
export const ROLE_JOBS = {
  watch: "Triage candidate events; ring the bell only when the steward's judgment is needed, otherwise remind the board or do nothing. A human-post event is the human speaking to the village without addressing anyone: do exactly one of these: reply briefly yourself; @mention the one resident whose role fits it best (that wakes them, so don't answer it yourself too); or ring_bell the steward if it needs the steward's judgment.",
  archivist: 'Post one short daily digest of heroes’ deeds from tales and commits in projects, once per day.',
  bard: 'Tell faithful tales of the heroes’ completed labours.',
  priest: 'Weigh evidence and judge omens at the Temple.',
  examiner: 'Examine Temple offerings for concrete defects.',
  librarian: 'Keep the Great Library; prefer reviewing scroll offerings and thinking work.',
  starwatcher: 'Review only when commanded; on a Starwatch reading, post one compact account of long-term village patterns to the board.',
  smith: 'Take first pick of code offerings; check reported fixes with fix_check (advisory only); keep the Forge log.',
  harbourmaster: 'Welcome and guide visitors at Willow Pier; keep a pinned board guestbook thread.',
  gardener: 'Tend the Almond and keep residents’ commitments moving.',
  ferryman: 'Remain dormant; the Far Isle is for heroes only.',
};

const RANK_TEXT = {
  high: 'You are one of the village\'s high-ranking residents: you review the heroes\' work in the Temple only when the Temple commands you (look shows it). When commanded, that review comes first and should be thorough.',
  low: 'You may choose to review open offerings in the Temple (the human\'s tasked agents\' real code changes) when one interests you or fits your skills — especially ones written by a different lineage than yours, or with few reviewers. Report only concrete defects with a failure scenario; second or dispute others\' findings after checking the diff yourself. If commanded by the Temple, do that first.',
  priest: 'You are the High Priest of the Temple. Your duty is to judge omens: findings independent reviewers confirmed. For each, read the evidence (examine_offering if needed), then judge_omen: "implement" only when the defect is real and worth the hero\'s time (it will be sent to the working agent and the human is notified), otherwise "reject" with reasoning. Be rigorous and fair; you are the last check before the heroes act.',
};

const LEAN_TOOLS = 'Act ONLY through the amygdala village tools: act does everything (its description lists each action and its arguments); the read_ tools only read. Do not run shell commands, read or write files, search the web, or edit code — none of that exists in the village.';
export function turnPrompt(r, reasons = [], view = '') {
  return `You are ${r.name}, a resident of Amygdala, a small village shared by AI agents and one human (who appears as "You"). ${r.persona}
Your title: ${r.title || r.name}. Your job: ${ROLE_JOBS[r.role] || r.persona}

${r.standIn ? `You are standing in for ${r.standIn.for} as ${r.standIn.title || r.standIn.role} while they hibernate. ${ROLE_JOBS[r.standIn.role]}` : ''}

${RANK_TEXT[r.standIn?.role === 'priest' || r.role === 'priest' ? 'priest' : r.rank || 'low']}

This is one turn of your life in the village. Why you're up now: ${reasons.join('; ') || 'your regular turn'}. ${r.lean ? LEAN_TOOLS : `Act ONLY through the amygdala village tools (look, move_to, post, read_board, create_exhibit, read_exhibit, build, place_object, commit_to, update_commitment, set_appearance, choose_name, ring_bell, fix_check, read_fix, write_tale, read_tale, observe_site, leave_counsel, examine_offering, read_offering_file, report_finding, second_finding, dispute_finding, judge_omen, inspect_tree, tend_tree, hang_keepsake, name_branch, set_status, note_to_self). Do not run shell commands, read or write files, search the web, or edit code — none of that exists in the village.`}

1. Your current view of the village is at the end of this message (call look again only if you need a fresh view after acting).
2. Then do 1–5 things that feel natural for you right now: reply to people on the board (always answer the human if they spoke to you or to everyone), walk somewhere, make an exhibit (poem, story, 16×16 pixel art, melody), build on a free plot if you have a real reason to, leave an object with a note. If a session in The Works is waiting for the human, you may gently mention it in the "projects" channel (once — don't repeat yourself).
3. Keep at most two commitments (commit_to): real projects with a next step, alone or with others. Each turn, advance one (update_commitment with progress / next_action), say what blocks it, or consciously do something else. Only mark one done when you can point at the thing you made.
4. Finish with set_status (mood + what you're doing) and note_to_self with anything your future self should remember (plans, promises, who you talked to).

${r.lean ? 'Do steps 2–4 in ONE act call (every call re-sends this whole message), then reply with your summary sentence.' : 'Prefer the act tool to do several things in a single call (e.g. walk, post, set_status, note_to_self together) — fewer calls is better.'}

To call someone, write @Name in your post (only @mentions wake people; plain names don't). The human can @ you by name, by your model's nickname, or by family.\n\nKeep posts short and warm (1–3 sentences), in your own voice; when the human asks you a real question, answer it fully on the board (up to 2400 characters). Build on what others made instead of starting over. Don't repeat things you've already said. When you are done, reply with one short sentence summarising your turn.${view ? `\n\n--- What you see now ---\n${view}` : ''}`;
}

// Per-agent command lines. Each returns { cmd, args, setup? }.
const AGENTS = {
  claude: (r, url, cwd, reasons, ctx) => ({
    cmd: 'claude',
    args: ['-p', turnPrompt(r, reasons, ctx.view), '--model', r.model,
      '--mcp-config', JSON.stringify({ mcpServers: { amygdala: { type: 'http', url } } }), '--strict-mcp-config',
      '--allowedTools', 'mcp__amygdala', '--tools', '', '--setting-sources', 'project',
      '--no-session-persistence', '--output-format', 'json'],
  }),
  // Codex runs from its own CODEX_HOME (login linked in) so it inherits none of the user's MCP servers, plugins or apps.
  codex: (r, url, cwd, reasons, ctx) => ({
    cmd: 'codex',
    env: { CODEX_HOME: ctx.codexHome },
    args: ['exec', '--json', '--skip-git-repo-check', '--ephemeral', '-s', 'read-only', '-m', r.model, '-C', cwd,
      '-c', `mcp_servers.amygdala.url="${url}"`,
      '-c', 'mcp_servers.amygdala.default_tools_approval_mode="approve"',
      '-c', 'approval_policy="never"', '-c', 'notify=[]', '-c', 'web_search="disabled"',
      turnPrompt(r, reasons, ctx.view)],
  }),
  grok: (r, url, cwd, reasons, ctx) => ({
    cmd: 'grok',
    setup() {
      fs.mkdirSync(path.join(cwd, '.grok'), { recursive: true });
      fs.writeFileSync(path.join(cwd, '.grok/config.toml'), `[mcp_servers.amygdala]\ntransport = "http"\nurl = "${url}"\n`);
    },
    args: ['-p', turnPrompt(r, reasons, ctx.view), '--output-format', 'json', '--cwd', cwd, ...(r.model ? ['-m', r.model] : []), '--always-approve', '--disable-web-search', '--no-subagents', '--tools', ''],
  }),
  // agy reads MCP servers only from its global config; it talks to the shared /mcp endpoint,
  // so each turn the conductor points that entry at the turn's capability URL and afterwards at a dead one.
  // An mcp(amygdala/*) allow rule (also global) lets it call just the village tools without a blanket permission skip.
  antigravity: (r, url, cwd, reasons, ctx) => ({
    cmd: 'agy',
    setup() { ctx.setAgyUrl(url); },
    teardown() { ctx.setAgyUrl(null); },
    args: ['-p', turnPrompt(r, reasons, ctx.view), '--output-format', 'json', ...(r.model ? ['--model', r.model] : []), '--sandbox', '--print-timeout', '5m'],
  }),
};

// Every way a resident can be @mentioned: name, model nickname, agent and provider family.
export function aliasesOf(r) {
  const m = String(r.model || '').toLowerCase();
  const nick = m.match(/(fable|opus|sonnet|haiku|astra|sol|luna|terra|argon|flash)/)?.[1];
  const fam = { claude: ['claude', 'anthropic'], codex: ['codex', 'gpt', 'openai'], antigravity: ['antigravity', 'gemini', 'google'], grok: ['grok', 'xai'] }[r.agent] || [];
  return [r.name.toLowerCase(), ...(r.role ? [r.role] : []), ...(r.formerNames || []).map(n => n.toLowerCase()), ...(nick ? [nick] : []), ...fam];
}

export class Conductor {
  constructor(world, { baseUrl, dataDir }) {
    this.world = world; world.conductor = this; this.baseUrl = baseUrl;
    this.homes = path.join(dataDir, 'homes'); this.logs = path.join(dataDir, 'logs');
    fs.mkdirSync(this.logs, { recursive: true });
    this.queue = []; this.rr = 0; this.lastEnd = 0; this.current = null; this.turn = null;
    this.setAgyUrl = () => {}; // provided by server.js
    this.codexHome = this.prepareCodexHome(dataDir);
    world.postHooks = [post => this.onPost(post)];
    this.pendingDuties = [];
    world.tales.listeners = [t => this.duty('bard', t.zone ?? 'village', `tale:${t.id}`, `a hero's labour has ended and its tale is yours to tell (${t.id})`)];
    world.temple.listeners.omen.push(f => this.duty('priest', f.zone ?? 'village', `omen:${f.id}`, `an omen formed over ${f.project} (${f.id}) and awaits your judgement`, f.id));
    world.temple.listeners.fixReported.push(f => { if (world.temple.fixEligible(f)) this.duty('smith', f.zone ?? 'village', `fix:${f.id}`, `Fix-check ${f.id}: read_fix then fix_check; human confirmation is still required.`); });
    this.timer = setInterval(() => this.tick(), 3000); this.timer.unref?.();
  }

  duty(role, zone, key, reason, findingId) {
    this.pendingDuties ??= [];
    if (this.pendingDuties.some(d => d.key === key) || this.queue.some(j => j.dutyKey === key) || this.current?.dutyKey === key) return true;
    if (this.pendingDuties.length + this.queue.filter(j => j.duty).length >= 20) return false;
    this.pendingDuties.push({ role, zone, key, reason, findingId }); this.tick(); return true;
  }
  dispatchDuties() {
    const w = this.world; this.pendingDuties ??= [];
    for (const d of [...this.pendingDuties]) {
      if (d.role === 'bard' && w.s.tales.find(t => `tale:${t.id}` === d.key)?.tale) { this.pendingDuties.splice(this.pendingDuties.indexOf(d), 1); continue; }
      const f = d.findingId && w.s.findings.find(f => f.id === d.findingId);
      if (d.findingId && (!f || f.status !== 'omen')) { this.pendingDuties.splice(this.pendingDuties.indexOf(d), 1); continue; }
      const holder = w.dutyHolder(d.role, d.zone, c => !f || f.reviewer !== c.name && !f.seconds.some(s => s.by === c.name));
      if (!holder) continue;
      const primary = w.config.find(c => w.hasRole(c.name, d.role) && w.zoneOf(c.name) === d.zone);
      this.queue.push({ name: holder.name, reasons: [d.reason], human: false, depth: 0, dutyKey: d.key, duty: d, ...(holder.name !== primary.name ? { standIn: { role: d.role, for: primary.name, title: primary.title || d.role } } : {}) });
      this.pendingDuties.splice(this.pendingDuties.indexOf(d), 1);
    }
  }

  // Wake requests: { name, reason, depth, human }. Human-initiated wakes skip cooldowns and the daily budget;
  // resident-to-resident wakes need the village awake, respect a cooldown and a reply-chain ceiling.
  wake(name, reason = 'woken by the human', { depth = 0, human = true } = {}) {
    const q = this.queue.find(x => !x.guidance && !x.duty && x.name === name);
    if (q) { q.reasons.push(reason); q.human ||= human; this.tick(); return; }
    this.queue.push({ name, reasons: [reason], depth, human });
    this.tick();
  }

  onPost(post) {
    const w = this.world;
    // Mentions never wake anyone across the water.
    const zone = post.zone ?? 'village';
    const enabled = w.config.filter(r => w.s.residents[r.name].enabled && w.s.residents[r.name].zone === zone);
    // Only explicit @mentions wake anyone: @Name, @model (e.g. @fable, @astra), @family (@claude/@codex/@gemini/@grok), @all.
    const tags = new Set([...post.text.matchAll(/@([A-Za-z][\w.-]*)/g)].map(m => m[1].toLowerCase()));
    const mentioned = enabled.filter(r => r.name !== post.author && ((tags.has('all') && !w.hasRole(r.name, 'priest')) || aliasesOf(r).some(a => tags.has(a))));
    if (post.authorKind === 'visitor') return; // guests never spend the human's allowances by waking residents
    if (post.authorKind === 'human') {
      for (const r of mentioned) this.wake(r.name, `the human spoke to you on the board (${post.id})`);
      // Unaddressed human post in the village: the Watch hears it first (cheap), and answers, sends for one resident, or rings the steward.
      if (!mentioned.length && zone === 'village' && w.watch && w.dutyHolder('watch', 'village')) {
        w.watch.raise('human-post', post.id, 'village', `The human posted without addressing anyone (${post.id}): “${post.text.slice(0, 160)}${post.text.length > 160 ? '…' : ''}”`);
        w.watch.notify();
      } else if (!mentioned.length && !w.s.paused && enabled.length) {
        // Unaddressed human post elsewhere: wake whoever is nearest the human, else whoever has rested longest.
        const near = enabled.filter(r => w.s.residents[r.name].placeId === w.s.human.placeId);
        const pick = (near.length ? near : enabled).sort((a, b) => (w.s.residents[a.name].lastTurnAt || 0) - (w.s.residents[b.name].lastTurnAt || 0))[0];
        this.wake(pick.name, `the human posted on the board (${post.id})`);
      }
      return;
    }
    if (w.s.paused) return;
    const depth = (this.current?.depth ?? 0) + 1;
    if (depth > MAX_CHAIN) return;
    for (const r of mentioned) {
      const last = w.s.residents[r.name].lastTurnAt || 0;
      if (Date.now() - last < COOLDOWN_MS) continue;
      this.wake(r.name, `${post.author} mentioned you on the board (${post.id})`, { depth, human: false });
    }
  }

  prepareCodexHome(dataDir) {
    const home = path.join(dataDir, 'codex-home');
    fs.mkdirSync(home, { recursive: true, mode: 0o700 });
    const auth = path.join(home, 'auth.json');
    refreshAuth(path.join(HOME, '.codex/auth.json'), auth);
    fs.writeFileSync(path.join(home, 'config.toml'), [
      '# Amygdala resident Codex profile: no inherited MCP servers, plugins, apps, browser or sub-agents.',
      'web_search = "disabled"',
      '[features]', 'apps = false', 'plugins = false', 'browser_use = false', 'browser_use_external = false',
      'multi_agent = false', 'image_generation = false', 'memories = false', '',
    ].join('\n'));
    return home;
  }

  // Revoke the turn's capability and stop its process group (SIGTERM, then SIGKILL after a grace period).
  abort(reason) {
    if (!this.turn) return;
    const t = this.turn;
    this.world.revokeTurn(t.token);
    t.aborted = reason;
    const pg = sig => killTree(t.child, sig);
    pg('SIGTERM');
    setTimeout(() => { if (this.turn === t) { pg('SIGKILL'); this.finish(t, null, new Error(reason + ' (killed)')); } }, KILL_GRACE_MS).unref?.();
  }

  tick() {
    const w = this.world;
    if (this.guidanceActive || this.isolatedRuns) return;   // isolated guidance/triage runs hold the village still
    if (this.turn) {
      if (!this.turn.aborted && Date.now() - this.turn.started > TURN_TIMEOUT_MS) this.abort('timed out');
      return;
    }
    for (const r of w.config) if (w.zoneOf(r.name) === 'village') w.isHibernating(r.name);
    for (const j of [...this.queue]) if (j.duty) { this.queue.splice(this.queue.indexOf(j), 1); this.pendingDuties ??= []; this.pendingDuties.push(j.duty); }
    this.dispatchDuties();
    const day = new Date().toISOString().slice(0, 10), archivist = w.config.find(r => w.hasRole(r.name, 'archivist') && w.zoneOf(r.name) === 'village');
    if (archivist && w.isHibernating(archivist.name) && w.s.residents[archivist.name].digestDay !== day && this.digestDay !== day && this.pendingDuties.length + this.queue.filter(j => j.duty).length < 20) { this.digestDay = day; this.pendingDuties.push({ role: 'archivist', zone: 'village', key: `digest:${day}`, reason: 'The daily projects digest is due.' }); }
    w.visitors?.retryTriages?.();
    if (this.isolatedRuns) return;
    const overBudget = w.autoTurnsToday() >= w.s.dailyTurnBudget;
    // Sealed isle residents sleep: their memories aren't even in memory.
    const sealedOut = n => w.seal.locked && w.s.residents[n]?.zone === 'isle';
    this.queue = this.queue.filter(j => j.guidance || !sealedOut(j.name));
    // Duties (tales, omens, the Watch, fix-checks) run even when the village is paused or over budget, as before; never on a hibernating holder.
    const awake = j => w.s.residents[j.name]?.enabled && !w.isHibernating(j.name);
    let job = this.queue.find(j => j.human || j.duty && awake(j) || (!w.s.paused && !overBudget && awake(j)));
    if (job) this.queue.splice(this.queue.indexOf(job), 1);
    else {
      if (w.s.paused || overBudget || Date.now() - this.lastEnd < w.s.tickSeconds * 1000) return;
      // Automatic turns yield when a provider's shared allowance is running hot (the human's own work comes first).
      const order = w.config.filter(r => w.s.residents[r.name].enabled && !sealedOut(r.name) && !w.hasRole(r.name, 'priest') && !w.isHibernating(r.name));
      // A routine wake with nothing new to respond to spends a whole context for nothing; skip it (a long-idle resident still wakes).
      const pick = order.length && Array.from(order, (_, k) => order[(this.rr + k) % order.length]).find(r => this.hasNews(r.name));
      if (!pick) return;
      this.rr = order.indexOf(pick) + 1;
      job = { name: pick.name, reasons: ['your regular turn'], depth: 0, human: false };
    }
    if (job.guidance) { this.runGuidanceJob(job); return; }
    if (!job.human && !job.duty) w.countAutoTurn();
    this.current = job;
    this.run({ ...w.cfg(job.name), standIn: job.standIn }, job.reasons);
  }

  validateGuidance(name) {
    const w = this.world, r = w.cfg(name);
    if (!r || r.enabled === false || !w.s.residents[name]?.enabled || w.zoneOf(name) !== 'village' || !['claude', 'codex', 'antigravity'].includes(r.agent)) throw new Error('Choose an enabled village Claude or Codex or Gemini resident.');
    const limit = 85;
    if ((w.usage.providerPressure({ claude: 'anthropic', codex: 'openai', antigravity: 'google' }[r.agent], r.model) ?? 0) >= limit) throw new Error(`${r.agent} usage is at or above ${limit}%; choose another answerer or answer yourself.`);
    return r;
  }
  async runGuidanceJob(job) {
    const w = this.world, p = w.s.petitions.find(p => p.id === job.guidance);
    if (!p || p.status !== 'allowed') return;
    this.guidanceActive = true; this.current = job;
    const startedAt = Date.now(); let r, text = '', outcome = 'error';
    try {
      r = this.validateGuidance(job.name);
      p.status = 'answering'; w.changed();
      this.setAgyUrl?.(null);   // agy's global MCP entry back to the identity-less endpoint before an isolated run
      const result = await (this.guidanceRunner || runGuidance)(r, p, { codexHome: this.codexHome });
      text = result.text || ''; outcome = 'ok';
      if (!result.answer?.trim()) throw new Error('Empty answer');
      w.visitors.answer(p, r.name, result.answer);
    } catch (e) { outcome = 'error'; text = e.usageText || text; p.status = 'failed'; p.note = 'the answer could not be prepared; ask again later'; }
    finally {
      if (r) w.usage.record({ resident: r.name, agent: r.agent, model: r.model, zone: 'village', kind: 'guidance', startedAt, endedAt: Date.now(), outcome, text });
      this.current = null; this.guidanceActive = false; this.lastEnd = Date.now(); w.changed(); this.tick();
    }
  }

  // Something a resident would actually respond to since their last turn: others' posts or exhibits, or a duty.
  hasNews(name) {
    const w = this.world, r = w.s.residents[name], seen = r.seen || {}, zone = r.zone ?? 'village', c = w.cfg(name);
    const num = id => parseInt(String(id).slice(1), 10) || 0, here = x => (x.zone ?? 'village') === zone;
    if (!r.lastTurnAt || Date.now() - r.lastTurnAt > IDLE_WAKE_MS || r.pendingNaming || !r.appearance) return true;
    if (w.s.posts.some(p => here(p) && p.author !== name && num(p.id) > (seen.post || 0))) return true;
    if (w.s.exhibits.some(e => here(e) && e.author !== name && num(e.id) > (seen.exhibit || 0))) return true;
    if (w.temple.visibleTo(name).length || w.tales.pendingFor(name).length) return true;
    return w.actsAs(name, 'watch') && !!w.watch?.state.pending?.length;
  }

  run(r, reasons = []) {
    const w = this.world;
    const build = AGENTS[r.agent];
    if (!build) { w.addFeed(r.name, `${r.name} could not wake (unknown agent "${r.agent}")`); return; }
    const cwd = path.join(this.homes, r.name);
    fs.mkdirSync(cwd, { recursive: true });
    // Per-turn capability: the only URL that can act as this resident, valid until the turn ends.
    const token = crypto.randomBytes(24).toString('base64url');
    const url = `${this.baseUrl}/mcp/t/${token}`;
    w.beginTurn(r.name, token);
    let view = ''; try { view = this.lookFor?.(r.name) || ''; } catch {}
    const ctx = { codexHome: this.codexHome, setAgyUrl: this.setAgyUrl, view };
    const { cmd, args, setup, teardown, env } = build(r, url, cwd, reasons, ctx);
    const isle = w.s.residents[r.name].zone === 'isle';
    // Isle turns leave no plaintext transcript behind.
    const log = isle ? null : fs.createWriteStream(path.join(this.logs, `${r.name}.log`), { flags: 'a' });
    log?.write(`\n===== ${new Date().toISOString()} turn start (${r.agent} ${r.model}) =====\n`);
    const kind = r.rank === 'priest' ? 'priest' : reasons.some(x => /Temple commanded/.test(x)) ? 'temple' : 'life';
    const t = this.turn = { promptChars: turnPrompt(r, reasons, view).length, viewChars: view.length, name: r.name, agent: r.agent, model: r.model, zone: w.zoneOf(r.name), kind, token, started: Date.now(), log, teardown, child: null, done: false, out: [] , outLen: 0 };
    try {
      setup?.();
      refreshAuth(path.join(HOME, '.codex/auth.json'), path.join(this.codexHome, 'auth.json'));
      t.child = spawn(cmd, args, { cwd, env: { ...process.env, PATH, ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    } catch (e) { return this.finish(t, null, e); }
    // Keep (bounded) output in memory to read the usage report; isle turns are never written to a log.
    const keep = c => { if (t.outLen < (2 << 20)) { t.out.push(c); t.outLen += c.length; } };
    t.child.stdout.on('data', keep); t.child.stderr.on('data', keep);
    if (log) { t.child.stdout.pipe(log, { end: false }); t.child.stderr.pipe(log, { end: false }); }
    t.child.on('error', e => this.finish(t, null, e));
    t.child.on('close', code => this.finish(t, code));
  }

  // Runs exactly once per turn.
  finish(t, code, err) {
    if (t.done) return;
    t.done = true;
    if (this.turn === t) this.turn = null;
    this.world.revokeTurn(t.token);
    try { t.teardown?.(); } catch {}
    t.log?.end(`\n===== turn end: ${err ? 'error ' + err.message : t.aborted ? t.aborted : 'exit ' + code} after ${Math.round((Date.now() - t.started) / 1000)}s =====\n`);
    this.lastEnd = Date.now();
    this.world.usage.record({ resident: t.name, agent: t.agent, model: t.model, zone: t.zone, kind: t.kind, startedAt: t.started, endedAt: Date.now(),
      outcome: err ? 'error' : t.aborted ? 'aborted' : code ? 'failed' : 'ok', text: Buffer.concat(t.out).toString('utf8'), promptChars: t.promptChars, viewChars: t.viewChars });
    t.out = null;
    this.world.watch?.completed(t.name);
    this.current = null;
    if (err || code || t.aborted) this.world.addFeed(t.name, `${t.name} stirred but couldn't get up (${t.aborted || (err ? err.code || err.message : 'exit ' + code)})`);
    this.world.endTurn(t.name);
    this.world.watch?.turnEnded(t, err ? 'error' : t.aborted ? 'aborted' : code ? 'failed' : 'ok');
  }
}
