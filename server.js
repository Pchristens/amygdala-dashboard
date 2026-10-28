import { Steward, stewardGet } from './lib/steward.js';
import { Watchtower } from './lib/audit.js';
import { notify, bellBatch } from './lib/notify.js';
// Amygdala server: static front end, world API + SSE, MCP endpoint for residents, conductor, agent-deck sync.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { env } from './lib/bin.js';
import { TermHub } from './lib/term.js';
import { World } from './lib/world.js';
import { createMcpHandler } from './lib/mcp.js';
import { Starwatch } from './lib/starwatch.js';
import { Watch } from './lib/watch.js';
import { Conductor } from './lib/conductor.js';
import { KEEPER_PREFIX, keeperAuth, relay, setKeeper } from './lib/keeper.js';
import { startDeckSync } from './lib/deck.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = +env('PORT') || 8790;
const HOST = '127.0.0.1';
const BASE = `http://${HOST}:${PORT}`;
const DATA = path.join(ROOT, 'data');
const PUBLIC = path.join(ROOT, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

// The page's API key: injected into index.html, required on every /api call, never written to disk.
// Protects against web pages on other origins (CSRF/DNS rebinding), not local processes:
// a local process can fetch the page and read the token.
const API_TOKEN = crypto.randomBytes(24).toString('base64url');
const tokenOk = (req, url) => {
  const got = String(req.headers['x-amygdala-token'] || req.headers['x-hearthfield-token'] || url.searchParams.get('token') || '');
  return got.length === API_TOKEN.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(API_TOKEN));
};

const residents = JSON.parse(fs.readFileSync(path.join(ROOT, 'residents.json'), 'utf8'));
const world = new World(DATA, residents, path.join(ROOT, 'residents.json'));
const termHub = new TermHub(world);
const mcp = createMcpHandler(world);
const conductor = new Conductor(world, { baseUrl: BASE, dataDir: DATA });
world.watchtower = new Watchtower(world, conductor);
world.watch = new Watch(world, conductor, DATA);
world.steward = new Steward(world);
world.starwatch = new Starwatch(world, conductor);
startDeckSync(world);
conductor.lookFor = mcp.lookFor;
conductor.setAgyUrl = url => writeAgyUrl(url || `${BASE}/mcp`);
// Sealing stops any isle turn in progress before the isle's data leaves memory.
(world.lockHooks ??= []).push(reason => { termHub.closeIsle(); for (const t of conductor.running.values()) if (world.zoneOf(t.name) === 'isle') conductor.abort(`the isle was sealed (${reason})`, t); });
process.on('unhandledRejection', e => console.error('unhandled rejection', e));
ensureAgyConfig();

// agy only reads MCP servers from its global config. Between turns the entry points at /mcp, which carries no
// identity and refuses every action; during an Antigravity resident's turn it points at that turn's capability URL.
function writeAgyUrl(url) {
  const file = path.join(os.homedir(), '.gemini/config/mcp_config.json');
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(file, 'utf8').trim() || '{}'); } catch (e) { if (e.code !== 'ENOENT') return console.warn('Not touching unreadable', file); }
  cfg.mcpServers ??= {};
  if (cfg.mcpServers.amygdala?.url === url) return;
  cfg.mcpServers.amygdala = { url };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
}

// Antigravity only reads MCP servers from its global config, so register the shared endpoint there.
// Outside a resident's turn the tools refuse to act, so normal agy sessions are unaffected beyond seeing them listed.
function ensureAgyConfig() {
  if (!residents.some(r => r.agent === 'antigravity' && r.enabled !== false)) return;
  writeAgyUrl(`${BASE}/mcp`);
  // Headless agy auto-denies MCP calls unless settings.json allows them. Adding that rule is left to the user;
  // until it exists, Antigravity residents stay asleep instead of failing every turn.
  let allow = [];
  try { allow = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.gemini/antigravity-cli/settings.json'), 'utf8')).permissions?.allow ?? []; } catch {}
  if (!allow.includes('mcp(amygdala/*)')) {
    for (const r of residents.filter(r => r.agent === 'antigravity' && world.s.residents[r.name].enabled)) world.setEnabled(r.name, false);
    console.warn('Antigravity residents disabled: add "mcp(amygdala/*)" to permissions.allow in ~/.gemini/antigravity-cli/settings.json');
  }
}

// ---------- SSE ----------
const clients = new Set(), bellPages = new Map();
let localBellCursor = world.s.bellSeq || 0;
setInterval(() => {
  for (const [id, at] of bellPages) if (Date.now() - at > 15000) bellPages.delete(id);
  const bells = bellBatch(world.s.bells || [], localBellCursor);
  if (bells.length) { localBellCursor = bells.at(-1).id; world.changed(); }
  if ((process.platform === 'win32' || process.platform === 'darwin') && !bellPages.size && (env('NOTIFY_LOCAL') == null ? process.platform === 'win32' : !['0', 'false', 'off'].includes(env('NOTIFY_LOCAL').toLowerCase()))) for (const bell of bells) void notify(bell);
}, 1000).unref();
let pending = null;
world.onChange(() => {
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    const data = `event: state\ndata: ${JSON.stringify(world.snapshot({ human: true }))}\n\n`;
    for (const res of clients) res.write(data);
  }, 400);
});
setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 20000);
// Phase/day changes are time-driven; push a fresh snapshot every minute.
setInterval(() => world.changed(), 60000);

// ---------- HTTP ----------
function readBody(req, limit = 1 << 20) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

const API = {
  'POST /api/naming/skip': () => { world.s.namingSkipped = true; world.changed(); },
  'POST /api/naming': b => { if (b.all !== true) throw new Error('Expected all: true'); const names = world.config.filter(r => world.s.residents[r.name].enabled).map(r => r.name); world.proclaimNaming(names); for (const name of names) { world.requestNaming(name); conductor.wake(name, 'Your naming ceremony is ready: choose_name when you are ready.'); } },
  'POST /api/human/move': b => world.moveHuman(b.x, b.y),
  'POST /api/human/post': b => world.addPost('You', 'human', b.text, b.channel, b.replyTo || null, b.zone === 'isle' ? 'isle' : 'village'),
  'POST /api/tree/milestone': b => { if (!world.trees.shareMilestone(String(b.project), String(b.host || 'local'), b.note)) throw new Error('That project has already grown as much as it can today.'); },
  'POST /api/seal/setup': b => world.seal.setup(b.passphrase),
  'POST /api/seal/unlock': b => world.seal.unlock(b.passphrase),
  'POST /api/seal/lock': () => world.seal.lock(),
  'POST /api/seal/touch': () => world.seal.touch(),
  'POST /api/temple/offer': b => world.temple.offer(String(b.workerId), b.note),
  'POST /api/temple/command': b => { for (const n of world.temple.command(String(b.offeringId), b.residents === 'all' ? 'all' : [].concat(b.residents || []), b.note)) conductor.wake(n, `the Temple commanded you to review offering ${b.offeringId}`); },
  'POST /api/temple/close': b => world.temple.close(String(b.offeringId)),
  'POST /api/findings/status': b => world.temple.setStatus(String(b.id), b.status),
  'POST /api/temple/decree-mode': b => world.temple.setDecreeMode(String(b.mode)),
  'POST /api/commission': b => world.sites.commission(b),
  'POST /api/workers/site': b => world.sites.assign(String(b.workerId), String(b.site)),
  'POST /api/counsel': b => world.sites.relay(String(b.id), String(b.action)),
  'POST /api/visitors/pass': b => world.visitors.issue(b.name, b.hours, b.label),
  'POST /api/visitors/revoke': b => world.visitors.revoke(String(b.id)),
  'POST /api/tales/complete': b => world.tales.complete(String(b.workerId)),
  // Long-running (waits for the hero's wrap-up): start it and return; progress shows in the feed.
  'POST /api/tales/end': b => { const id = String(b.workerId); if (!world.workers.some(w => w.id === id)) throw new Error('No such hero.'); world.tales.endLabour(id).catch(e => world.addFeed(null, `Ending the labour failed: ${e.message}`)); return { started: true }; },
  'POST /api/nodes/pass': b => world.nodes.issue(b.name, b.hours),
  'POST /api/bells/presence': b => { if (typeof b.id !== 'string' || !/^[a-z0-9-]{1,80}$/i.test(b.id) || typeof b.visible !== 'boolean') throw new Error('Invalid page presence.'); if (b.visible && bellPages.size < 256) bellPages.set(b.id, Date.now()); else bellPages.delete(b.id); },
  'POST /api/nodes/notify': b => world.nodes.setNotify(b.id, b.on),
  'POST /api/nodes/revoke': b => world.nodes.revoke(String(b.id)),
  'POST /api/nodes/keeper': b => setKeeper(world, String(b.id), b.on === true),
  'POST /api/heroes/revive': b => world.sites.heroAction(b.workerId, 'revive'),
  'POST /api/heroes/forget': b => world.sites.heroAction(b.workerId, 'forget'),
  'POST /api/heroes/pass': b => world.bridge.issue(b.name, b.zone, b.hours, b.label),
  'POST /api/heroes/revoke': b => world.bridge.revoke(String(b.id)),
  'POST /api/quarantine': b => world.setQuarantine(String(b.project), String(b.host), !!b.on),
  'POST /api/human/gift': b => world.addObject('You', b.kind, b.note, +b.x, +b.y),
  'POST /api/audit/settings': b => world.watchtower.settings(b),
  'POST /api/control': b => {
    if (typeof b.paused === 'boolean') world.setPaused(b.paused);
    if (b.tickSeconds !== undefined) world.setTick(b.tickSeconds);
    if (b.dailyTurnBudget !== undefined) world.setBudget(b.dailyTurnBudget);
  },
};

const server = http.createServer(async (req, res) => {
  // Only answer to our own origin (guards against DNS rebinding from other sites).
  const host = (req.headers.host || '').toLowerCase();
  // amygdala.localhost is the memorable name; *.localhost always resolves to loopback, so it can't be rebound.
  if (![`127.0.0.1:${PORT}`, `localhost:${PORT}`, `amygdala.localhost:${PORT}`].includes(host)) { res.writeHead(421); return res.end(); }
  try {
    const url = new URL(req.url, BASE);
    const p = decodeURIComponent(url.pathname);
    if (p.startsWith('/visit/')) return visit(req, res, p);
    if (p === '/hero/report') return heroReport(req, res, p);
    if (p === '/mcp' || p.startsWith('/mcp/')) {
      const body = req.method === 'POST' ? await readBody(req) : '';
      const m = p.match(/^\/mcp\/t\/([A-Za-z0-9_-]{20,})$/);
      return mcp(req, res, body, m ? m[1] : null);
    }
    if (p.startsWith('/api/') && !tokenOk(req, url)) return json(res, 401, { ok: false, error: 'missing or wrong page token — reload the page' });
    if (p.startsWith('/api/') && (req.method === 'POST' || req.method === 'GET' && !['/api/state', '/api/events'].includes(p) && !p.endsWith('/wait')) && (!p.startsWith('/api/steward/') || p === '/api/steward/settings') && p !== '/api/bells/presence' && req.headers['x-amygdala-source'] !== 'steward') world.steward.activity();
    if (req.method === 'GET' && ['/api/steward/budget', '/api/steward/wait'].includes(p)) {
      const controller = new AbortController(); res.on('close', () => controller.abort());
      const result = await stewardGet(world.steward, p, url.searchParams, controller.signal);
      return json(res, result.status, result.body);
    }
    const groupRoute = p.match(/^\/api\/orders\/group\/([^/]+)(\/wait)?$/);
    if (groupRoute && req.method === 'GET') {
      const controller = new AbortController(); res.on('close', () => controller.abort());
      return json(res, 200, groupRoute[2] ? await world.orders.waitGroup(groupRoute[1], url.searchParams.get('timeout') ?? 600, controller.signal) : world.orders.group(groupRoute[1]));
    }
    const orderRoute = p.match(/^\/api\/orders\/([^/]+)(\/wait|\/cancel)?$/);
    if (orderRoute && req.method === 'GET' && orderRoute[2] !== '/cancel') {
      const controller = new AbortController(); res.on('close', () => controller.abort());
      const order = orderRoute[2] === '/wait' ? await world.orders.wait(orderRoute[1], url.searchParams.get('timeout') ?? 600, controller.signal) : world.orders.get(orderRoute[1]);
      return json(res, 200, order);
    }
    if (p === '/api/state') return json(res, 200, world.snapshot({ human: true }));
    if (p === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(`event: state\ndata: ${JSON.stringify(world.snapshot({ human: true }))}\n\n`);
      clients.add(res); req.on('close', () => clients.delete(res));
      return;
    }
    const terminal = p.match(/^\/api\/term\/([^/]+)\/(stream|input|resize|close)$/);
    if (terminal && terminal[2] === 'stream') {
      if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'GET only' });
      const bridge = await termHub.open(terminal[1]);
      if (res.destroyed) return;
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(': connected\n\n');
      bridge.subscribe(res);
      const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
      res.on('close', () => clearInterval(heartbeat));
      return;
    }
    const plog = p.match(/^\/api\/places\/([a-z0-9-]+)\/log$/);
    if (plog) return json(res, 200, { ok: true, log: world.placeLog(plog[1]) });
    const trail = p.match(/^\/api\/omens\/([a-z0-9]+)\/trail$/);
    if (trail) return json(res, 200, { ok: true, trail: await world.tablet.trail(trail[1]) });
    if (p.startsWith('/api/')) {
      if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'POST only' });
      if (!(req.headers['content-type'] || '').includes('application/json')) return json(res, 415, { ok: false, error: 'JSON only' });
      const b = JSON.parse((await readBody(req)) || '{}');
      if (p === '/api/steward/settings') return json(res, 200, world.steward.settings(b));
      if (p === '/api/steward/claim') return json(res, 200, world.steward.claim(b));
      if (p === '/api/steward/summary') return json(res, 200, world.steward.summary(b));
      if (p === '/api/orders') return json(res, 200, await world.orders.create(b));
      if (orderRoute?.[2] === '/cancel') return json(res, 200, world.orders.cancel(orderRoute[1]));
      if (terminal) {
        if (terminal[2] === 'close') termHub.close(terminal[1]);
        else if (terminal[2] === 'input') termHub.input(terminal[1], b.d);
        else termHub.resize(terminal[1], b.cols, b.rows);
        return json(res, 200, { ok: true });
      }
      const petition = p.match(/^\/api\/petitions\/([^/]+)\/(allow|deny)$/);
      if (petition) { world.visitors.decide(petition[1], petition[2], b); return json(res, 200, { ok: true }); }
      const m = p.match(/^\/api\/residents\/([^/]+)(\/wake|\/naming|\/hibernate)?$/);
      if (m) {
        const name = m[1];
        if (!world.cfg(name)) return json(res, 404, { ok: false, error: 'unknown resident' });
        if (m[2] === '/hibernate') { if (world.seal.locked && world.zoneOf(name) === 'isle') throw new Error('The isle is sealed.'); world.setHibernate(name, b.on); }
        else if (m[2] === '/naming') { world.requestNaming(name); conductor.wake(name, 'Your naming ceremony is ready: choose_name when you are ready.'); }
        else if (m[2]) { if (world.seal.locked && world.s.residents[name].zone === 'isle') throw new Error('The isle is sealed. Unlock it first.'); conductor.wake(name, b.reason ? `the human: ${String(b.reason).slice(0, 200)}` : undefined); }
        else {
          if (typeof b.enabled === 'boolean') world.setEnabled(name, b.enabled);
          if (b.zone) world.setResidentZone(name, b.zone);
        }
        return json(res, 200, { ok: true });
      }
      const fn = API[`POST ${p}`];
      if (!fn) return json(res, 404, { ok: false, error: 'not found' });
      const result = await fn(b);
      return json(res, 200, { ok: true, ...(result && typeof result === 'object' && result.token ? result : {}) });
    }
    // static
    const file = path.join(PUBLIC, p === '/' ? 'index.html' : p);
    if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    const headers = { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' };
    if (path.extname(file) === '.html') {
      res.writeHead(200, { ...headers, 'Referrer-Policy': 'no-referrer' });
      return res.end(fs.readFileSync(file, 'utf8').replace('</head>', `<meta name="hf-token" content="${API_TOKEN}">\n</head>`));
    }
    res.writeHead(200, headers);
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    if (!res.headersSent) json(res, 400, { ok: false, error: e.message }); else res.end();
  }
});

server.listen(PORT, HOST, () => console.log(`Amygdala is live at ${BASE}`));

// ---------- the visitor gate ----------
// /visit/mcp (MCP; pass via "Authorization: Bearer <pass>" or /visit/mcp/<pass>) and /visit/api/<tool> (REST, Bearer).
// Every knock at the gate is logged (allowed or refused), with source address and the pass name if valid.
const GATE_LOG = path.join(DATA, 'logs', 'gate.log');
function gateLog(req, p, outcome, who) {
  const line = `${new Date().toISOString()} ${req.socket.remoteAddress} ${req.method} ${p.replace(/hfv_[A-Za-z0-9_-]+/, 'hfv_…')} ${outcome}${who ? ' ' + who : ''} ua="${String(req.headers['user-agent'] || '').slice(0, 80)}"\n`;
  fs.appendFile(GATE_LOG, line, () => {});
}
async function visit(req, res, p) {
  const end = res.end.bind(res);
  const bearerName = () => world.visitors.auth(String(req.headers.authorization || '').replace(/^Bearer\s+/i, '') || (p.match(/hfv_[A-Za-z0-9_-]+/) || [])[0])?.name;
  res.end = (...a) => { gateLog(req, p, res.statusCode, bearerName()); return end(...a); };
  if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }); return res.end(); }
  const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  let body; try { body = JSON.parse((await readBody(req, 64 << 10)) || '{}'); } catch { return json(res, 400, { ok: false, error: 'bad JSON' }); }
  const m = p.match(/^\/visit\/mcp(?:\/(hfv_[A-Za-z0-9_-]+))?$/);
  if (m) {
    const out = await world.visitors.mcpWait(m[1] || bearer, body);
    if (!out || (Array.isArray(out) && !out.length)) { res.writeHead(202); return res.end(); }
    return json(res, 200, out);
  }
  const a = p.match(/^\/visit\/api\/([a-z_]+)$/);
  if (!a) return json(res, 404, { ok: false, error: 'not found' });
  const pass = world.visitors.auth(bearer);
  if (!pass) return json(res, 401, { ok: false, error: 'invite pass missing, expired or revoked' });
  try { return json(res, 200, { ok: true, result: await world.visitors.waitTriage(world.visitors.call(pass, a[1], body)) }); }
  catch (e) { return json(res, 400, { ok: false, error: e.message }); }
}

// Heroes without agent-deck (e.g. native Windows) report their status here with a hero pass (hfh_…).
async function heroReport(req, res, p) {
  const pass = world.bridge.auth(String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
  gateLog(req, p, pass ? 'hero' : 401, pass?.name);
  if (req.method !== 'POST') { res.writeHead(405); return res.end(); }
  if (!pass) return json(res, 401, { ok: false, error: 'hero pass missing, expired or revoked' });
  let body; try { body = JSON.parse((await readBody(req, 16 << 10)) || '{}'); } catch { return json(res, 400, { ok: false, error: 'bad JSON' }); }
  const counsel = world.bridge.report(pass, body, req.socket.remoteAddress);
  return json(res, 200, { ok: true, zone: pass.zone, ...(counsel.length && { counsel }) });
}

const nodeRates = new Map();
async function nodeReport(req, res) {
  const key = req.socket.remoteAddress, now = Date.now();
  for (const [k, v] of nodeRates) if (now - v.at > 60000) nodeRates.delete(k);
  const rate = nodeRates.get(key) || { at: now, count: 0 }; nodeRates.set(key, rate);
  if (++rate.count > 120 || nodeRates.size > 4096) return json(res, 429, { ok: false, error: 'Too many node reports.' });
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'POST only' });
  const pass = world.nodes.auth(String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
  if (!pass) return json(res, 401, { ok: false, error: 'Invalid node pass.' });
  if (!(req.headers['content-type'] || '').includes('application/json')) return json(res, 415, { ok: false, error: 'JSON only' });
  return json(res, 200, { ok: true, ...world.nodes.report(pass, JSON.parse(await readBody(req, 2 << 20))) });
}

// A second door on this Mac's Tailscale address only: visitor routes, nothing else (not the LAN, not the internet).
const tsAddr = Object.values(os.networkInterfaces()).flat().find(i => i?.family === 'IPv4' && /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(i.address))?.address;
const GATE_PORT = +env('GATE_PORT') || 8795;
const gateEnabled = env('GATE') === '1' && !env('NO_GATE') && !!tsAddr;
world.gateUrl = gateEnabled ? `http://${tsAddr}:${GATE_PORT}` : null;   // shown to the human when issuing passes
if (gateEnabled) {
  http.createServer(async (req, res) => {
    try {
      const p = decodeURIComponent(new URL(req.url, 'http://gate').pathname);
      // A keeper pass reaches the dashboard itself (its relay prefixes paths); any other caller gets nothing here.
      if (req.url === KEEPER_PREFIX || req.url.startsWith(KEEPER_PREFIX + '/') || req.url.startsWith(KEEPER_PREFIX + '?')) { if (!keeperAuth(world, req)) return json(res, 401, { ok: false, error: 'Invalid keeper pass.' }); const rest = req.url.slice(KEEPER_PREFIX.length); return relay(req, res, PORT, rest.startsWith('/') ? rest : '/' + rest); }
      if (p === '/node/term') {
        const pass = world.nodes.auth(String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
        if (!pass) return json(res, 401, { ok: false, error: 'Invalid node pass.' });
        if (req.method !== 'POST' || !(req.headers['content-type'] || '').includes('application/json')) return json(res, 405, { ok: false });
        return json(res, 200, world.nodes.termPoll(pass, JSON.parse(await readBody(req, 256 << 10))));
      }
      if (p === '/node/report') return await nodeReport(req, res);
      if (p === '/hero/report') return await heroReport(req, res, p);
      if (!p.startsWith('/visit/')) { gateLog(req, p, 404); res.writeHead(404); return res.end(); }
      await visit(req, res, p);
    } catch (e) { if (!res.headersSent) json(res, 400, { ok: false, error: e.message }); }
  }).listen(GATE_PORT, tsAddr, () => console.log(`Visitor gate open on Tailscale at http://${tsAddr}:${GATE_PORT}/visit/mcp`));
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { world.save(); process.exit(0); });
