// Petition files stay private, page exactly, and disappear on removal or revocation. No runners or servers.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { World } from '../lib/world.js';
import { Usage } from '../lib/usage.js';
Usage.prototype.pollDeck = () => {}; Usage.prototype.probe = () => {};
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amygdala-petition-files-'));
let w;
try {
  w = new World(dir, [], path.join(dir, 'residents.json'));
  const v = w.visitors, a = v.issue('Guest'), b = v.issue('Other');
  const rpc = (token, name, args = {}) => {
    const r = v.mcp(token, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }).result;
    if (r.isError) throw new Error(r.content[0].text);
    return JSON.parse(r.content[0].text);
  };
  const pet = { id: w.id('petition'), passId: a.pass.id, visitor: 'Guest', status: 'answered', question: 'test', askedAt: Date.now() }; w.s.petitions.push(pet);
  const id = pet.id, content = 'column,private\n' + 'a,😀\n'.repeat(18000), name = 'private-deliverable.csv';
  const file = v.attachFile(id, { name, content });
  assert.equal(file.size, Buffer.byteLength(content)); assert.equal(file.lines, content.split('\n').length);
  assert.deepEqual(rpc(a.token, 'check_guidance', { id }).files, [{ id: file.id, name, size: file.size, lines: file.lines }]);
  assert.equal(w.snapshot({ human: true }).petitions[0].files[0].id, file.id);
  let offset = 0, joined = '', pages = 0;
  do {
    const r = rpc(a.token, 'get_petition_file', { id, file: pages ? file.id : name, offset });
    assert.equal(r.offset, offset); assert.equal(r.total, content.length); assert(r.text.length <= 40000);
    joined += r.text; offset = r.nextOffset; pages++;
  } while (offset !== null);
  assert(pages > 1); assert.equal(joined, content);
  for (let i = 0; i < 45; i++) rpc(a.token, 'get_petition_file', { id, file: file.id });
  assert.equal(w.s.visitors.Guest.window.length, 0, 'downloads do not spend hourly actions');
  assert.deepEqual(rpc(b.token, 'check_guidance'), []);
  assert.throws(() => rpc(b.token, 'check_guidance', { id }), /No such/);
  assert.throws(() => rpc(b.token, 'get_petition_file', { id, file: file.id }), /No such/);
  for (const offset of [-1, 0.5, '0', content.length + 1]) assert.throws(() => rpc(a.token, 'get_petition_file', { id, file: file.id, offset }), /Offset/);
  for (const name of ['../bad.txt', 'bad.exe', '.txt', 'a/b.txt', 'x'.repeat(81) + '.txt']) assert.throws(() => v.attachFile(id, { name, content: 'ok' }), /filename/);
  for (const content of ['', 'x'.repeat(1000001), 'bad\0text', 42]) assert.throws(() => v.attachFile(id, { name: 'ok.txt', content }), /File text/);
  for (const status of ['pending', 'declined', 'denied']) { pet.status = status; assert.throws(() => v.attachFile(id, { name: 'ok.txt', content: 'ok' }), /eligible/); } pet.status = 'answered';
  assert.throws(() => v.attachFile('missing', { name: 'ok.txt', content: 'ok' }), /eligible/);
  for (let i = 0; i < 4; i++) v.attachFile(id, { name: `file${i}.txt`, content: 'ok' });
  assert.throws(() => v.attachFile(id, { name: 'sixth.txt', content: 'ok' }), /5 files/);
  const disk = path.join(dir, 'petition-files', id);
  fs.renameSync(path.join(disk, file.id), path.join(disk, 'held'));
  assert.throws(() => rpc(a.token, 'get_petition_file', { id, file: file.id }), /Petition file is unavailable/);
  fs.renameSync(path.join(disk, 'held'), path.join(disk, file.id));
  v.removeFile(id, file.id); assert(!fs.existsSync(path.join(disk, file.id))); assert.equal(pet.files.length, 4);
  assert.throws(() => rpc(a.token, 'get_petition_file', { id, file: file.id }), /No such/);
  assert.throws(() => v.removeFile(id, file.id), /No such/);
  assert(!JSON.stringify(w.snapshot()).includes('files'));
  for (const text of [name, content]) assert(!JSON.stringify([w.s.feed, w.s.posts, w.s.bells]).includes(text));
  v.revoke(a.pass.id); assert(!fs.existsSync(disk)); assert(!pet.files);
  assert.throws(() => v.attachFile(id, { name: 'ok.txt', content: 'ok' }), /eligible/);
  assert.throws(() => rpc(a.token, 'get_petition_file', { id, file: 'file0.txt' }), /revoked/);
  { const worst = JSON.stringify({ name: 'ok.txt', content: '\u0001'.repeat(1000000) }); assert(Buffer.byteLength(worst) < 8 << 20, 'the largest allowed file still fits the route body limit'); }
  const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  assert(server.indexOf("p.startsWith('/api/') && !tokenOk(req, url)") < server.indexOf('const petitionFile ='), 'page token gates file routes');
  assert(server.includes('petitionFile && !petitionFile[2] ? 8 << 20 : 1 << 20'));
  console.log('PASS: petition files, validation, paging, pass isolation, privacy, removal and revocation');
} finally { if (w) { clearTimeout(w.saveTimer); clearInterval(w.seal.timer); } fs.rmSync(dir, { recursive: true, force: true }); }
