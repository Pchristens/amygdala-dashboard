// Image paste into hero terminals (v0.36): fixtures only, no network, no model CLIs, temp folders.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decodeImage, savePaste, pasteDir, pastePathOk, IMAGE_MAX } from '../lib/pastes.js';
import { terminalImages, pastedImages, terminalKeys } from '../public/terminal-input.js';
import { Nodes } from '../lib/nodes.js';
import { TermHub } from '../lib/term.js';
import { executeJob } from './amygdala-node.mjs';
import { PassThrough } from 'node:stream';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'amygdala-image-'));
const settle = async () => { for (let i = 0; i < 30; i++) await new Promise(r => setImmediate(r)); };
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(24, 1)]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]), GIF = Buffer.from('GIF89a......'), WEBP = Buffer.from('RIFF\0\0\0\0WEBPVP8 ');
const b64 = b => b.toString('base64');
try {
  // Types, magic bytes, canonical base64 and size.
  for (const [type, buf] of [['image/png', PNG], ['image/jpeg', JPG], ['image/gif', GIF], ['image/webp', WEBP]]) assert(decodeImage(type, b64(buf)).equals(buf));
  assert.throws(() => decodeImage('image/svg+xml', b64(PNG)), /PNG, JPEG, GIF or WebP/);
  assert.throws(() => decodeImage('image/heic', b64(PNG)), /PNG, JPEG, GIF or WebP/);
  assert.throws(() => decodeImage('toString', b64(PNG)), /PNG, JPEG, GIF or WebP/);
  assert.throws(() => decodeImage('image/jpeg', b64(PNG)), /not the image type/);
  assert.throws(() => decodeImage('image/png', b64(Buffer.from('<svg onload=x>'))), /not the image type/);
  assert.throws(() => decodeImage('image/webp', b64(Buffer.from('RIFF\0\0\0\0WAVEfmt '))), /not the image type/);
  assert.throws(() => decodeImage('image/png', b64(PNG) + '!'), /Invalid image data/);
  assert.throws(() => decodeImage('image/png', ''), /8 MiB/);
  const big = Buffer.alloc(IMAGE_MAX + 3); PNG.copy(big);
  assert.throws(() => decodeImage('image/png', b64(big)), /8 MiB/);
  const max = Buffer.alloc(IMAGE_MAX); PNG.copy(max); assert.equal(decodeImage('image/png', b64(max)).length, IMAGE_MAX);

  // Private folder, private file, random name, pruning of our own day-old files only.
  assert.equal(pasteDir({ platform: 'linux', home: '/home/h' }), '/home/h/.cache/amygdala/pastes');
  assert.equal(pasteDir({ platform: 'win32', env: { LOCALAPPDATA: 'C:\\Users\\h\\AppData\\Local' } }), 'C:\\Users\\h\\AppData\\Local\\Amygdala\\pastes');
  const dir = path.join(tmp, 'local', '.cache', 'amygdala', 'pastes');
  const old = path.join(dir, 'a'.repeat(32) + '.png'), other = path.join(dir, 'keep-me.png');
  fs.mkdirSync(dir, { recursive: true, mode: 0o755 }); fs.writeFileSync(old, 'x'); fs.writeFileSync(other, 'x');
  const day = new Date(Date.now() - 25 * 3600000); fs.utimesSync(old, day, day); fs.utimesSync(other, day, day);
  const fresh = path.join(dir, 'b'.repeat(32) + '.gif'); fs.writeFileSync(fresh, 'x');
  const saved = savePaste(PNG, 'image/png', { dir });
  assert(path.isAbsolute(saved) && /[0-9a-f]{32}\.png$/.test(saved) && pastePathOk(saved));
  assert(fs.readFileSync(saved).equals(PNG));
  assert.equal(fs.statSync(saved).mode & 0o777, 0o600); assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
  assert(!fs.existsSync(old)); assert(fs.existsSync(other)); assert(fs.existsSync(fresh));
  assert.notEqual(savePaste(JPG, 'image/jpeg', { dir }), saved);
  assert(/\.jpg$/.test(savePaste(JPG, 'image/jpeg', { dir })));
  fs.symlinkSync(dir, path.join(tmp, 'link'));
  assert.throws(() => savePaste(PNG, 'image/png', { dir: path.join(tmp, 'link') }), /not a directory/);
  for (const bad of ['relative/aaaa.png', '/x/evil.png', `/x/${'a'.repeat(32)}.png\x1b[2J`, `/x/${'a'.repeat(32)}.svg`]) assert(!pastePathOk(bad));
  assert(pastePathOk(`C:\\Users\\h\\AppData\\Local\\Amygdala\\pastes\\${'c'.repeat(32)}.webp`));

  // Local hero: same gate as input, saved on this machine, rate limited; private heroes refused.
  let seq = 0;
  const world = { s: {}, workers: [], sites: { privateWorker: w => w.private === true }, id: k => `${k}-${++seq}`, changed() {}, refreshWorkers() {} };
  world.nodes = new Nodes(world);
  const child = () => ({ stdin: { writable: true, writableLength: 0, write() {}, end() {}, on() {} }, stdout: new PassThrough(), on() {}, kill() {} });
  const local = { id: 'local:hero', host: 'local', zone: 'village' }; world.workers.push(local);
  const localDir = path.join(tmp, 'server-pastes');
  const hub = new TermHub(world, { platform: 'linux', startChild: child, pastes: localDir });
  assert.throws(() => hub.imageGate('local:hero'), /not connected/);
  await hub.open('local:hero');
  hub.imageGate('local:hero');
  const p1 = await hub.image('local:hero', 'image/png', b64(PNG));
  assert(p1.startsWith(localDir + path.sep) && fs.readFileSync(p1).equals(PNG));
  await assert.rejects(hub.image('local:hero', 'image/png', b64(JPG)), /not the image type/);
  for (const [flag, value] of [['zone', 'isle'], ['isleTagged', true], ['quarantined', true], ['sealed', true], ['private', true]]) {
    const before = fs.readdirSync(localDir).length, keep = local[flag]; local[flag] = value;
    assert.throws(() => hub.imageGate('local:hero'), /private or gone/);
    await assert.rejects(hub.image('local:hero', 'image/png', b64(PNG)), /private or gone/);
    assert.equal(fs.readdirSync(localDir).length, before);
    if (keep === undefined) delete local[flag]; else local[flag] = keep;
  }
  hub.imageTimes = Array(19).fill(Date.now()); hub.imageGate('local:hero');
  assert.throws(() => hub.imageGate('local:hero'), e => e.status === 429);
  hub.imageTimes = []; hub.imagesInFlight = 3; assert.throws(() => hub.imageGate('local:hero'), e => e.status === 429); hub.imagesInFlight = 0;

  // Node hero: one image per report, the node re-checks its own allow-list, the path comes back.
  const issued = world.nodes.issue('Fixture Node'), pass = world.nodes.auth(issued.token);
  world.nodes.live.set(pass.id, { at: Date.now(), deckAvailable: true, sessions: [] });
  const nodeHero = { id: `node:${pass.id}:s1`, node: pass.id, sessionId: 's1', host: 'Fixture Node', zone: 'village' }; world.workers.push(nodeHero);
  await hub.open(nodeHero.id);
  const reportBody = results => ({ hostname: 'fixture', os: 'linux', deckAvailable: true, sessions: [{ id: 's1', status: 'idle', tool: 'claude', title: 't', project: 'p', path: '/p', group: '' }], results });
  const report = results => { world.nodes.live.get(pass.id).at = 0; const out = world.nodes.report(pass, reportBody(results)); world.workers = world.workers.filter(w => !w.node).concat(nodeHero); return out; };
  const first = hub.image(nodeHero.id, 'image/png', b64(PNG)), second = hub.image(nodeHero.id, 'image/gif', b64(GIF));
  await settle();
  let r = report([]); assert.equal(r.jobs.length, 1); assert.equal(r.jobs[0].kind, 'image'); assert.equal(r.jobs[0].sessionId, 's1');
  const nodeDir = path.join(tmp, 'node-pastes'), sessions = [{ id: 's1', tmux_session: 'x' }];
  await assert.rejects(executeJob(r.jobs[0], r.jobs, sessions, [], null, null, nodeDir), /private or unrequested/);
  await assert.rejects(executeJob(r.jobs[0], r.jobs, [{ id: 's1', group: 'isle' }], ['s1'], null, null, nodeDir), /private or unrequested/);
  await assert.rejects(executeJob(r.jobs[0], r.jobs, [{ id: 's1', quarantined: true }], ['s1'], null, null, nodeDir), /private or unrequested/);
  await assert.rejects(executeJob(r.jobs[0], r.jobs, [{ id: 's1', ssh_host: 'far' }], ['s1'], null, null, nodeDir), /Remote/);
  const forged = { ...r.jobs[0], d: b64(JPG) }; await assert.rejects(executeJob(forged, [forged], sessions, ['s1'], null, null, nodeDir), /not the image type/);
  assert(!fs.existsSync(nodeDir));
  const nodePath = await executeJob(r.jobs[0], r.jobs, sessions, ['s1'], null, null, nodeDir);
  assert(nodePath.startsWith(nodeDir) && fs.readFileSync(nodePath).equals(PNG) && (fs.statSync(nodePath).mode & 0o777) === 0o600);
  r = report([{ id: r.jobs[0].id, ok: true, output: nodePath, error: '' }]);
  assert.equal(await first, nodePath);
  assert.equal(r.jobs.length, 1); assert.equal(r.jobs[0].type, 'image/gif');
  report([{ id: r.jobs[0].id, ok: true, output: '/tmp/not-ours.gif', error: '' }]);
  await assert.rejects(second, /Please update Amygdala/);
  await assert.rejects(world.nodes.request(pass.id, 'image', { sessionId: 's1', type: 'image/svg+xml', d: 'AAAA' }, nodeHero.id), /Invalid image/);
  await assert.rejects(world.nodes.request(pass.id, 'image', { sessionId: 's1', type: 'image/png', d: 'AAAA', extra: 1 }, nodeHero.id), /Invalid image/);
  await assert.rejects(world.nodes.request(pass.id, 'image', { sessionId: 's2', type: 'image/png', d: 'AAAA' }, nodeHero.id), /Wrong node session/);
  // A hero that turns private while its image waits is refused at delivery.
  const third = hub.image(nodeHero.id, 'image/png', b64(PNG)); await settle();
  nodeHero.quarantined = true; assert.equal(report([]).jobs.length, 0); await assert.rejects(third, /private or gone/);
  assert.throws(() => hub.imageGate(nodeHero.id), /private or gone/); delete nodeHero.quarantined;
  for (const b of hub.bridges.values()) b.close();
  clearInterval(hub.watch);

  // Browser: image-only paste uploads and pastes the path (bracketed); text paste is untouched.
  class Term { constructor() { this.out = []; } paste(text) { this.out.push(`\x1b[200~${text}\x1b[201~`); } }
  const file = (type, bytes) => ({ type, size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) });
  const clip = (files, text = '') => ({ types: [...(text ? ['text/plain'] : []), ...(files.length ? ['Files'] : [])], getData: t => (t === 'text/plain' ? text : ''), files });
  const event = (type, data) => ({ type, [type === 'drop' ? 'dataTransfer' : 'clipboardData']: data, prevented: 0, stopped: 0, preventDefault() { this.prevented++; }, stopImmediatePropagation() { this.stopped++; } });
  const term = new Term(), uploads = [], notes = [];
  let reply = { ok: true, status: 200, json: async () => ({ ok: true, path: '/home/h/.cache/amygdala/pastes/' + 'd'.repeat(32) + '.png' }) };
  const images = terminalImages({ term, upload: async data => { uploads.push(data); return reply; }, status: (t, e) => notes.push([t, !!e]) });
  let e = event('paste', clip([file('image/png', PNG)])); assert.equal(images.paste(e), true); await settle();
  assert.equal(e.prevented, 1); assert.equal(e.stopped, 1);
  assert.deepEqual(uploads, [{ type: 'image/png', d: b64(PNG) }]);
  assert.deepEqual(term.out, [`\x1b[200~/home/h/.cache/amygdala/pastes/${'d'.repeat(32)}.png\x1b[201~`]);
  assert.deepEqual(notes, [['Uploading image…', false], ['', false]]);
  e = event('paste', clip([file('image/png', PNG)], 'a caption')); assert.equal(images.paste(e), false); assert.equal(e.prevented, 0); assert.equal(e.stopped, 0);
  e = event('paste', clip([], 'plain text')); assert.equal(images.paste(e), false); assert.equal(e.prevented, 0);
  assert.equal(images.paste(event('paste', null)), false);
  assert.equal(uploads.length, 1);
  // Clipboards that expose only items (no files list) still work.
  e = event('paste', { types: ['Files'], getData: () => '', files: [], items: [{ kind: 'string' }, { kind: 'file', getAsFile: () => file('image/webp', WEBP) }] });
  assert.equal(images.paste(e), true); await settle(); assert.equal(uploads.at(-1).type, 'image/webp');
  // Drop: several images upload in order; non-images are refused without navigating away; oversize is refused locally.
  term.out = []; notes.length = 0;
  e = event('drop', clip([file('image/gif', GIF), file('image/jpeg', JPG)])); images.drop(e); await settle();
  assert.deepEqual(uploads.slice(-2).map(u => u.type), ['image/gif', 'image/jpeg']); assert.equal(term.out.length, 2);
  const count = uploads.length;
  e = event('drop', clip([file('application/pdf', Buffer.from('%PDF'))])); assert.equal(images.drop(e), true); assert.equal(e.prevented, 1);
  assert.deepEqual(notes.at(-1), ['Only PNG, JPEG, GIF or WebP images can be pasted.', true]);
  e = event('paste', clip([file('image/heic', Buffer.from('x'))])); assert.equal(images.paste(e), false); assert.equal(e.prevented, 0);
  images.paste(event('paste', clip([{ type: 'image/png', size: (8 << 20) + 1, arrayBuffer: async () => { throw new Error('should not read'); } }]))); await settle();
  assert.equal(uploads.length, count); assert.deepEqual(notes.at(-1), ['Image too large (8 MiB at most).', true]);
  // Server errors are shown, nothing is pasted; a path with spaces is quoted.
  term.out = []; reply = { ok: false, status: 400, json: async () => ({ ok: false, error: 'That hero is private or gone.' }) };
  images.paste(event('paste', clip([file('image/png', PNG)]))); await settle();
  assert.deepEqual(term.out, []); assert.deepEqual(notes.at(-1), ['That hero is private or gone.', true]);
  reply = { ok: true, status: 200, json: async () => ({ ok: true, path: `C:\\Users\\A B\\AppData\\Local\\Amygdala\\pastes\\${'e'.repeat(32)}.png` }) };
  images.paste(event('paste', clip([file('image/png', PNG)]))); await settle();
  assert.deepEqual(term.out, [`\x1b[200~"C:\\Users\\A B\\AppData\\Local\\Amygdala\\pastes\\${'e'.repeat(32)}.png"\x1b[201~`]);
  let over = { dataTransfer: { types: ['Files'] }, prevented: 0, preventDefault() { this.prevented++; } }; images.dragover(over); assert.equal(over.prevented, 1);
  over = { dataTransfer: { types: ['text/plain'] }, prevented: 0, preventDefault() { this.prevented++; } }; images.dragover(over); assert.equal(over.prevented, 0);
  images.dispose(); images.paste(event('paste', clip([file('image/png', PNG)]))); await settle(); assert.equal(term.out.length, 1);
  assert.deepEqual(pastedImages(clip([file('image/png', PNG)], 'text')).images, []);
  // Cmd/Ctrl+V still reaches the native paste event (v0.34 unchanged).
  assert.equal(terminalKeys({ hasSelection: () => false }, { key: 'v', metaKey: true }), false);
  console.log('terminal image paste: ok');
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
