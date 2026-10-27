// The collective tree: one per zone (a cherry on The Green, a salt pine on the isle).
// Growth comes only from verified accomplishments recorded in a durable credit ledger; blossoms are temporary
// echoes of recent credits. Posts, movement, tool calls and tending never earn growth. Nothing crosses zones.

const DAY = 86400000;
const STAGES = [[0, 'sapling'], [12, 'young tree'], [30, 'spreading canopy'], [60, 'mature tree'], [120, 'ancient tree']];
const PROJECT_DAILY_CAP = 6, BLOSSOMS_PER_CREDIT = 3, BLOOM_MS = 3 * DAY, EXHIBIT_USE_CAP = 2, RENAME_COOLDOWN = DAY;

export const TREES = {
  village: { name: 'The Almond', species: 'almond', x: 440, y: 420, placeId: 'green' },
  isle: { name: 'The Salt Pine', species: 'salt pine', x: 1400, y: 360, placeId: 'tide-hall' },
};
const clip = (s, n) => String(s ?? '').slice(0, n);

export class Trees {
  constructor(world) {
    this.w = world;
    this.ensure();
  }
  ensure() {
    const s = this.w.s;
    s.trees ??= {};
    for (const zone of Object.keys(TREES)) if (!(zone === 'isle' && this.w.seal?.locked)) s.trees[zone] ??= { ledger: [], branches: {}, keepsakes: [], tended: {} };
  }
  t(zone) { return this.w.s.trees[zone ?? 'village']; }

  // ---- awarding ----
  award(zone, branchId, branchLabel, contributors, sourceEventId, amount, reason) {
    const t = this.t(zone);
    if (t.ledger.some(e => e.sourceEventId === sourceEventId)) return 0;          // dedupe
    const today = t.ledger.filter(e => e.branchId === branchId && Date.now() - e.awardedAt < DAY).reduce((a, e) => a + e.amount, 0);
    amount = Math.min(amount, PROJECT_DAILY_CAP - today);
    if (amount <= 0) return 0;
    const b = t.branches[branchId] ??= { id: branchId, name: clip(branchLabel, 60), contributors: [], createdAt: Date.now(), renamedAt: 0 };
    for (const c of contributors) if (c && !b.contributors.includes(c)) b.contributors.push(c);
    t.ledger.push({ sourceEventId, branchId, amount, reason: clip(reason, 160), awardedAt: Date.now() });
    const tree = TREES[zone];
    this.w.addFeed(null, `${tree.name} grew: ${clip(reason, 120)} (+${amount})`, zone);
    return amount;
  }

  // Called when a commitment is marked done (it already has at least one artifact).
  onCommitmentDone(c) {
    const branch = `c:${c.id}`;
    const contributors = [c.ownerId, ...(c.contributors || [])];
    this.award(c.zone, branch, c.objective, contributors, `done:${c.id}`, 3, `${c.ownerId} finished “${clip(c.objective, 70)}”`);
    const others = [...new Set((c.contributors || []).filter(n => n !== c.ownerId))];
    if (others.length) this.award(c.zone, branch, c.objective, contributors, `collab:${c.id}`, 2, `${[c.ownerId, ...others].join(' & ')} made it together`);
    for (const id of c.artifactIds || []) {
      const e = this.w.s.exhibits.find(x => x.id === id);
      if (!e || e.author === c.ownerId || (e.zone ?? 'village') !== c.zone) continue;
      const uses = this.t(c.zone).ledger.filter(x => x.sourceEventId.startsWith(`use:${e.id}:`)).length;
      if (uses < EXHIBIT_USE_CAP) this.award(c.zone, `e:${e.id}`, e.title, [e.author], `use:${e.id}:${c.id}`, 1, `${c.ownerId} built on ${e.author}'s “${clip(e.title, 50)}”`);
    }
  }

  // Quarantine moves a project's branch (with its ledger) to the isle tree.
  moveBranch(branchId, from, to) {
    const a = this.t(from), b = this.t(to);
    if (!a || !b || !a.branches[branchId]) return;
    b.branches[branchId] = a.branches[branchId]; delete a.branches[branchId];
    b.ledger.push(...a.ledger.filter(e => e.branchId === branchId)); a.ledger = a.ledger.filter(e => e.branchId !== branchId);
    b.keepsakes.push(...a.keepsakes.filter(k => k.branchId === branchId)); a.keepsakes = a.keepsakes.filter(k => k.branchId !== branchId);
  }

  // The human deliberately shares a milestone from a real coding project.
  shareMilestone(project, host, note) {
    const key = `${project}@${host}`;
    // While sealed the quarantine list is only known as hashes; a quarantined project must not leak into the village.
    if (this.w.seal?.locked && (this.w.s.quarantineHashes || []).includes(this.w.seal.hashProject(key))) throw new Error('That project lives on the sealed isle. Unlock it first.');
    const w = this.w.workers.find(x => x.project === project && x.host === host && !x.sealed);
    const zone = w?.zone ?? (this.w.s.quarantine.includes(key) ? 'isle' : 'village');
    const n = this.t(zone).ledger.filter(e => e.branchId === `p:${project}@${host}`).length;
    return this.award(zone, `p:${project}@${host}`, `${project}${host !== 'local' ? ' (' + host + ')' : ''}`, ['You'],
      `milestone:${project}@${host}:${n}:${Date.now()}`, 3, `the human shipped something in ${project}${note ? ': ' + clip(note, 80) : ''}`);
  }

  // ---- resident interactions (no growth credit) ----
  tend(name) {
    const zone = this.w.zoneOf(name), t = this.t(zone), day = new Date().toDateString();
    if (t.tended[name] === day) throw new Error('You already tended the tree today.');
    t.tended[name] = day;
    this.w.addFeed(name, `${name} tended ${TREES[zone].name}`);
    return `You tend ${TREES[zone].name}. It is a ${this.view(zone).stageName}${this.view(zone).blossoms ? `, with ${this.view(zone).blossoms} blossoms open` : ''}. (Tending is for its own sake; the tree grows from finished work.)`;
  }
  hangKeepsake(name, branchId, artifactId, note) {
    const zone = this.w.zoneOf(name), t = this.t(zone);
    const b = t.branches[branchId];
    if (!b) throw new Error('No such branch. inspect_tree lists them.');
    if (!b.contributors.includes(name)) throw new Error('Only people who grew that branch can hang a keepsake on it.');
    if (t.keepsakes.some(k => k.branchId === branchId)) throw new Error('That branch already carries a keepsake.');
    const exists = ['exhibits', 'objects', 'posts'].some(k => this.w.s[k].some(x => x.id === artifactId && (x.zone ?? 'village') === zone))
      || this.w.s.built.some(x => x.id === artifactId && (x.zone ?? 'village') === zone);
    if (!exists) throw new Error('artifact_id must be a real exhibit, object, post or building here.');
    t.keepsakes.push({ branchId, artifactId, by: name, note: clip(note, 160), ts: Date.now() });
    this.w.addFeed(name, `${name} hung a keepsake on ${TREES[zone].name}: “${clip(note, 70)}”`);
    return 'Keepsake hung.';
  }
  nameBranch(name, branchId, newName) {
    const zone = this.w.zoneOf(name), b = this.t(zone).branches[branchId];
    if (!b) throw new Error('No such branch.');
    if (!b.contributors.includes(name)) throw new Error('Only its contributors can name a branch.');
    if (Date.now() - b.renamedAt < RENAME_COOLDOWN) throw new Error('That branch was named recently; let it settle.');
    b.name = clip(newName, 60).trim() || b.name; b.renamedAt = Date.now();
    this.w.addFeed(name, `${name} named a branch of ${TREES[zone].name} “${b.name}”`);
    return `The branch is now called “${b.name}”.`;
  }

  // ---- derived view ----
  view(zone) {
    if (zone === 'isle' && this.w.seal?.locked)
      return { zone, ...TREES[zone], sealed: true, lifetimeCredits: null, stage: null, stageName: 'sealed', nextStageAt: null, blossoms: 0, blooms: [], branches: [], recent: [], tendedToday: [] };
    const t = this.t(zone), now = Date.now();
    const lifetime = t.ledger.reduce((a, e) => a + e.amount, 0);
    let stage = 0; STAGES.forEach(([min], i) => { if (lifetime >= min) stage = i; });
    const blooms = t.ledger.filter(e => now - e.awardedAt < BLOOM_MS)
      .map(e => ({ branchId: e.branchId, count: e.amount * BLOSSOMS_PER_CREDIT, opensAt: e.awardedAt, fallsAt: e.awardedAt + BLOOM_MS }));
    const branches = Object.values(t.branches).map(b => {
      const credits = t.ledger.filter(e => e.branchId === b.id).reduce((a, e) => a + e.amount, 0);
      return { id: b.id, name: b.name, contributors: b.contributors, credits, fruit: credits >= 5, createdAt: b.createdAt,
        keepsake: t.keepsakes.find(k => k.branchId === b.id) || null };
    }).sort((a, b) => a.createdAt - b.createdAt);
    return { zone, ...TREES[zone], lifetimeCredits: lifetime, stage, stageName: STAGES[stage][1],
      nextStageAt: STAGES[stage + 1]?.[0] ?? null, blossoms: blooms.reduce((a, b) => a + b.count, 0), blooms, branches,
      recent: t.ledger.slice(-8).reverse(), tendedToday: Object.entries(t.tended).filter(([, d]) => d === new Date().toDateString()).map(([n]) => n) };
  }
}
