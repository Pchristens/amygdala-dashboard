// The Steward's House (v0.49): what the human reads beside the Quiet Stone. A read-only view, derived on every human
// snapshot from records kept elsewhere (the Temple's ledger, governance approvals and receipts, the running commit,
// node passes, the commission path): it writes nothing and keeps no copy, so the Temple ledger stays the one source of
// truth. Village only: a project key that touches the isle, a quarantine or a private hero is left out entirely.
export const HOUSE_ID = 'stewards-house';
const HEX = /^[0-9a-f]{40}$/, AUTHORISES = ['ruling', 'appeal ruling', 'override'], NOTE_KINDS = ['override', 'skip', 'appeal', 'appeal ruling'];
const clip = (s, n) => s == null ? null : String(s).slice(0, n);

// A `project@host` key is the village's only when nothing with that key is isle-bound, quarantined, sealed or private.
export function villageKey(w) {
  const q = new Set(w.s.quarantine || []), qh = new Set(w.s.quarantineHashes || []);
  const bad = new Set([...(w.rawWorkers || []), ...(w.workers || [])].filter(x => w.sites.privateWorker(x)).map(x => `${x.project}@${x.host}`));
  for (const o of w.s.offerings || []) if (!w.temple.villageSafe(o)) bad.add(`${o.project}@${o.host}`);
  return key => typeof key === 'string' && !q.has(key) && !bad.has(key) && !(qh.size && w.seal?.hashProject && qh.has(w.seal.hashProject(key)));
}

// What authorised a receipt: the trivial check's skip, or an accepting ruling, appeal ruling or override, for that
// offering and that exact commit, recorded before the receipt.
function citation(ledger, rc) {
  const e = ledger.filter(x => x.seq < rc.seq && x.offeringId === rc.offeringId && x.sha === rc.sha && (x.kind === 'skip' || AUTHORISES.includes(x.kind) && x.verdict === 'accept')).at(-1);
  return e ? { kind: e.kind === 'skip' ? 'trivial check' : e.kind, seq: e.seq, by: e.actor, offeringId: e.offeringId } : null;
}

export function houseView(w) {
  const g = w.s.governance || {}, ok = villageKey(w), approved = g.approved || {}, deployed = g.deployed || {};
  const ledger = (g.ledger || []).filter(e => !e.redacted && ok(e.key));
  const reverted = new Set(ledger.filter(e => e.kind === 'revert').map(e => e.receiptId));
  const version = HEX.test(w.version || '') ? w.version : null;
  const keys = [...new Set([...Object.keys(approved), ...Object.keys(deployed)])].filter(ok).sort();
  const projects = keys.map(key => {
    const a = approved[key] || null, d = deployed[key] || null;
    const state = !d ? 'undeployed' : !a ? 'unapproved' : a.sha === d.sha ? 'matches' : 'differs';
    const by = a && (a.baseline ? ledger.filter(e => e.kind === 'baseline' && e.key === key && e.sha === a.sha).at(-1) : ledger.filter(e => e.offeringId === a.offeringId && e.sha === a.sha && (e.kind === 'skip' || AUTHORISES.includes(e.kind) && e.verdict === 'accept')).at(-1));
    return { key, approved: a && { sha: a.sha, offeringId: a.offeringId ?? null, baseline: !!a.baseline, at: a.at ?? null, cites: by ? { kind: by.kind === 'skip' ? 'trivial check' : by.kind, seq: by.seq, by: by.actor } : null }, deployed: d && { sha: d.sha, receiptId: d.receiptId ?? null, at: d.at ?? null }, state, running: !!version && (d?.sha === version || a?.sha === version) };
  });
  const offering = id => (w.s.offerings || []).find(o => o.id === id && o.gov && w.temple.villageSafe(o));
  const receipts = ledger.filter(e => e.kind === 'receipt').slice(-12).reverse().map(rc => {
    const cites = citation(ledger, rc), o = offering(rc.offeringId);
    return { id: rc.id, seq: rc.seq, ts: rc.ts, actor: rc.actor, offeringId: rc.offeringId, key: rc.key, sha: rc.sha, how: rc.how, note: clip(rc.note, 300), reverted: reverted.has(rc.id), cites, standing: !!o && ['trivial', 'accepted'].includes(o.gov.state) };
  });
  const notes = ledger.filter(e => NOTE_KINDS.includes(e.kind)).slice(-15).reverse()
    .map(e => ({ seq: e.seq, ts: e.ts, kind: e.kind, what: e.what ?? null, actor: e.actor, offeringId: e.offeringId ?? null, key: e.key, sha: e.sha ?? null, verdict: e.verdict ?? null, final: !!e.final, reason: clip(e.reason, 300) }));
  // The deploy stone: gold when what runs is what the Temple approved, an ember on any gap, unlit when nothing is known.
  const why = [], runKey = version && keys.find(k => deployed[k]?.sha === version);
  if (version && keys.length && !runKey) why.push('The running commit has no deploy receipt.');
  for (const p of projects) if (p.state === 'differs' || p.state === 'unapproved') why.push(`${p.key}: deployed ${p.deployed.sha.slice(0, 7)} is not the approved ${p.approved ? p.approved.sha.slice(0, 7) : 'commit (none)'}.`);
  for (const r of receipts) if (!r.reverted && (!r.cites || !r.standing)) why.push(`Receipt ${r.id} ${!r.cites ? 'cites no ruling or trivial check' : 'cites an approval that no longer stands'}.`);
  const stone = why.length ? 'drift' : runKey || projects.some(p => p.state === 'matches') ? 'ok' : 'unknown';
  return { version, stone, why, projects, receipts, notes, steward: stewardOf(w), commissions: w.sites.commissionsView?.() || [] };
}

// Whether the Steward's session is named, on the map and reachable; nothing at all about it once it is private.
function stewardOf(w) {
  const sh = w.s.stewardHero; if (!sh) return { set: false };
  const h = w.workers.find(x => x.id === sh.workerId), seen = !!h && !!w.nodes?.allowed(h.id);
  return { set: true, workerId: sh.workerId, onMap: seen, title: seen ? h.title : null, status: seen ? h.status : null, stale: seen ? !!h.stale : null, reachable: seen && !!w.steward?.reachable(h.id), down: !!w.watch?.stewardDown };
}
