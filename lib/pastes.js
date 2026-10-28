// Images pasted into a hero terminal land on the hero's own machine, where its CLI attaches them by path.
// Shared by the server (local heroes) and the node helper (node heroes). Image bytes are never logged.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export const IMAGE_TYPES = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' };
export const IMAGE_MAX = 8 << 20;
export const IMAGE_B64_MAX = Math.ceil(IMAGE_MAX / 3) * 4;
const KEEP = 24 * 3600000, NAME = /^[0-9a-f]{32}\.(png|jpg|gif|webp)$/;
const MAGIC = {
  'image/png': b => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/jpeg': b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/gif': b => ['GIF87a', 'GIF89a'].includes(b.subarray(0, 6).toString('latin1')),
  'image/webp': b => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
};

// The declared type must match the bytes; base64 must be canonical (a round trip, no regex over megabytes).
export function decodeImage(type, d) {
  if (typeof type !== 'string' || !Object.hasOwn(IMAGE_TYPES, type)) throw new Error('Only PNG, JPEG, GIF or WebP images can be pasted.');
  if (typeof d !== 'string' || !d.length || d.length > IMAGE_B64_MAX) throw new Error('Images can be at most 8 MiB.');
  const buf = Buffer.from(d, 'base64');
  if (buf.toString('base64') !== d) throw new Error('Invalid image data.');
  if (buf.length > IMAGE_MAX) throw new Error('Images can be at most 8 MiB.');
  if (!MAGIC[type](buf)) throw new Error('That file is not the image type it claims to be.');
  return buf;
}

export function pasteDir({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  if (platform === 'win32') return path.win32.join(env.LOCALAPPDATA || path.win32.join(home, 'AppData', 'Local'), 'Amygdala', 'pastes');
  return path.posix.join(home, '.cache', 'amygdala', 'pastes');
}

// Private folder (0700), private file (0600), random name; our own files older than a day are pruned on each write.
export function savePaste(buf, type, { dir = pasteDir(), now = Date.now() } = {}) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const st = fs.lstatSync(dir);
  if (!st.isDirectory() || st.isSymbolicLink()) throw new Error('Paste folder is not a directory.');
  if (process.platform !== 'win32') fs.chmodSync(dir, 0o700);
  for (const name of fs.readdirSync(dir)) {
    if (!NAME.test(name)) continue;
    try { const f = path.join(dir, name), s = fs.lstatSync(f); if (s.isFile() && now - s.mtimeMs > KEEP) fs.unlinkSync(f); } catch {}
  }
  const file = path.join(dir, crypto.randomBytes(16).toString('hex') + IMAGE_TYPES[type]);
  fs.writeFileSync(file, buf, { mode: 0o600, flag: 'wx' });
  return file;
}

// What a node may return as the saved path: absolute, ours by name, nothing a terminal could misread.
export const pastePathOk = p => typeof p === 'string' && p.length < 1024 && !/[\0-\x1f\x7f]/.test(p) && (p.startsWith('/') || /^[A-Za-z]:\\/.test(p)) && NAME.test(p.split(/[\\/]/).at(-1));
