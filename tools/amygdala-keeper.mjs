// Local keeper relay: serves the remote village's dashboard at http://127.0.0.1:<port> on this machine.
// Every request goes to the server's Tailscale gate under /keeper with this node's pass; the pass must be marked keeper.
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { promisify } from 'node:util';
import { bin, buildPath, execFile, spawn } from '../lib/bin.js';
import { LocalTerms } from './keeper-term.mjs';
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
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), exec = promisify(execFile);
  const ask = (p, pageToken) => new Promise((resolve, reject) => {
    const q = client.get(new URL('/keeper' + p, server), { headers: { authorization: `Bearer ${token}`, 'x-amygdala-token': pageToken } }, r => {
      let data = ''; r.setEncoding('utf8'); r.on('data', c => data += c); r.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    }); q.on('error', reject);
  });
  let cachedAt = 0, cachedSessions = [];
  const sessions = async () => {
    if (Date.now() - cachedAt < 2000) return cachedSessions;
    const env = { ...process.env, PATH: buildPath({ unix: [] }) };
    const { stdout } = await exec(bin('agent-deck'), ['list', '--json'], { env, timeout: 15000, maxBuffer: 8 << 20 });
    const parsed = JSON.parse(stdout); cachedSessions = Array.isArray(parsed) ? parsed : parsed.sessions || []; cachedAt = Date.now(); return cachedSessions;
  };
  const terms = new LocalTerms({ ask, sessions, spawn: s => spawn('python3', ['-I', path.join(ROOT, 'tools/ptybridge.py'), bin('tmux'), 'attach-session', '-t', s.tmux_session], { env: { ...process.env, PATH: buildPath({ unix: [] }) }, stdio: ['pipe', 'pipe', 'ignore'] }) });
  http.createServer((req, res) => {
    // We rewrite Host for the server, so the DNS-rebinding guard has to happen here.
    if (!localOrigin(req.headers.host, port)) { res.writeHead(421); return res.end(); }
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    terms.handle(req, res, url).then(handled => { if (handled) return; forward(); }).catch(() => { if (!res.headersSent) res.writeHead(502); res.end(); });
    function forward() {
    const up = client.request(new URL('/keeper' + req.url, server), { method: req.method, headers: forwardHeaders(req.headers, token, port) }, r => {
      res.writeHead(r.statusCode, Object.fromEntries(Object.entries(r.headers).filter(([k]) => !HOP.has(k)))); r.pipe(res);
    });
    up.on('error', () => { if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' }); res.end('The village server is unreachable.'); });
    res.on('close', () => up.destroy());
    req.pipe(up);
    }
  }).listen(port, '127.0.0.1', () => console.log(`Amygdala keeper relay on http://127.0.0.1:${port}`));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) try { main(); } catch { console.error('Could not start keeper relay; check server and pass file.'); process.exitCode = 1; }
