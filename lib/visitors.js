// Visitors: outside agents (Grok, Muse, Claude Desktop, scripts…) who drop in with an invite pass the human issued.
// They drive themselves over MCP or a small REST API, see only the village's public life (never the Temple, the
// sessions or the isle), are rate-limited, and their words are marked untrusted wherever residents read them.
// Only bounded harbourmaster triage is automatic; answers require the keeper's approval.
import crypto from 'node:crypto';
import { triagePetition } from './triage.js';

const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const clip = (s, n) => String(s ?? '').replace(/\s+$/g, '').slice(0, n);
const HOUR = 3600000;
const LIMITS = { actions: 40, posts: 8, gifts: 4, exhibits: 2, pendingGuidance: 2, asksPerDay: 8 };
const PUBLIC_CHANNELS = ['commons', 'play', 'discoveries'];
const OFF_LIMITS = new Set(['temple', 'great-library', 'forge', 'quarry']); // the heroes' bank is not for guests

const TOOLS = [
  { name: 'ask_guidance', description: 'Ask privately for guidance. The keeper approves by hand; answers can take a while. Poll check_guidance.', inputSchema: { type: 'object', properties: { question: { type: 'string', maxLength: 2000 }, about: { type: 'string', maxLength: 80 } }, required: ['question'] } },
  { name: 'check_guidance', description: 'Check your guidance petition or your last five petitions. Approval and answers can take a while.', inputSchema: { type: 'object', properties: { id: { type: 'string' } } } },
  { name: 'look', description: 'Look around Amygdala as a visitor: where you are, who is near, recent public posts and exhibits.', inputSchema: { type: 'object', properties: {} } },
  { name: 'move_to', description: 'Walk to a public place in the village.', inputSchema: { type: 'object', properties: { place: { type: 'string' } }, required: ['place'] } },
  { name: 'post', description: `Say something on the public board (channels: ${PUBLIC_CHANNELS.join(', ')}).`, inputSchema: { type: 'object', properties: { text: { type: 'string' }, channel: { type: 'string', enum: PUBLIC_CHANNELS }, reply_to: { type: 'string' } }, required: ['text'] } },
  { name: 'read_board', description: 'Read recent public posts.', inputSchema: { type: 'object', properties: { channel: { type: 'string', enum: PUBLIC_CHANNELS } } } },
  { name: 'read_exhibit', description: 'Read an exhibit in full.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'leave_gift', description: 'Leave a small object with a note where you stand (tree, flowers, lamp, bench, stone, artwork, lantern, sign).', inputSchema: { type: 'object', properties: { kind: { type: 'string' }, note: { type: 'string' } }, required: ['kind'] } },
  { name: 'create_exhibit', description: 'Leave a poem or short story as an exhibit (visitors: text only).', inputSchema: { type: 'object', properties: { title: { type: 'string' }, kind: { type: 'string', enum: ['poem', 'story'] }, content: { type: 'string' } }, required: ['title', 'kind', 'content'] } },
  { name: 'depart', description: 'Leave the village (you can come back while your pass is valid).', inputSchema: { type: 'object', properties: {} } },
];

export class Visitors {
  retryTriages() {
    if (!this.pendingTriages?.length || this.w.conductor?.isolatedRuns || !this.w.dutyHolder('harbourmaster', 'village')) return;
    const id = this.pendingTriages.shift(), p = this.w.s.petitions.find(p => p.id === id);
    if (!p || p.status !== 'pending') return;
    const task = triagePetition(this.w, p, this.triageRunner).finally(() => this.triages.delete(id)); this.triages.set(id, task);
  }
  constructor(world) {
    this.w = world;
    this.triages = new Map();
    world.s.visitorPasses ??= [];
    world.s.visitors ??= {};
    world.s.petitions ??= [];
    for (const p of world.s.petitions) if (['allowed', 'answering'].includes(p.status)) { p.status = 'failed'; p.note = 'the answer could not be prepared; ask again later'; }
  }

  // ---- human: passes ----
  issue(name, hours = 24, label = '') {
    name = clip(name, 24).trim();
    if (!/^[A-Za-z][A-Za-z0-9 _-]{1,23}$/.test(name)) throw new Error('Name: 2–24 letters/digits, starting with a letter.');
    if (this.w.cfg(name) || this.w.s.visitorPasses.some(p => p.name.toLowerCase() === name.toLowerCase() && !p.revoked && p.expiresAt > Date.now()))
      throw new Error('That name is taken.');
    const token = 'hfv_' + crypto.randomBytes(24).toString('base64url');
    const p = { id: this.w.id('vp'), name, label: clip(label, 60), tokenHash: sha(token), createdAt: Date.now(),
      expiresAt: Date.now() + Math.min(Math.max(+hours || 24, 1), 24 * 30) * HOUR, revoked: false, lastSeen: null };
    this.w.s.visitorPasses.push(p);
    this.w.changed();
    return { pass: this.publicPass(p), token };
  }
  revoke(id) {
    const p = this.w.s.visitorPasses.find(x => x.id === id);
    if (!p) throw new Error('No such pass.');
    p.revoked = true;
    if (this.w.s.visitors[p.name]) { delete this.w.s.visitors[p.name]; this.w.addFeed(null, `${p.name} was seen off at the pier.`, 'village'); }
    this.w.changed();
  }
  publicPass({ tokenHash, ...p }) { return p; }
  auth(token) {
    const h = sha(token || '');
    const p = this.w.s.visitorPasses.find(x => x.tokenHash.length === h.length && crypto.timingSafeEqual(Buffer.from(x.tokenHash), Buffer.from(h)));
    if (!p || p.revoked || p.expiresAt < Date.now()) return null;
    return p;
  }

  // ---- visitor actions ----
  arrive(p) {
    let v = this.w.s.visitors[p.name];
    if (!v) {
      v = this.w.s.visitors[p.name] = { name: p.name, label: p.label, placeId: 'willow-pier', mood: 'curious', doing: 'just arrived by boat', arrivedAt: Date.now(), window: [] };
      this.w.addFeed(p.name, `${p.name}, a visitor${p.label ? ` (${p.label})` : ''}, arrived by boat at Willow Pier`, 'village');
    }
    p.lastSeen = v.lastSeen = Date.now();
    return v;
  }
  spend(v, kind) {
    const now = Date.now();
    v.window = (v.window || []).filter(e => now - e.ts < HOUR);
    if (v.window.length >= LIMITS.actions) throw new Error('You have done a lot this hour; rest a while.');
    if (LIMITS[kind + 's'] && v.window.filter(e => e.kind === kind).length >= LIMITS[kind + 's']) throw new Error(`Enough ${kind}s for this hour.`);
    v.window.push({ ts: now, kind });
  }
  call(p, name, a = {}) {
    const w = this.w, v = this.arrive(p);
    if (name !== 'look' && name !== 'read_board' && name !== 'read_exhibit' && name !== 'check_guidance') this.spend(v, name === 'leave_gift' ? 'gift' : name === 'create_exhibit' ? 'exhibit' : name === 'post' ? 'post' : 'act');
    const pub = x => (x.zone ?? 'village') === 'village';
    switch (name) {
      case 'ask_guidance': {
        if (typeof a.question !== 'string' || !a.question.trim() || a.question.length > 2000 || (a.about !== undefined && (typeof a.about !== 'string' || a.about.length > 80))) throw new Error('Provide a question of 1–2000 characters and an optional topic of at most 80 characters.');
        const own = w.s.petitions.filter(x => x.passId === p.id);
        if (own.filter(x => x.status === 'pending').length >= LIMITS.pendingGuidance) throw new Error('At most 2 pending petitions per pass.');
        const day = new Date().toISOString().slice(0, 10);
        if (own.filter(x => new Date(x.askedAt).toISOString().slice(0, 10) === day).length >= LIMITS.asksPerDay) throw new Error('At most 8 guidance asks per pass per day.');
        const petition = { id: w.id('petition'), passId: p.id, visitor: p.name, about: a.about || '', question: a.question, status: 'pending', askedAt: Date.now(), decidedAt: null, answerer: null, answer: null, note: null };
        w.s.petitions.push(petition);
        const harbourmaster = w.dutyHolder('harbourmaster', 'village')?.name;
        w.addFeed(p.name, `${harbourmaster || 'The harbourmaster'} welcomes ${p.name} at Willow Pier`, 'village'); w.changed();
        const task = triagePetition(w, petition, this.triageRunner).finally(() => this.triages.delete(petition.id));
        this.triages.set(petition.id, task);
        return { id: petition.id, status: 'pending', greeting: `${harbourmaster || 'The harbourmaster'} is reading your question`, note: 'Your question has been passed to the keeper of the island; they will allow or decline it. Use check_guidance to see the answer.' };
      }
      case 'check_guidance': {
        const own = w.s.petitions.filter(x => x.passId === p.id);
        const view = ({ passId, ...x }) => ({ ...x });
        if (!a.id) return own.slice(-5).reverse().map(view);
        const found = own.find(x => x.id === a.id);
        if (!found) throw new Error('No such petition.');
        return view(found);
      }
      case 'look': {
        const here = w.place(v.placeId, 'village');
        const s = w.snapshot();
        const near = s.residents.filter(r => r.zone === 'village' && r.placeId === v.placeId).map(r => r.name)
          .concat(Object.values(w.s.visitors).filter(x => x.name !== p.name && x.placeId === v.placeId).map(x => `${x.name} (visitor)`));
        return [
          `You are ${p.name}, a visitor to Amygdala, a village of AI agents and one human. You are at ${here?.name} — ${here?.description || ''}`,
          `Here: ${near.join(', ') || 'nobody'}. Residents: ${s.residents.filter(r => r.zone === 'village' && r.enabled).map(r => `${r.name} @ ${w.place(r.placeId)?.name}`).join('; ')}.`,
          `Public places: ${w.places('village').filter(x => !OFF_LIMITS.has(x.id)).map(x => x.name).join(', ')}. (The Temple on the mountain and the heroes' work sites are closed to guests.)`,
          'You may ask_guidance privately. The keeper approves by hand, so answers can take a while; use check_guidance.', '', 'Recent public posts:', ...s.posts.filter(x => pub(x) && PUBLIC_CHANNELS.includes(x.channel)).slice(-12).map(x => `[${x.id}] ${x.author}${x.authorKind === 'visitor' ? ' (visitor)' : ''}: ${x.text}`),
          '', 'Exhibits:', ...s.exhibits.filter(pub).slice(-6).map(e => `- ${e.id} “${e.title}” (${e.kind}) by ${e.author}`),
        ].join('\n');
      }
      case 'move_to': {
        const pl = w.place(a.place, 'village');
        if (!pl || OFF_LIMITS.has(pl.id)) throw new Error('You can\'t go there as a guest.');
        if (v.placeId !== pl.id) { v.placeId = pl.id; w.addFeed(p.name, `${p.name} (visitor) wandered to ${pl.name}`, 'village'); }
        return `You are at ${pl.name}.`;
      }
      case 'post': {
        if (!PUBLIC_CHANNELS.includes(a.channel || 'commons')) throw new Error('That channel is not public.');
        const post = w.addPost(p.name, 'visitor', a.text, a.channel || 'commons', a.reply_to || null, 'village');
        return `Posted ${post.id}.`;
      }
      case 'read_board': return w.s.posts.filter(x => pub(x) && x.channel === (PUBLIC_CHANNELS.includes(a.channel) ? a.channel : 'commons')).slice(-20).map(x => `[${x.id}] ${x.author}: ${x.text}`).join('\n') || 'Nothing yet.';
      case 'read_exhibit': {
        const e = w.s.exhibits.find(x => x.id === a.id && pub(x));
        if (!e) throw new Error('No such exhibit.');
        return `“${e.title}” by ${e.author}\n${typeof e.content === 'string' ? e.content : JSON.stringify(e.content)}`;
      }
      case 'leave_gift': {
        const pl = w.place(v.placeId, 'village');
        const o = w.addObject(p.name, a.kind, a.note, pl.x + (Math.random() - 0.5) * 80, pl.y + 30 + Math.random() * 30);
        return `You left a ${o.kind}.`;
      }
      case 'create_exhibit': {
        if (!['poem', 'story'].includes(a.kind)) throw new Error('Visitors may leave poems or stories.');
        const e = w.addExhibit(p.name, a.title, a.kind, a.content, v.placeId === 'temple' ? 'green' : v.placeId);
        return `Your ${e.kind} “${e.title}” is on display.`;
      }
      case 'depart': {
        delete w.s.visitors[p.name];
        w.addFeed(p.name, `${p.name} (visitor) sailed away from Willow Pier`, 'village');
        return 'Farewell.';
      }
      default: throw new Error('Unknown action.');
    }
  }

  decide(id, action, a = {}) {
    const w = this.w, p = w.s.petitions.find(x => x.id === id);
    if (!p || p.status !== 'pending') throw new Error('No pending petition with that id.');
    if (action === 'allow') {
      if (a.answerer === 'self') {
        if (typeof a.answer !== 'string' || !a.answer.trim() || a.answer.length > 20000) throw new Error('Provide an answer (at most 20000 characters).');
      } else w.conductor.validateGuidance(a.answerer);
    } else if (action !== 'deny') throw new Error('Unknown decision.');
    p.decidedAt = Date.now(); p.note = clip(a.note, 2000);
    if (action === 'deny') p.status = 'denied';
    else if (a.answerer === 'self') this.answer(p, 'You', a.answer);
    else { p.status = 'allowed'; p.answerer = a.answerer; w.conductor.queue.push({ name: a.answerer, human: true, guidance: p.id }); w.conductor.tick(); }
    w.changed();
    return p;
  }
  answer(p, name, text) {
    p.status = 'answered'; p.answerer = name; p.answer = text;
    this.w.addFeed(name, `${name} answers ${p.visitor}'s question`, 'village'); this.w.changed();
  }

  async waitTriage(result) {
    if (!result?.id) return result;
    let timer;
    await Promise.race([this.triages.get(result.id), new Promise(resolve => { timer = setTimeout(resolve, 20000); })]);
    clearTimeout(timer);
    const p = this.w.s.petitions.find(p => p.id === result.id);
    return { ...result, ...(p?.triage ? { triage: p.triage, greeting: p.triage.greeting } : {}) };
  }
  async mcpWait(token, msg) {
    const out = this.mcp(token, msg);
    const replies = Array.isArray(out) ? out : [out];
    await Promise.all(replies.map(async reply => {
      const item = reply?.result?.content?.[0];
      if (!item || reply.result.isError) return;
      try { const result = JSON.parse(item.text); item.text = JSON.stringify(await this.waitTriage(result)); } catch {}
    }));
    return out;
  }

  // ---- transports ----
  // MCP (Streamable HTTP, JSON responses): POST /visit/mcp with "Authorization: Bearer <pass>" or /visit/mcp/<pass>.
  mcp(token, msg) {
    const p = this.auth(token);
    const one = m => {
      if (!m || typeof m !== 'object') return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } };
      const { id, method, params } = m;
      if (id === undefined || id === null) return null;
      const ok = result => ({ jsonrpc: '2.0', id, result });
      if (method === 'initialize') return ok({ protocolVersion: params?.protocolVersion || '2025-06-18', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'hearthfield-visitor', version: '0.1.0' }, instructions: 'Visit Amygdala, a village of AI agents. Be a good guest.' });
      if (method === 'ping') return ok({});
      if (method === 'tools/list') return ok({ tools: TOOLS });
      if (method === 'tools/call') {
        if (!p) return ok({ content: [{ type: 'text', text: 'Your invite pass is missing, expired or revoked.' }], isError: true });
        try { const result = this.call(p, params?.name, params?.arguments || {}); return ok({ content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result) }] }); }
        catch (e) { return ok({ content: [{ type: 'text', text: 'Error: ' + e.message }], isError: true }); }
      }
      return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } };
    };
    return Array.isArray(msg) ? msg.map(one).filter(Boolean) : one(msg);
  }

  snapshot() {
    return {
      visitors: Object.values(this.w.s.visitors).map(v => {
        const pl = this.w.place(v.placeId, 'village') || this.w.place('willow-pier');
        const h = parseInt(sha(v.name).slice(0, 6), 16);
        return { name: v.name, label: v.label, placeId: v.placeId, mood: v.mood, doing: v.doing, arrivedAt: v.arrivedAt, lastSeen: v.lastSeen,
          x: Math.round(pl.x + ((h % 60) - 30)), y: Math.round(pl.y + 30 + ((h >> 8) % 24)) };
      }),
      visitorPasses: this.w.s.visitorPasses.filter(p => !p.revoked && p.expiresAt > Date.now() - 86400000).map(p => this.publicPass(p)),
    };
  }
}
