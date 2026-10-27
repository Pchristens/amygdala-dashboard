const WEEK = 7 * 86400000;
export function weeklyWindow(limits, now = Date.now()) {
  const p = limits?.providers?.find(p => p.id === 'codex');
  if (!p || p.stale) return null;
  const w = p.windows?.find(w => w.kind === 'seven_day');
  const reset = Number(w?.resets_at);
  return w && !w.stale && Number.isFinite(reset) && reset * 1000 > now ? reset : null;
}
export function readingDue(limits, state, now = Date.now()) {
  const reset = weeklyWindow(limits, now);
  return reset !== null && now >= reset * 1000 - 3600000 && !(state.windows || []).includes(reset) ? reset : null;
}
export class Starwatch {
  constructor(world, conductor, { start = true } = {}) {
    this.w = world; this.c = conductor;
    world.s.starwatch ??= { windows: [], lastReadingAt: null };
    if (start) { this.timer = setInterval(() => this.scan(), 180000); this.timer.unref?.(); }
  }
  scan(now = Date.now()) {
    const reset = readingDue(this.w.usage.limits, this.w.s.starwatch, now);
    const r = this.w.config.find(r => r.role === 'starwatcher' && this.w.s.residents[r.name]?.enabled);
    if (reset === null || !r) return;
    const s = this.w.s.starwatch;
    if (!this.c.duty('starwatcher', 'village', `starwatch:${reset}`, 'Starwatch reading')) return;
    s.windows.push(reset); s.lastReadingAt = now;
    this.w.changed();
  }
  snapshot(now = Date.now()) {
    const s = this.w.s.starwatch, reset = weeklyWindow(this.w.usage.limits, now);
    const r = this.w.config.find(r => r.role === 'starwatcher');
    const jobs = [...this.c.queue, ...(this.c.current ? [this.c.current] : [])];
    return { lastReadingAt: s.lastReadingAt, nextReadingAt: reset !== null && !s.windows.includes(reset) ? reset * 1000 - 3600000 : null,
      running: (this.c.pendingDuties || []).some(d => d.role === 'starwatcher') || !!r && jobs.some(j => (j.standIn?.role === 'starwatcher' || j.name === r.name) && j.reasons.includes('Starwatch reading')) };
  }
  digest(now = Date.now()) {
    const safe = r => r.zone === 'village' && !r.isleTagged && !r.quarantined && !(this.w.s.quarantine || []).includes(`${r.project}@${r.host}`);
    const aggregate = (rows, key, time, tokens) => {
      const groups = {};
      for (const r of rows.filter(safe)) {
        const age = now - time(r); if (age < 0 || age >= 2 * WEEK) continue;
        const g = groups[key(r)] ??= { last7: { turns: 0, tokens: 0 }, prior7: { turns: 0, tokens: 0 } };
        const v = age < WEEK ? g.last7 : g.prior7; v.turns += r.turns ?? 1; v.tokens += tokens(r) || 0;
      }
      return groups;
    };
    const findings = {};
    for (const f of this.w.s.findings.filter(safe).filter(f => this.w.temple.villageSafe(f))) {
      const key = JSON.stringify([f.project, f.category || f.severity || 'uncategorized']);
      findings[key] = (findings[key] || 0) + 1;
    }
    return { providers: aggregate(this.w.s.usageDaily, r => r.provider, r => Date.parse(r.day), r => r.tokens),
      residents: aggregate(this.w.s.usage, r => `${r.provider}/${r.resident}`, r => r.startedAt, r => r.total),
      coverage: 'Provider totals use durable daily rows; resident totals use retained ledger records. Unreported tokens count as zero.',
      tales: this.w.s.tales.filter(safe).filter(t => t.tale && (t.endedAt || t.createdAt) >= now - 2 * WEEK).slice(-30).map(t => t.tale.title), findings };
  }
}
