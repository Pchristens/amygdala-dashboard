// Local keeper relay: serves the remote village's dashboard at http://127.0.0.1:<port> on this machine.
// Every request goes to the server's Tailscale gate under /keeper with this node's pass; the pass must be marked keeper.
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOP = new Set(['authorization', 'host', 'connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'te', 'trailer']);
export function parseArgs(args) {
  const o = { '--port': '8790' };
  for (let i = 0; i < args.length; i += 2) { if (!['--server', '--pass-file', '--port'].includes(args[i]) || !args[i + 1]) throw new Error('Usage: --server URL --pass-file FILE [--port 8790]'); o[args[i]] = args[i + 1]; }
  const server = new URL(o['--server'] || process.env.AMYGDALA_SERVER), port = +o['--port'];
  if (!['http:', 'https:'].includes(server.protocol) || server.username || server.password || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid keeper configuration.');
  return { server, port, passFile: o['--pass-file'] };
}
export function forwardHeaders(headers, token, port) {
  // The dashboard checks Host against its own loopback origin, so keep the local origin the page was loaded from.
  return { ...Object.fromEntries(Object.entries(headers).filter(([k]) => !HOP.has(k))), host: `127.0.0.1:${port}`, authorization: `Bearer ${token}` };
}
export const localOrigin = (host, port) => [`127.0.0.1:${port}`, `localhost:${port}`, `amygdala.localhost:${port}`].includes(String(host || '').toLowerCase());
export function main(args = process.argv.slice(2)) {
  const { server, port, passFile } = parseArgs(args);
  const token = (process.env.AMYGDALA_NODE_PASS || fs.readFileSync(passFile, 'utf8')).trim();
  if (!/^hfn_[\w-]+$/.test(token)) throw new Error('Invalid node pass.');
  const client = server.protocol === 'https:' ? https : http;
  http.createServer((req, res) => {
    // We rewrite Host for the server, so the DNS-rebinding guard has to happen here.
    if (!localOrigin(req.headers.host, port)) { res.writeHead(421); return res.end(); }
    const up = client.request(new URL('/keeper' + req.url, server), { method: req.method, headers: forwardHeaders(req.headers, token, port) }, r => {
      res.writeHead(r.statusCode, Object.fromEntries(Object.entries(r.headers).filter(([k]) => !HOP.has(k)))); r.pipe(res);
    });
    up.on('error', () => { if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' }); res.end('The village server is unreachable.'); });
    res.on('close', () => up.destroy());
    req.pipe(up);
  }).listen(port, '127.0.0.1', () => console.log(`Amygdala keeper relay on http://127.0.0.1:${port}`));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) try { main(); } catch { console.error('Could not start keeper relay; check server and pass file.'); process.exitCode = 1; }
