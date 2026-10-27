// The hero bridge: heroes on machines without agent-deck (e.g. native Windows) report their own status over the gate.
// A hero pass (hfh_…) names the hero and its zone; the PowerShell launcher (tools/hearthfield-hero.ps1) reports
// running → heartbeats → stopped. Only status crosses the network — never files or transcripts. Isle heroes' titles are
// not kept while the isle is sealed (they render as runes like any sealed hero).
import crypto from 'node:crypto';

const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const clip = (s, n) => String(s ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, n);
const STALE_MS = 2 * 60000, GONE_MS = 30 * 60000;
const STATUSES = ['running', 'waiting', 'idle', 'stopped', 'error'];

export class Bridge {
  constructor(world) {
    this.w = world;
    world.s.heroPasses ??= [];
    this.live = new Map(); // passId -> { status, title, project, tool, host, lastSeen }
  }
  issue(name, zone = 'village', hours = 24 * 7, label = '') {
    name = clip(name, 40);
    if (!/^[A-Za-z][A-Za-z0-9 _:-]{1,39}$/.test(name)) throw new Error('Name: letters, digits, spaces, - _ :');
    if (!['village', 'isle'].includes(zone)) throw new Error('zone must be village or isle');
    const token = 'hfh_' + crypto.randomBytes(24).toString('base64url');
    const p = { id: this.w.id('hp'), name, label: clip(label, 60), zone, tokenHash: sha(token), createdAt: Date.now(),
      expiresAt: Date.now() + Math.min(Math.max(+hours || 168, 1), 24 * 90) * 3600000, revoked: false };
    this.w.s.heroPasses.push(p);
    this.w.changed();
    const { tokenHash, ...pub } = p;
    return { pass: pub, token };
  }
  revoke(id) { const p = this.w.s.heroPasses.find(x => x.id === id); if (!p) throw new Error('No such pass.'); p.revoked = true; this.live.delete(id); this.w.changed(); }
  auth(token) {
    const h = sha(token || '');
    const p = this.w.s.heroPasses.find(x => x.tokenHash === h);
    return p && !p.revoked && p.expiresAt > Date.now() ? p : null;
  }
  report(p, b, from) {
    const status = STATUSES.includes(b.status) ? b.status : 'running';
    const sealed = p.zone === 'isle' && this.w.seal.locked;
    this.live.set(p.id, {
      status, lastSeen: Date.now(), host: clip(b.host || from || 'remote', 40), tool: clip(b.tool || 'other', 20).toLowerCase(),
      // While the isle is sealed, keep no plaintext about what an isle hero is doing.
      title: sealed ? null : clip(b.title || p.name, 80), project: sealed ? null : clip(b.project || 'labour', 60),
    });
    if (!sealed && p.zone === 'village' && Array.isArray(b.fixedFindings)) {
      for (const id of b.fixedFindings) {
        const f = this.w.s.findings.find(f => f.id === id);
        const o = f && this.w.temple.get(f.offeringId);
        if (o?.workerId === `bridge:${p.id}` && f.status === 'decreed') this.w.temple.reportFixed(id);
      }
    }
    this.w.refreshWorkers?.();
  }
  // Worker records merged into the agent-deck list on every sync.
  workers() {
    const now = Date.now(), out = [];
    for (const p of this.w.s.heroPasses) {
      const h = this.live.get(p.id);
      if (!h || p.revoked) continue;
      if (now - h.lastSeen > GONE_MS) { this.live.delete(p.id); continue; }
      out.push({ id: `bridge:${p.id}`, title: h.title ?? p.name, tool: h.tool, project: h.project ?? p.name, path: '', host: h.host,
        status: h.status !== 'stopped' && now - h.lastSeen > STALE_MS ? 'idle' : h.status, stale: now - h.lastSeen > STALE_MS,
        group: p.zone === 'isle' ? 'isle' : '', bridge: true, updatedAt: h.lastSeen });
    }
    return out;
  }
  passes() { return this.w.s.heroPasses.filter(p => !p.revoked && p.expiresAt > Date.now()).map(({ tokenHash, ...p }) => p); }
}
