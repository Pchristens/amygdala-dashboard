// No console flashes on the human's Windows desktop: every process the server starts is launched hidden.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const bin = read('lib/bin.js');
// The shared helpers hide by default (a caller may still pass windowsHide explicitly).
assert.match(bin, /rawSpawn\(c\.file, c\.args, \{ windowsHide: true, \.\.\.opts, shell: false \}\)/);
assert.match(bin, /rawExecFile\(c\.file, c\.args, \{ windowsHide: true, \.\.\.opts, shell: false \}, callback\)/);
// No module launches outside them except conpty, whose own launches pass windowsHide.
const files = ['server.js', ...fs.readdirSync(path.join(root, 'lib')).filter(f => f.endsWith('.js')).map(f => 'lib/' + f)];
for (const f of files) {
  const src = read(f); if (!/from 'node:child_process'/.test(src) || f === 'lib/bin.js') continue;
  assert(f === 'lib/conpty.js' || f === 'server.js', `${f} launches processes outside lib/bin.js`);
  const calls = src.match(/\b(?:rawExec|rawSpawn|execFileSync|spawnSync|execSync)\([^;]*/g) || [];
  for (const c of calls) assert(/windowsHide: true/.test(c), `${f}: ${c.slice(0, 60)} is not hidden`);
}
// And no caller turns it off.
for (const f of files) assert(!/windowsHide: false/.test(read(f)), `${f} shows a window`);
console.log('windows hide ok');
