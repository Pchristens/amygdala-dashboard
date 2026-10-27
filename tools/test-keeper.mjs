// Keeper relay: only keeper passes reach the dashboard through the gate; the local relay guards its own origin.
import assert from 'node:assert/strict';
import http from 'node:http';
import { keeperAuth, relay, setKeeper } from '../lib/keeper.js';
import { forwardHeaders, localOrigin, parseArgs } from './amygdala-keeper.mjs';

const passes = [{ id: 'np1', revoked: false }, { id: 'np2', revoked: false, keeper: true }];
const world = { s: { nodePasses: passes }, changed() {}, nodes: { auth: t => ({ a: passes[0], b: passes[1] })[t] || null } };
const req = auth => ({ headers: { authorization: auth } });
assert.equal(keeperAuth(world, req('Bearer a')), null, 'plain node pass is not a keeper');
assert.equal(keeperAuth(world, req('Bearer b')), passes[1]);
assert.equal(keeperAuth(world, req('Bearer nope')), null);
assert.equal(keeperAuth(world, req(undefined)), null);
setKeeper(world, 'np1', true); assert.equal(keeperAuth(world, req('Bearer a')), passes[0]); setKeeper(world, 'np1', false);
assert.throws(() => setKeeper(world, 'missing', true));

assert(localOrigin('127.0.0.1:8790', 8790) && localOrigin('LOCALHOST:8790', 8790));
assert(!localOrigin('evil.example:8790', 8790) && !localOrigin('127.0.0.1:9999', 8790) && !localOrigin(undefined, 8790));
const h = forwardHeaders({ host: 'x', authorization: 'Bearer stolen', connection: 'keep-alive', 'x-amygdala-token': 't' }, 'hfn_abc', 8790);
assert.deepEqual(h, { 'x-amygdala-token': 't', host: '127.0.0.1:8790', authorization: 'Bearer hfn_abc' });
assert.throws(() => parseArgs(['--server', 'ftp://x', '--pass-file', 'f'])); assert.equal(parseArgs(['--server', 'http://h:8795', '--pass-file', 'f']).port, 8790);

// relay(): the upstream sees loopback Host, no Authorization, the stripped path, and the body; the response is piped back.
const seen = await new Promise(resolve => {
  const up = http.createServer((r, s) => { let b = ''; r.on('data', c => b += c).on('end', () => { s.writeHead(201, { 'x-up': '1' }); s.end('ok:' + b); resolve({ host: r.headers.host, auth: r.headers.authorization, url: r.url, body: b }); }); }).listen(0, '127.0.0.1', () => {
    const port = up.address().port;
    const gate = http.createServer((r, s) => relay(r, s, port, r.url)).listen(0, '127.0.0.1', () => {
      const q = http.request({ host: '127.0.0.1', port: gate.address().port, method: 'POST', path: '/api/x?y=1', headers: { authorization: 'Bearer hfn_secret' } }, res => {
        let out = ''; res.on('data', c => out += c).on('end', () => { assert.equal(res.statusCode, 201); assert.equal(res.headers['x-up'], '1'); assert.equal(out, 'ok:hi'); up.close(); gate.close(); });
      }); q.end('hi');
    });
  });
});
assert.match(seen.host, /^127\.0\.0\.1:\d+$/); assert.equal(seen.auth, undefined); assert.equal(seen.url, '/api/x?y=1'); assert.equal(seen.body, 'hi');
console.log('keeper ok');
