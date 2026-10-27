const OPEN = new Set(['queued', 'working']);
function text(value, name, max) { if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${name} must be nonempty text up to ${max} characters.`); return value.trim(); }
export class Orders {
  constructor(world) { this.world = world; world.s.orders ??= []; for (const o of world.s.orders) if (o.status === 'working') o.status = 'queued'; }
  get(id) { const o = this.world.s.orders.find(o => o.id === id); if (!o) throw new Error('Unknown order.'); return o; }
  eligible(name) { const w = this.world, r = w.s.residents[name]; if (!w.cfg(name) || !r || r.zone !== 'village' || r.isleTagged || r.quarantined || r.sealed) throw new Error('Orders require a village resident.'); if (!r.enabled || w.cfg(name).enabled === false) throw new Error('That resident is disabled.'); if (r.hibernate) throw new Error('That resident is hibernating by the human’s hand.'); }
  create({ to, headline, brief, from = 'human' }) {
    this.eligible(to); if (!['human', 'steward'].includes(from)) throw new Error('from must be human or steward.');
    brief = text(brief, 'brief', 12000); headline = headline == null || headline === '' ? brief.split(/[.!?\n]/)[0].slice(0, 180) : text(headline, 'headline', 180); headline = headline.replace(/[\r\n]+/g, ' ').trim() || brief.slice(0, 180).replace(/[\r\n]+/g, ' ');
    const w = this.world;
    if (w.s.orders.length >= 200) { const i = w.s.orders.findIndex(o => !OPEN.has(o.status)); if (i < 0) throw new Error('Too many open orders.'); w.s.orders.splice(i, 1); }
    const o = { id: w.id('ord'), from, to, headline, brief, status: 'queued', createdAt: Date.now(), answeredAt: null, chat: '', report: '', data: null, error: '', attempts: 0 };
    w.s.orders.push(o);
    for (const old of w.s.orders.slice(0, -50)) if (!OPEN.has(old.status)) { old.brief = ''; old.report = ''; old.data = null; }
    while (w.s.posts.length >= 300) { const i = w.s.posts.findIndex(p => !p.pinned); if (i < 0) break; w.s.posts.splice(i, 1); }
    const post = { id: w.id('p'), author: from === 'human' ? 'You' : 'Steward', authorKind: 'human', zone: 'village', channel: 'commons', text: headline, replyTo: null, ts: Date.now(), orderId: o.id }; o.postId = post.id; w.s.posts.push(post);
    w.addFeed(null, headline, 'village'); w.s.feed.at(-1).orderId = o.id; w.changed(); w.conductor?.tick(); return o;
  }
  list() { return this.world.s.orders.map(({ brief, report, data, attempts, postId, ...o }) => o); }
  pending(name) { return this.world.s.orders.find(o => o.to === name && OPEN.has(o.status)); }
  start(name) { try { this.eligible(name); } catch { return ''; } if (this.world.isHibernating(name)) return ''; const o = this.pending(name); if (!o) return ''; o.status = 'working'; o.attempts++; this.world.changed(); return `\n\n--- PRIVATE ORDER ${o.id} ---\nHeadline: ${o.headline}\nBrief (private; never quote on the board or feed):\n${o.brief}\n--- END PRIVATE ORDER ---\nAnswer with answer_order {id: "${o.id}", chat, report, data?}. chat is your short village reply; report is the full private result (up to 24000 characters). Do not post the report or brief elsewhere.`; }
  finish(name) { const o = this.pending(name); if (!o || o.status !== 'working') return; if (o.attempts < 2) o.status = 'queued'; else { o.status = 'failed'; o.error = 'Resident ended two turns without answering the order.'; o.answeredAt = Date.now(); } this.world.changed(); }
  answer(name, { id, chat, report, data }) {
    const w = this.world, o = this.get(id); this.eligible(name);
    if (w.activeTurn?.resident !== name || o.to !== name || o.status !== 'working' || this.pending(name) !== o) throw new Error('You may answer only your own working order during your turn.');
    chat = text(chat, 'chat', 2400); report = text(report, 'report', 24000);
    if (data !== undefined && (!data || typeof data !== 'object' || Array.isArray(data) || Buffer.byteLength(JSON.stringify(data)) > 16384)) throw new Error('data must be a JSON object up to 16 kB.');
    Object.assign(o, { chat, report, data: data === undefined ? null : JSON.parse(JSON.stringify(data)), status: 'answered', answeredAt: Date.now() });
    while (w.s.posts.length >= 300) { const i = w.s.posts.findIndex(p => !p.pinned); if (i < 0) break; w.s.posts.splice(i, 1); }
    w.s.posts.push({ id: w.id('p'), author: name, authorKind: 'resident', zone: 'village', channel: 'commons', text: chat, replyTo: o.postId, ts: Date.now(), orderId: id }); w.changed(); return 'Order answered.';
  }
  cancel(id) { const o = this.get(id); if (OPEN.has(o.status)) { o.status = 'cancelled'; o.answeredAt = Date.now(); this.world.changed(); } return o; }
  wait(id, timeout = 600, signal) {
    const o = this.get(id); if (!OPEN.has(o.status) || signal?.aborted) return Promise.resolve(o);
    return new Promise(resolve => { let timer; const done = () => { clearTimeout(timer); off(); signal?.removeEventListener('abort', done); resolve(o); }; const off = this.world.onChange(() => { if (!OPEN.has(o.status)) done(); }); timer = setTimeout(done, Math.max(0, Math.min(600, Number(timeout) || 600)) * 1000); signal?.addEventListener('abort', done, { once: true }); });
  }
}
