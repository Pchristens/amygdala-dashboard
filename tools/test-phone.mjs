// Phone sign-in (v0.92): only the human makes a link; a code works once and for ten minutes; the cookie session lasts
// 30 days, is kept only as a hash, and is cleared by sign-out. The gate relays the cookie only on its own address and
// never on the node, hero or visitor routes. Synthetic state only; no server, no CLIs, no model calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { World } from '../lib/world.js';
import { Usage } from '../lib/usage.js';
import { Phones, PHONE_COOKIE } from '../lib/phone.js';
Usage.prototype.pollDeck = () => {}; Usage.prototype.probe = () => {};
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amygdala-phone-'));
let w;
try {
  w = new World(dir, [], path.join(dir, 'residents.json'));
  const ph = w.phones = new Phones(w), now = Date.now();
  const req = sid => ({ headers: { cookie: `other=1; ${PHONE_COOKIE}=${sid}; x=2` } });

  // Only the human, and only with the gate open.
  assert.throws(() => ph.issue('steward', now), /Only the human/);
  assert.throws(() => ph.issue('human', now), /gate is not open/);
  w.gateUrl = 'http://gate.test:8795';
  const { url, expiresAt } = ph.issue('human', now);
  assert.match(url, /^http:\/\/gate\.test:8795\/phone#[\w-]{40,}$/); assert.equal(expiresAt, now + 600000);
  const code = url.split('#')[1];
  assert(!JSON.stringify(w.s.phone).includes(code), 'the code is kept only as a hash');

  // A wrong or malformed code fails; the right one works once.
  assert.throws(() => ph.login('x'.repeat(43), now), /expired or was already used/);
  assert.throws(() => ph.login({ code }, now), /expired/);
  const { sid, maxAge } = ph.login(code, now + 1000);
  assert.equal(maxAge, 30 * 86400); assert.throws(() => ph.login(code, now + 2000), /already used/);
  assert(!JSON.stringify(w.s.phone).includes(sid), 'the session is kept only as a hash');

  // The cookie authenticates; others, a tampered value or an expired session don't.
  assert(ph.auth(req(sid), now + 5000)); assert.equal(ph.auth(req(sid + 'x'), now), null); assert.equal(ph.auth({ headers: {} }, now), null);
  assert.equal(ph.auth({ headers: { cookie: `x${PHONE_COOKIE}=${sid}` } }, now), null, 'the cookie name must match exactly');
  assert.equal(ph.auth(req(sid), now + 31 * 86400000), null);

  // A code expires after ten minutes.
  const late = ph.issue('human', now).url.split('#')[1];
  assert.throws(() => ph.login(late, now + 600001), /expired/);

  // The human snapshot shows sessions without hashes; other viewers see nothing.
  const view = w.snapshot({ human: true }).phone;
  assert.equal(view.sessions.length, 1); assert.deepEqual(Object.keys(view.sessions[0]).sort(), ['createdAt', 'expiresAt', 'id', 'lastSeenAt']);
  assert.equal(w.snapshot({ human: false }).phone, undefined);

  // At most five sessions; sign-out (human only) clears them all.
  for (let i = 0; i < 6; i++) ph.login(ph.issue('human').url.split('#')[1]);
  assert.equal(w.s.phone.sessions.length, 5);
  assert.throws(() => ph.signOut('steward'), /Only the human/);
  assert.deepEqual(ph.signOut('human').phone.sessions, []); assert.equal(ph.auth(req(sid)), null);

  // The gate: the cookie is HttpOnly and SameSite=Strict, relayed only on the gate's own host, never on the node, hero
  // or visitor routes, and stripped before it reaches the dashboard; the link and sign-out need the human's mark.
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  assert.match(server, /HttpOnly; SameSite=Strict; Path=\/; Max-Age=/);
  const gate = server.match(/\n *if \(!\/\^\\\/\(node\|hero\|visit\)\\\/\/\.test\(p\) && \(req\.headers\.host \|\| ''\)\.toLowerCase\(\) === `\$\{tsAddr\}:\$\{GATE_PORT\}` && world\.phones\.auth\(req\)\) \{ delete req\.headers\.cookie; return relay\(req, res, PORT, req\.url, 'phone'\); \}/);
  assert(gate, 'the gate relays phone cookies with all three guards');
  assert(server.indexOf(gate[0]) > server.indexOf("if (p === '/node/term')") && server.indexOf(gate[0]) < server.indexOf("await visit(req, res, p)"));
  assert.match(server, /'POST \/api\/phone\/link': \(b, req\) => world\.phones\.issue\(actorOf\(req\)\)/);
  assert.match(server, /'POST \/api\/phone\/signout': \(b, req\) => world\.phones\.signOut\(actorOf\(req\)\)/);
  // The sign-in page reads the code from the fragment and drops it from the address bar.
  assert.match(server, /const PHONE_PAGE = .*location\.hash\.slice\(1\);history\.replaceState/);
  // The lite page: three.js loads only when the 3D map is built, and the stand-in map is not a thenable (makeMap is
  // awaited, so a `then` would hang the page at "connecting…").
  const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
  assert(!/^import .*map3d\.js/m.test(app), 'no static import of the 3D map'); assert.match(app, /map3d = await import\('\.\/map3d\.js'\)/);
  assert.match(app, /\['then', 'setQuality', 'playIntro'\]\.includes\(k\) \? undefined/);
  assert.match(app, /if \(LITE && !open\) \{ open = true;/, 'lite never closes the drawer onto an empty page');
  console.log('phone ok');
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
