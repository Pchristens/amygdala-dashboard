import { bin, deckAvailable, commissionReason } from './bin.js';
// The Lamplighter's ledger: what the residents' turns consumed (oil), kept separately from the tree on purpose —
// spending is not accomplishment. Records are per zone (the isle's are sealed with the rest of the isle), measured
// values stay null when a CLI doesn't report them, and provider limits are account-level data shown only to the human.
import { execFile } from './bin.js';
import os from 'node:os';
import { providerOfModel } from './temple.js';
import { probeClaude, probeAntigravity, probeCodex, probeGrok } from './fleet.js';

// Allowance pools follow the CLI's account, not the model's maker: Opus run through agy spends Antigravity's pool.
export const POOL = { claude: 'anthropic', codex: 'openai', antigravity: 'google', grok: 'xai' };
const DECK = 'agent-deck';
const MAX_RECORDS = 1500;
const day = (ts = Date.now()) => new Date(ts).toISOString().slice(0, 10);
const n = v => (Number.isFinite(+v) && v !== null && v !== '' ? +v : null);
// Weekly cost per turn (v0.54): a reading at most PRE before a turn starts, one between LAG and POST after it ends.
// Activity is checked from MARGIN before the first reading, since providers' figures can trail the spending a little.
const PRE_MS = 20 * 60000, POST_MS = 20 * 60000, LAG_MS = 60000, MARGIN_MS = 2 * 60000, HERO_SEEN_MS = 2 * 60000, RECENT = 50;
const PROVIDER_ID = { anthropic: 'claude', openai: 'codex', google: 'antigravity', xai: 'grok' };
const HERO_POOL = { claude: 'anthropic', codex: 'openai', antigravity: 'google', gemini: 'google', grok: 'xai' }; // any other tool may be on any account
// The weekly window that gates this model: Fable has its own weekly, each Antigravity pool its own (as providerPressure).
export function gatingWeekly(p, model = '') {
  const m = String(model).toLowerCase(), wk = (p?.windows || []).filter(w => w && /^seven_day/.test(w.kind) && !w.stale && Number.isFinite(w.used_percentage) && Number.isFinite(w.observedAt));
  if (p?.id === 'claude') return m.includes('fable') && wk.find(w => w.kind === 'seven_day_fable') || wk.find(w => w.kind === 'seven_day') || null;
  if (p?.id === 'antigravity') return wk.find(w => /argon/.test(m) ? /argon/i.test(w.label) : /claude|gpt/.test(m) ? /^claude and gpt/i.test(w.label) : /^gemini models/i.test(w.label)) || null;
  return wk.find(w => w.kind === 'seven_day') || null;
}
// A window whose reset time has passed is spent no more: providers only report again on the next request (Codex), so
// an old 100% would otherwise block that pool's residents forever after the reset (v0.55).
export const rolled = (w, now = Date.now()) => { const r = +w?.resets_at; return Number.isFinite(r) && r > 0 && (r < 1e12 ? r * 1000 : r) <= now; };
const winKey = (p, w) => `${p.id}:${w.kind}:${w.pool || (p.id === 'antigravity' ? w.label : '')}`;

// Find the last usage-looking object anywhere in a CLI's output (JSON documents or JSON lines).
function findUsage(text) {
  let found = null, cost = null;
  const visit = o => {
    if (!o || typeof o !== 'object') return;
    if (n(o.total_cost_usd) != null) cost = n(o.total_cost_usd);
    const keys = Object.keys(o);
    if (keys.some(k => /^(input_tokens|inputTokens|prompt_tokens|promptTokenCount|output_tokens|outputTokens|candidatesTokenCount|totalTokenCount|total_tokens)$/.test(k))) found = o;
    for (const v of Object.values(o)) if (v && typeof v === 'object') visit(v);
  };
  // A document's own top-level usage (e.g. Claude's whole-turn total) wins over nested per-step/per-model parts.
  let top = null;
  for (const chunk of [text, ...text.split('\n')]) {
    const t = chunk.trim();
    if (!t.startsWith('{') && !t.startsWith('[')) continue;
    try {
      const d = JSON.parse(t);
      if (d && typeof d.usage === 'object' && d.usage) { top = d.usage; if (n(d.total_cost_usd) != null) cost = n(d.total_cost_usd); }
      else visit(d);
    } catch {}
  }
  return { u: top || found, cost };
}

// Normalise per CLI. Claude's input excludes cache reads; Codex's input includes its cached tokens.
export function parseUsage(agent, text) {
  const { u, cost } = findUsage(text);
  if (!u) {
    const m = text.match(/tokens used\s*\n?\s*([\d,]+)/i); // codex plain-text fallback
    return m ? { total: +m[1].replace(/,/g, ''), status: 'reported', cost: null } : { status: 'unavailable', cost };
  }
  const input = n(u.input_tokens ?? u.inputTokens ?? u.prompt_tokens ?? u.promptTokenCount);
  const output = n(u.output_tokens ?? u.outputTokens ?? u.completion_tokens ?? u.candidatesTokenCount);
  const cacheRead = n(u.cache_read_input_tokens ?? u.cached_input_tokens ?? u.cache_read_tokens ?? u.cachedContentTokenCount ?? u.cacheReadInputTokens ?? u.cacheReadTokens);
  const cacheWrite = n(u.cache_creation_input_tokens ?? u.cacheCreationInputTokens ?? u.cacheWriteTokens);
  const reported = n(u.total_tokens ?? u.totalTokenCount ?? u.totalTokens);
  let total = reported;
  if (total == null) total = agent === 'claude' ? (input ?? 0) + (output ?? 0) + (cacheRead ?? 0) + (cacheWrite ?? 0) : (input ?? 0) + (output ?? 0);
  return { input, output, cacheRead, cacheWrite, reportedTotal: reported, total, cost, status: 'reported' };
}

const fresh = ws => (ws || []).map(({ observedAt, ...w }) => w); // a reading's windows are stamped with its own time, never one supplied

export class Usage {
  constructor(world) {
    this.w = world;
    world.s.usage ??= [];
    world.s.usageDaily ??= [];
    world.s.turnWeekly ??= {};
    // In memory only: pending weekly samples (village turns) and anonymous provider activity (every zone, no names or content).
    this.pending = []; this.activity = []; this.heroBusy = {}; this.heroSeenAt = null;
    this.limits = { observedAt: null, providers: [] };
    // Each pool on its own cadence; none of these spend model quota. Grok opens its UI briefly, so it's polled least.
    const every = (fn, ms) => { fn(); setInterval(fn, ms).unref?.(); };
    every(() => this.pollDeck(), 5 * 60000);
    every(() => this.probe(probeClaude), 15 * 60000);
    every(() => this.probe(probeAntigravity), 15 * 60000);
    every(() => this.probe(probeCodex, p => this.mergeCodex(p)), 60000); // a busy Codex hero can spend 10% of its window a minute
    every(() => this.probe(async () => (await probeGrok(os.homedir())) ?? probeGrok(os.homedir())), 30 * 60000); // one retry: the UI is sometimes slow to start
  }
  setProvider(p) {
    const i = this.limits.providers.findIndex(x => x.id === p.id);
    p.observedAt ??= Date.now();
    // Each window keeps the time it was actually read (a Fable weekly carried over from an older reading keeps its own).
    p.windows = (p.windows || []).map(w => Number.isFinite(w.observedAt) ? w : { ...w, observedAt: p.observedAt });
    if (i < 0) this.limits.providers.push(p); else this.limits.providers[i] = p;
    this.limits.observedAt = Date.now();
    this.w.steward?.maintain();
    this.settle?.();
    this.w.changed();
  }
  // Every reading of the machine goes through here, so tests can stub it and never see real allowances.
  async probe(fn, put = p => this.setProvider(p)) { try { const p = await fn(); if (p) put(p); } catch {} }
  // agent-deck's quick Claude reading; merged with the fuller `claude /usage` (which adds the Fable weekly).
  pollDeck() {
    if (!deckAvailable()) return;
    execFile(DECK, ['usage', '--json'], { timeout: 15000 }, (err, out) => {
      if (err) return;
      try {
        const c = (JSON.parse(out).providers || []).find(p => p.id === 'claude'); if (!c) return;
        this.mergeDeck(c);
      } catch {}
    });
  }

  // Codex is read from whichever machine ran Codex last (the server's own log or a node's): the newest reading wins.
  mergeCodex(c) {
    const cur = this.limits.providers.find(p => p.id === 'codex');
    if (!Number.isFinite(c.observedAt) || cur && cur.observedAt >= c.observedAt) return;
    this.setProvider({ id: 'codex', label: 'Codex', ...(c.plan && { plan: c.plan }), windows: fresh(c.windows), observedAt: c.observedAt, source: c.source || 'node codex log' });
  }
  mergeDeck(c) {
    if (c.id === 'codex') return this.mergeCodex(c);
    if (c.id === 'grok') {
      const cur = this.limits.providers.find(p => p.id === 'grok');
      if (cur && cur.source !== 'node usage' && Date.now() - cur.observedAt < 35 * 60000) return;
      this.setProvider({ id: 'grok', label: 'Grok', windows: fresh(c.windows), source: 'node usage' }); return;
    }
    const cur = this.limits.providers.find(p => p.id === 'claude');
    const fable = cur?.windows.filter(w => w.kind === 'seven_day_fable') ?? [];
    this.setProvider({ id: 'claude', label: 'Claude', windows: [...fresh(c.windows), ...fable], source: 'agent-deck usage' + (fable.length ? ' + claude /usage' : '') });
  }

  record({ resident, agent, model, zone, kind, startedAt, endedAt, outcome, text, promptChars, viewChars, web, turnId }) {
    this.turnEnded({ turnId, agent, model, startedAt, endedAt });
    const p = parseUsage(agent, text || '');
    const rec = { id: this.w.id('u'), zone, source: 'resident', resident, kind, provider: POOL[agent] || providerOfModel(model || agent), model: model || agent,
      startedAt, endedAt, durationMs: endedAt - startedAt, outcome, ...p, ...(promptChars && { promptChars, viewChars }), ...(web && zone === 'village' && { web: true }) };
    if (zone === 'isle' && this.w.seal?.locked) return; // never write isle records while sealed
    const s = this.w.s;
    s.usage.push(rec);
    const mine = s.usage.filter(r => r.zone === zone);
    if (mine.length > MAX_RECORDS) { const drop = new Set(mine.slice(0, mine.length - MAX_RECORDS).map(r => r.id)); s.usage = s.usage.filter(r => !drop.has(r.id)); }
    // Durable per-day aggregate (survives record pruning): one row per zone/day/provider.
    const key = `ud-${zone}-${day(startedAt)}-${rec.provider}`;
    let d = s.usageDaily.find(x => x.id === key);
    if (!d) s.usageDaily.push(d = { id: key, zone, day: day(startedAt), provider: rec.provider, turns: 0, measuredTurns: 0, tokens: 0, cost: 0, durationMs: 0 });
    d.turns++; d.durationMs += rec.durationMs;
    if (rec.status === 'reported') { d.measuredTurns++; d.tokens += rec.total || 0; d.cost += rec.cost || 0; }
    this.w.changed();
  }

  // ---------- weekly cost per turn (v0.54) ----------
  // A turn's cost is the gating weekly's rise from a reading just before it to one just after; it counts only when nothing
  // else could have spent that pool meanwhile: no other resident turn or isolated run on it, and no hero on it (any machine).
  turnBegan({ id, resident, agent, model, zone, started = Date.now() }) {
    if (!this.activity) return;
    const pool = POOL[agent] || providerOfModel(model || agent);
    this.activity.push({ id, pool, from: started, to: null });
    if (zone !== 'village') return; // the isle is never measured
    const p = this.limits.providers.find(x => x.id === PROVIDER_ID[pool]), pre = gatingWeekly(p, model);
    if (!pre || started - pre.observedAt < 0 || started - pre.observedAt > PRE_MS) return;
    this.pending.push({ turnId: id, resident, model: model || agent, key: winKey(p, pre), label: `${p.label || p.id} ${pre.label || pre.kind}`, startedAt: started, endedAt: null,
      pre: { pct: pre.used_percentage, observedAt: pre.observedAt, resetsAt: pre.resets_at ?? null } });
  }
  turnEnded({ turnId, agent, model, startedAt, endedAt }) {
    if (!this.activity) return;
    const a = turnId && this.activity.find(x => x.id === turnId);
    if (a) a.to = endedAt; else this.activity.push({ id: turnId || null, pool: POOL[agent] || providerOfModel(model || agent), from: startedAt, to: endedAt }); // guidance, triage, audit
    const smp = turnId && this.pending.find(x => x.turnId === turnId);
    if (smp) smp.endedAt = endedAt;
    this.settle();
  }
  // Every hero sync: the last moment a hero on each pool was (or may have been) spending. '*' is a hero whose account is unknown.
  noteHeroes(list, now = Date.now()) {
    this.heroSeenAt = now; this.heroBusy ??= {};
    for (const h of list || []) {
      if (h.archived) continue;
      const last = Number.isFinite(h.lastActivityAt) ? (h.lastActivityAt < 1e12 ? h.lastActivityAt * 1000 : h.lastActivityAt) : null;
      const at = h.status === 'running' || h.stale || !['waiting', 'idle', 'error', 'stopped'].includes(h.status) ? now : last;
      const pool = HERO_POOL[h.tool] || '*';
      if (at != null) this.heroBusy[pool] = Math.max(this.heroBusy[pool] || 0, at);
    }
  }
  taint(smp, post, pool, now) {
    const from = smp.pre.observedAt - MARGIN_MS, to = post.observedAt;
    if (this.activity.some(a => a.id !== smp.turnId && a.pool === pool && a.from <= to && (a.to ?? Infinity) >= from)) return 'overlap';
    const c = this.w.conductor;
    if (c?.isolatedRuns || c?.guidanceActive) return 'isolated'; // a run whose record isn't written yet
    if (this.heroSeenAt == null || now - this.heroSeenAt > HERO_SEEN_MS || Math.max(this.heroBusy[pool] || 0, this.heroBusy['*'] || 0) >= from) return 'hero';
    return null;
  }
  settle(now = Date.now()) {
    if (!this.pending || !this.activity) return; // a bare Usage (tests, fixtures) keeps no samples
    this.activity = this.activity.filter(a => a.to == null || now - a.to < 6 * 3600000);
    for (const smp of [...this.pending]) {
      const drop = () => this.pending.splice(this.pending.indexOf(smp), 1);
      if (smp.endedAt == null) { if (now - smp.startedAt > 6 * 3600000) drop(); continue; }
      const pid = smp.key.split(':')[0], pool = Object.keys(PROVIDER_ID).find(k => PROVIDER_ID[k] === pid);
      const p = this.limits.providers.find(x => x.id === pid), post = gatingWeekly(p, smp.model);
      if (!(post && winKey(p, post) === smp.key && post.observedAt >= smp.endedAt + LAG_MS && post.observedAt - smp.endedAt <= POST_MS)) {
        if (now - smp.endedAt > POST_MS + LAG_MS) { drop(); this.tally(smp, 'noReading'); }
        continue;
      }
      drop();
      const delta = post.used_percentage - smp.pre.pct;
      // A fall, or a moved reset time, means the week rolled over in between.
      const reset = delta < 0 || smp.pre.resetsAt != null && post.resets_at != null && Math.abs(post.resets_at - smp.pre.resetsAt) > 3600;
      this.tally(smp, reset ? 'reset' : this.taint(smp, post, pool, now), delta);
    }
  }
  tally(smp, reason, delta) {
    if (!smp.resident) return;
    const k = `${smp.resident}|${smp.model}|${smp.key}`, e = this.w.s.turnWeekly[k] ??= { resident: smp.resident, model: smp.model, window: smp.label, n: 0, sumDelta: 0, discarded: 0, reasons: {}, recent: [], since: Date.now() };
    if (reason) { e.discarded++; e.reasons[reason] = (e.reasons[reason] || 0) + 1; }
    else { e.n++; e.sumDelta += delta; e.recent = [...e.recent, delta].slice(-RECENT); }
    e.updatedAt = Date.now(); this.w.changed();
  }
  // Per village resident: the entry for the model it runs now (else its best-sampled one).
  weeklyPerTurn() {
    const out = {}, all = Object.values(this.w.s.turnWeekly || {});
    for (const name of new Set(all.map(e => e.resident))) {
      if ((this.w.zoneOf?.(name) ?? 'village') !== 'village') continue;
      const mine = all.filter(e => e.resident === name).sort((a, b) => b.n - a.n), cur = this.w.cfg?.(name)?.model;
      const e = mine.find(e => e.model === cur) || mine[0];
      out[name] = { model: e.model, window: e.window, perTurnPct: e.n ? +(e.sumDelta / e.n).toFixed(2) : null, samples: e.n, discarded: e.discarded, reasons: e.reasons, since: e.since };
    }
    return out;
  }

  // Highest reported usage % across a provider's windows (Claude 5h/7d etc.); null if unknown.
  // Highest used % among the windows that actually gate this model (e.g. Fable has its own weekly; Argon its own pool).
  providerPressure(provider, model = '') {
    const id = { anthropic: 'claude', openai: 'codex', google: 'antigravity', xai: 'grok' }[provider];
    const p = this.limits?.providers?.find(x => x.id === id);
    if (!p) return null;
    const m = String(model).toLowerCase();
    const relevant = p.windows.filter(w => !w.stale && (
      id === 'claude' ? (w.kind !== 'seven_day_fable' || m.includes('fable')) :
      id === 'antigravity' ? (/argon/.test(m) ? /argon|gemini models/i.test(w.label) : /claude|gpt/.test(m) ? /^claude and gpt/i.test(w.label) : /^gemini models/i.test(w.label)) : true));
    return relevant.length ? Math.max(...relevant.map(w => rolled(w) ? 0 : w.used_percentage ?? 0)) : null;
  }

  // What a resident is told: simple operational guidance, enforced server-side elsewhere.
  guidance() {
    const used = this.w.autoTurnsToday(), budget = this.w.s.dailyTurnBudget;
    const state = used >= budget ? 'exhausted' : used >= budget * 0.75 ? 'conserve' : 'normal';
    return { state, line: state === 'normal' ? 'The lamps are full.' : state === 'conserve'
      ? 'The lamp oil is running low today: prefer advancing an existing commitment over starting new things, and keep the turn short.'
      : 'The lamps are nearly dry: do one meaningful thing and rest.' };
  }

  // Human-facing view for one zone (the isle's only exists while unsealed).
  view(zone) {
    const s = this.w.s, today = day();
    const daily = s.usageDaily.filter(d => d.zone === zone);
    const recs = s.usage.filter(r => r.zone === zone);
    const sum = (rows, f) => rows.reduce((a, r) => a + (r[f] || 0), 0);
    const byProvider = {};
    for (const d of daily) { const p = byProvider[d.provider] ??= { tokens: 0, turns: 0, measuredTurns: 0, cost: 0, today: 0 }; p.tokens += d.tokens; p.turns += d.turns; p.measuredTurns += d.measuredTurns; p.cost += d.cost; if (d.day === today) p.today += d.tokens; }
    const byResident = {}, byKind = {};
    for (const r of recs.filter(r => day(r.startedAt) === today)) {
      const a = byResident[r.resident] ??= { tokens: 0, turns: 0 }; a.turns++; a.tokens += r.total || 0;
      const k = byKind[r.kind] ??= { tokens: 0, turns: 0 }; k.turns++; k.tokens += r.total || 0;
    }
    // Outcome ratios (noisy early on): tokens per accepted artifact / per confirmed fix.
    const artifacts = s.exhibits.filter(e => (e.zone ?? 'village') === zone).length + s.built.filter(b => (b.zone ?? 'village') === zone).length;
    const fixes = s.findings.filter(f => (f.zone ?? 'village') === zone && f.status === 'fixed').length;
    const allTokens = sum(daily, 'tokens');
    return {
      zone,
      allTime: { tokens: allTokens, turns: sum(daily, 'turns'), measuredTurns: sum(daily, 'measuredTurns'), cost: +sum(daily, 'cost').toFixed(4) },
      today: { tokens: sum(daily.filter(d => d.day === today), 'tokens'), turns: sum(daily.filter(d => d.day === today), 'turns') },
      byProvider, byResident, byKind, ...(zone === 'village' && { weeklyPerTurn: this.weeklyPerTurn() }),
      history: [...new Set(daily.map(d => d.day))].sort().slice(-14).map(dd => ({ day: dd, tokens: sum(daily.filter(d => d.day === dd), 'tokens'), turns: sum(daily.filter(d => d.day === dd), 'turns') })),
      perArtifact: artifacts ? Math.round(allTokens / artifacts) : null,
      perConfirmedFix: fixes ? Math.round(sum(daily, 'tokens') / fixes) : null,
      recent: recs.slice(-12).reverse().map(({ id, resident, kind, provider, model, total, status, durationMs, endedAt, outcome, web }) => ({ id, resident, kind, provider, model, total, status, durationMs, endedAt, outcome, ...(web && { web }) })),
    };
  }
  // The human's view of the limits: a window past its reset reads 0% and rolledOver, the stored reading is untouched.
  limitsView() { return { ...this.limits, providers: this.limits.providers.map(p => ({ ...p, windows: (p.windows || []).map(w => rolled(w) ? { ...w, used_percentage: 0, rolledOver: true } : w) })) }; }
  snapshot() {
    return {
      village: this.view('village'),
      isle: this.w.seal?.locked ? { sealed: true } : this.view('isle'),
      // Account-level provider windows: shared by everything using that account (residents, your sessions, other machines).
      limits: this.limitsView(),
      sessions: { status: 'unmeasured', note: 'Token counts for your own agent-deck sessions are not imported yet; provider limits above cover them at account level.' },
      guidance: this.guidance().state,
    };
  }
}
