import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { PassThrough } from 'node:stream';
import { LocalTerms } from './keeper-term.mjs';

function fixture({ ok = true, session = {}, fail = 0, other = false } = {}) {
  const children = [], checks = []; let lists = 0;
  const record = { id: 's1', tmux_session: 'tmux1', ...session };
  const terms = new LocalTerms({ ask: async (path, token) => { checks.push([path, token]); if (fail) { fail--; throw Error('offline'); } return { ok, sessionId: other ? 'elsewhere' : 's1' }; }, sessions: async () => { lists++; return [record]; }, spawn: () => { const c = new EventEmitter(); c.stdin = new PassThrough(); c.stdout = new PassThrough(); c.lines = ''; c.stdin.on('data', d => c.lines += d); c.kill = () => {}; children.push(c); return c; }, now: () => 0, schedule: (fn, ms) => { const t = setTimeout(fn, ms); t.unref(); return t; } });
  return { terms, children, checks, record, lists: () => lists };
}
function response() { const r = new EventEmitter(); r.headers = {}; r.writes = []; r.writeHead = (status, headers = {}) => { r.statusCode = status; r.headers = headers; }; r.write = x => { r.writes.push(String(x)); return true; }; r.end = x => { if (x) r.writes.push(String(x)); r.ended = true; }; r.destroy = () => { r.destroyed = true; }; return r; }
const id = 'node:np1:s1', token = 'secret';
const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8'); assert.match(server, /const localTerm = p\.match\(\/\^\\\/api\\\/term\\\/\(node:\[\^\/\]\+:\[\^\/\]\+\)\\\/local\$\//); assert.match(server, /termHub\.allowed\(localTerm\[1\]\)/);
let f = fixture(); assert.equal(await f.terms.handle({ method: 'GET', headers: {} }, response(), new URL('http://x/api/term/node%3Anp1%3Aremote/stream')), false); assert.equal(f.checks.length, 0);
f = fixture({ ok: false }); let res = response(); assert.equal(await f.terms.handle({ method: 'GET', headers: {} }, res, new URL(`http://x/api/term/${id}/stream?token=${token}`)), true); assert.equal(res.statusCode, 403); assert.equal(f.children.length, 0);
for (const priv of [{ group: 'isle' }, { quarantined: true }, { sealed: true }]) { f = fixture({ session: priv }); res = response(); await f.terms.handle({ method: 'GET', headers: {} }, res, new URL(`http://x/api/term/${id}/stream?token=${token}`)); assert.equal(res.statusCode, 403); assert.equal(f.children.length, 0); }
f = fixture(); const stream = response(); assert.equal(await f.terms.handle({ method: 'GET', headers: {} }, stream, new URL(`http://x/api/term/${id}/stream?token=${token}`)), true); assert.equal(f.children.length, 1); assert(stream.writes.join('').includes(': connected')); f.children[0].stdout.write('{"t":"o","d":"aGk="}\n'); await new Promise(r => setImmediate(r)); assert(stream.writes.join('').includes('event: o\ndata: aGk=')); const second = response(); await f.terms.handle({ method: 'GET', headers: {} }, second, new URL(`http://x/api/term/${id}/stream?token=${token}`)); assert.equal(f.children.length, 1); assert(second.writes.join('').includes('aGk='));
res = response(); await f.terms.handle({ method: 'POST', headers: { 'x-amygdala-token': 'wrong' } }, res, new URL(`http://x/api/term/${id}/input`)); assert.equal(res.statusCode, 403);
res = response(); await f.terms.handle({ method: 'POST', headers: { 'x-amygdala-token': token, 'content-type': 'application/json' }, body: JSON.stringify({ d: 'aGk=' }) }, res, new URL(`http://x/api/term/${id}/input`)); assert.equal(f.children[0].lines, '{"t":"i","d":"aGk="}\n');
for (const [path, body] of [['input', { d: '!' }], ['resize', { cols: 1001, rows: 20 }]]) { res = response(); await f.terms.handle({ method: 'POST', headers: { 'x-amygdala-token': token, 'content-type': 'application/json' }, body: JSON.stringify(body) }, res, new URL(`http://x/api/term/${id}/${path}`)); assert.equal(res.statusCode, 400); }
f = fixture(); res = response(); await f.terms.handle({ method: 'GET', headers: {} }, res, new URL(`http://x/api/term/${id}/stream?token=${token}`)); f.terms.ask = async () => ({ ok: false }); await f.terms.bridges.get(id).recheck(); assert(res.writes.join('').includes('event: exit'));
f = fixture(); await f.terms.handle({ method: 'GET', headers: {} }, response(), new URL(`http://x/api/term/${id}/stream?token=${token}`)); let attempts = 0; f.terms.ask = async () => { attempts++; throw Error('offline'); }; const bridge = f.terms.bridges.get(id); await bridge.recheck(); assert.equal(bridge.closed, false); await bridge.recheck(); assert.equal(bridge.closed, true);
f = fixture(); assert.equal(await f.terms.handle({ method: 'POST', headers: {} }, response(), new URL(`http://x/api/term/${id}/image`)), false);
f = fixture(); await f.terms.handle({ method: 'GET', headers: {} }, response(), new URL(`http://x/api/term/${id}/stream?token=${token}`)); res = response(); await f.terms.handle({ method: 'POST', headers: { 'x-amygdala-token': token } }, res, new URL(`http://x/api/term/${id}/close`)); assert.equal(f.terms.bridges.has(id), false);
// The server's answer must name the session found here, and input for a terminal not open here never waits on agent-deck.
f = fixture({ other: true }); res = response(); assert.equal(await f.terms.handle({ method: 'GET', headers: {} }, res, new URL(`http://x/api/term/${encodeURIComponent(id)}/stream?token=${token}`)), true); assert.equal(res.statusCode, 403); assert.equal(f.children.length, 0);
f = fixture(); assert.equal(await f.terms.handle({ method: 'POST', headers: { 'x-amygdala-token': token, 'content-type': 'application/json' }, body: { d: 'YQ==' } }, response(), new URL(`http://x/api/term/${encodeURIComponent(id)}/input`)), false); assert.equal(f.lists(), 0);
console.log('keeper term ok');
