import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { env, bin } from '../lib/bin.js';
import { Seal } from '../lib/seal.js';

// Derive the legacy spellings from the compatibility implementation, keeping the inventory small.
const binSource = fs.readFileSync(new URL('../lib/bin.js', import.meta.url), 'utf8');
const legacy = binSource.match(/source\['([^']+)' \+ name\];/)[1];
for (const key of ['PORT', 'GATE_PORT', 'GATE', 'NO_GATE', 'LATLON', 'NO_DECK', 'AGENT_DECK', 'TMUX']) {
  const source = { [legacy + key]: 'old' };
  assert.equal(env(key, source), 'old'); source['AMYGDALA_' + key] = 'new';
  assert.equal(env(key, source), 'new'); source['AMYGDALA_' + key] = '';
  assert.equal(env(key, source), ''); assert.equal(env(key, {}), undefined);
}
for (const name of ['agent-deck', 'tmux']) {
  const key = name === 'tmux' ? 'TMUX' : 'AGENT_DECK';
  assert.equal(bin(name, { platform: 'linux', home: '/nonexistent', env: { [legacy + key]: '/old/bin' } }), '/old/bin');
  assert.equal(bin(name, { platform: 'linux', home: '/nonexistent', env: { [legacy + key]: '/old/bin', ['AMYGDALA_' + key]: '/new/bin' } }), '/new/bin');
}
// Exercise the actual auth predicate without starting the live server or reading its state.
const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const auth = server.match(/const tokenOk = ([\s\S]*?\n});/)[1];
const token = 'test-page-token', tokenOk = vm.runInNewContext('(' + auth + ')', { crypto, Buffer, API_TOKEN: token });
const url = new URL('http://localhost/api/state');
const oldHeader = server.match(/req.headers\['x-amygdala-token'\] \|\| req.headers\['([^']+)'\]/)[1];
for (const name of ['x-amygdala-token', oldHeader]) {
  assert(tokenOk({ headers: { [name]: token } }, url));
  assert(!tokenOk({ headers: { [name]: 'invalid' } }, url));
}
assert(!tokenOk({ headers: {} }, url));
assert(tokenOk({ headers: {} }, new URL(url + '?token=' + token)));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amygdala-rename-'));
const world = { s: { residents: {}, trees: {} }, temple: { migrateSnapshots() {} }, trees: { ensure() {} }, addFeed() {}, refreshWorkers() {}, save() {}, changed() {} };
let seal;
try {
  seal = new Seal(world, dir);
  seal.setup('test-passphrase');
  assert.equal(seal.decrypt(seal.meta.check, seal.derive('test-passphrase', seal.meta.salt)).ok, 'amygdala');
  seal.unlock('test-passphrase'); assert(!seal.locked); seal.lock();
  // Persist and reopen an old-format check, using only an empty synthetic world.
  const oldCheck = fs.readFileSync(new URL('../lib/seal.js', import.meta.url), 'utf8').match(/\['amygdala', '([^']+)'\]/)[1];
  seal.meta.check = seal.encrypt({ ok: oldCheck }, seal.derive('test-passphrase', seal.meta.salt));
  fs.writeFileSync(seal.file, JSON.stringify(seal.meta)); clearInterval(seal.timer);
  seal = new Seal(world, dir);
  assert.throws(() => seal.unlock('wrong-passphrase'), /does not break/);
  seal.unlock('test-passphrase'); assert(!seal.locked); seal.lock();
  seal.meta.check = seal.encrypt({ ok: 'invalid' }, seal.derive('test-passphrase', seal.meta.salt));
  assert.throws(() => seal.unlock('test-passphrase'), /does not break/);
  console.log('PASS: environment fallback and precedence, both token headers, new and legacy seal checks');
} finally { clearInterval(seal?.timer); fs.rmSync(dir, { recursive: true, force: true }); }
