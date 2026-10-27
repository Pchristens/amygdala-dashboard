// Keeper relay: a node pass marked `keeper` may reach the human dashboard through the Tailscale gate.
// The node's local relay prefixes every path with /keeper; the gate strips it and forwards to the loopback server.
import http from 'node:http';

export const KEEPER_PREFIX = '/keeper';
const HOP = new Set(['authorization', 'host', 'connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'te', 'trailer']);

export function setKeeper(world, id, on) {
  const p = world.s.nodePasses.find(p => p.id === id && !p.revoked);
  if (!p) throw new Error('No such node pass.');
  p.keeper = !!on; world.changed(); return { id, keeper: p.keeper };
}

export function keeperAuth(world, req) {
  const pass = world.nodes.auth(String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
  return pass?.keeper === true ? pass : null;
}

export function relay(req, res, port, path) {
  const headers = Object.fromEntries(Object.entries(req.headers).filter(([k]) => !HOP.has(k)));
  headers.host = `127.0.0.1:${port}`;
  const up = http.request({ host: '127.0.0.1', port, method: req.method, path, headers }, r => {
    res.writeHead(r.statusCode, Object.fromEntries(Object.entries(r.headers).filter(([k]) => !HOP.has(k))));
    r.pipe(res);
  });
  up.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
  res.on('close', () => up.destroy());
  req.pipe(up);
}
