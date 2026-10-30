// A Claude hero launched into a folder Claude doesn't trust dies at the trust prompt (the task's Enter picks "No, exit").
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { claudeTrusts, diskCase } from '../lib/sites.js';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amygdala-trust-')), file = path.join(dir, '.claude.json');
try {
  fs.writeFileSync(file, JSON.stringify({ projects: { '/home/u/proj': { hasTrustDialogAccepted: true }, '/home/u/no': { hasTrustDialogAccepted: false }, 'C:/Users/U/work': { hasTrustDialogAccepted: true } } }));
  const t = (d, platform = 'linux') => claudeTrusts(d, file, platform);
  assert(t('/home/u/proj') && t('/home/u/proj/') && t('/home/u/proj/sub/deeper'), 'a trusted folder and its children');
  assert(!t('/home/u') && !t('/home/u/no') && !t('/home/u/projX') && !t('/'), 'parents, refused, look-alikes and root are not');
  assert(t('c:\\users\\u\\work\\a', 'win32') && !t('C:\\Users\\U', 'win32'), 'Windows paths, case-insensitive');
  assert(claudeTrusts('/anything', path.join(dir, 'missing.json')), 'no readable config: no worse than before');
  fs.writeFileSync(file, '{ not json'); assert(t('/anything'));
  // A case-insensitive drive (/mnt/c under WSL) accepts any spelling; the launch uses the on-disk one so the trust check matches.
  fs.mkdirSync(path.join(dir, 'Users', 'Ana'), { recursive: true });
  assert.equal(diskCase(path.join(dir, 'users', 'ana').toLowerCase().replace(dir.toLowerCase(), dir)), path.join(dir, 'Users', 'Ana'));
  assert.equal(diskCase(path.join(dir, 'Users', 'nope')), path.join(dir, 'Users', 'nope'), 'a missing name is left alone');
  fs.mkdirSync(path.join(dir, 'real', 'inner'), { recursive: true }); fs.symlinkSync(path.join(dir, 'real', 'inner'), path.join(dir, 'link'));
  assert.equal(diskCase(path.join(dir, 'link') + '/../Users'), path.join(dir, 'link') + '/../Users', "'..' is never folded lexically");
  assert.equal(diskCase('C:\\x', 'win32'), 'C:\\x');
  // The dialog adds a missing leading slash, explains '~mnt', and names the machine that refused the folder.
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert(app.includes("body.path = '/' + body.path") && app.includes('Write ~/ for the home folder') && app.includes("`On ${$('cm-machine').selectedOptions[0]"));
  console.log('commission trust ok');
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
