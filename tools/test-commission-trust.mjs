// A Claude hero launched into a folder Claude doesn't trust dies at the trust prompt (the task's Enter picks "No, exit").
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { claudeTrusts } from '../lib/sites.js';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amygdala-trust-')), file = path.join(dir, '.claude.json');
try {
  fs.writeFileSync(file, JSON.stringify({ projects: { '/home/u/proj': { hasTrustDialogAccepted: true }, '/home/u/no': { hasTrustDialogAccepted: false }, 'C:/Users/U/work': { hasTrustDialogAccepted: true } } }));
  const t = (d, platform = 'linux') => claudeTrusts(d, file, platform);
  assert(t('/home/u/proj') && t('/home/u/proj/') && t('/home/u/proj/sub/deeper'), 'a trusted folder and its children');
  assert(!t('/home/u') && !t('/home/u/no') && !t('/home/u/projX') && !t('/'), 'parents, refused, look-alikes and root are not');
  assert(t('c:\\users\\u\\work\\a', 'win32') && !t('C:\\Users\\U', 'win32'), 'Windows paths, case-insensitive');
  assert(claudeTrusts('/anything', path.join(dir, 'missing.json')), 'no readable config: no worse than before');
  fs.writeFileSync(file, '{ not json'); assert(t('/anything'));
  console.log('commission trust ok');
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
