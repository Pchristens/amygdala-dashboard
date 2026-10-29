import crypto from 'node:crypto';
import { createInterface } from 'node:readline';
import { termSession } from './amygdala-node.mjs';

const safeEqual = (a, b) => { const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || '')); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
async function body(req) {
  if (req.body != null) { const b = typeof req.body === 'string' ? req.body : JSON.stringify(req.body); if (Buffer.byteLength(b) > 256 * 1024) throw Error('body'); return JSON.parse(b || '{}'); }
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 256 * 1024) throw Error('body'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString() || '{}');
}
export class LocalTerms {
  constructor({ ask, sessions, spawn, now = Date.now, schedule = setTimeout }) { this.ask = ask; this.sessions = sessions; this.spawn = spawn; this.now = now; this.schedule = schedule; this.bridges = new Map(); this.pending = new Map(); }
  async handle(req, res, url) {
    let path; try { path = decodeURIComponent(url.pathname); } catch { return false; }
    const m = path.match(/^\/api\/term\/(node:[^/:]+:([^/]+))\/(stream|input|resize|close)$/); if (!m) return false;
    const [, id, sessionId, action] = m; let list;
    // Input, resize and close for a terminal not open here go straight on: only a stream asks agent-deck.
    if (action !== 'stream' && !this.bridges.has(id)) return false;
    try { list = await this.sessions(); } catch { return false; }
    const session = list.find(s => s.id === sessionId && !s.archived && s.tmux_session && !s.remote_name && !s.ssh_host);
    if (!session) return false;
    if (action === 'stream') {
      if (req.method !== 'GET') { json(res, 405, { ok: false, error: 'GET only' }); return true; }
      const token = url.searchParams.get('token') || req.headers['x-amygdala-token'] || req.headers['x-hearthfield-token'] || '';
      let auth; try { auth = await this.ask(`/api/term/${encodeURIComponent(id)}/local`, token); } catch { auth = null; }
      if (!auth?.ok || auth.sessionId !== sessionId) { json(res, 403, { ok: false, error: 'Terminal is private or gone.' }); return true; }
      // The node's own privacy rules (isle group or Isle folder, quarantined, sealed, tmux present), not only the server's.
      try { termSession({ sessionId }, list, [sessionId]); } catch { json(res, 403, { ok: false, error: 'Terminal is private or unavailable.' }); return true; }
      let bridge = this.bridges.get(id);
      if (!bridge) {
        if (this.bridges.size + this.pending.size >= 8) { json(res, 429, { ok: false, error: 'Terminal limit reached (8).' }); return true; }
        if (!this.pending.has(id)) this.pending.set(id, Promise.resolve(this.spawn(session)).then(child => this.start(id, token, child)).finally(() => this.pending.delete(id)));
        try { bridge = await this.pending.get(id); } catch { json(res, 403, { ok: false, error: 'Terminal unavailable.' }); return true; }
      } else if (!safeEqual(bridge.token, token)) { json(res, 403, { ok: false, error: 'Wrong terminal token.' }); return true; }
      if (res.destroyed) return true;
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' }); res.write(': connected\n\n');
      bridge.subscribe(res); const heartbeat = setInterval(() => { if (!res.destroyed && res.writableLength <= 1 << 20) res.write(': heartbeat\n\n'); }, 15000); heartbeat.unref?.(); res.on('close', () => clearInterval(heartbeat)); return true;
    }
    const bridge = this.bridges.get(id); if (!bridge) return false;
    if (req.method !== 'POST') { json(res, 405, { ok: false, error: 'POST only' }); return true; }
    if (!safeEqual(bridge.token, req.headers['x-amygdala-token'] || req.headers['x-hearthfield-token'])) { json(res, 403, { ok: false, error: 'Wrong terminal token.' }); return true; }
    if (action !== 'close' && !(req.headers['content-type'] || '').includes('application/json')) { json(res, 415, { ok: false, error: 'JSON only' }); return true; }
    let b = {}; try { if (action !== 'close') b = await body(req); } catch { json(res, 400, { ok: false, error: 'Invalid terminal request.' }); return true; }
    try {
      if (action === 'input') { if (typeof b.d !== 'string' || b.d.length > 131072 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(b.d)) throw Error(); bridge.write({ t: 'i', d: b.d }); }
      else if (action === 'resize') { if (![b.cols, b.rows].every(n => Number.isInteger(n) && n >= 1 && n <= 1000)) throw Error(); bridge.write({ t: 'r', c: b.cols, r: b.rows }); }
      else bridge.close();
      json(res, 200, { ok: true });
    } catch { json(res, 400, { ok: false, error: 'Invalid terminal request.' }); }
    return true;
  }
  start(id, token, child) {
    const viewers = new Set(); let replay = Buffer.alloc(0), timer = null, checks = 0;
    const send = (res, event, data) => { if (res.destroyed || res.writableLength > 1 << 20) { res.destroy(); return; } res.write(`event: ${event}\ndata: ${data}\n\n`); };
    const bridge = { token, child, closed: false, close: () => { if (bridge.closed) return; bridge.closed = true; clearTimeout(timer); clearInterval(bridge.checkTimer); this.bridges.delete(id); child.stdin.end(); child.kill(); for (const r of viewers) { send(r, 'exit', 'session ended'); r.end(); } viewers.clear(); }, subscribe: r => { if (bridge.closed) { send(r, 'exit', 'session ended'); r.end(); return; } clearTimeout(timer); viewers.add(r); if (replay.length) send(r, 'o', replay.toString('base64')); r.on('close', () => { viewers.delete(r); if (!viewers.size && !bridge.closed) timer = this.schedule(bridge.close, 30000); }); }, write: msg => { if (bridge.closed || !child.stdin.writable || child.stdin.writableLength > 1 << 20) throw Error(); child.stdin.write(JSON.stringify(msg) + '\n'); }, recheck: async () => { try { const a = await this.ask(`/api/term/${encodeURIComponent(id)}/local`, token); if (!a?.ok) return bridge.close(); checks = 0; } catch { if (++checks >= 2) bridge.close(); } } };
    this.bridges.set(id, bridge); bridge.checkTimer = setInterval(() => bridge.recheck(), 2000); bridge.checkTimer.unref?.(); child.on('error', bridge.close); child.on('close', bridge.close); child.stdin.on('error', bridge.close);
    createInterface({ input: child.stdout }).on('line', line => { if (bridge.closed) return; try { const msg = JSON.parse(line); if (msg.t !== 'o' || typeof msg.d !== 'string') return; const data = Buffer.from(msg.d, 'base64'); replay = Buffer.concat([replay, data]).subarray(-65536); for (const r of viewers) send(r, 'o', msg.d); } catch { bridge.close(); } });
    return bridge;
  }
}
