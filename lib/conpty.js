import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFile as rawExec, spawn as rawSpawn } from 'node:child_process';
import { command } from './bin.js';
const source = fileURLToPath(new URL('../tools/conpty.cs', import.meta.url));
export function terminalReason(platform = process.platform, env = process.env, exists = fs.existsSync) {
  const csc = path.win32.join(env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  return platform === 'win32' && !exists(csc) ? `Windows terminal requires the .NET Framework C# compiler: ${csc}` : null;
}
let building;
export async function conpty() {
  if (building) return building;
  building = (async () => {
    const reason = terminalReason(); if (reason) throw new Error(reason);
    const dir = path.join(process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE, 'AppData', 'Local'), 'Amygdala', 'bin'), exe = path.join(dir, 'conpty.exe'), stamp = exe + '.sha256';
    const hash = crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex');
    if (fs.existsSync(exe) && fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8') === hash) return exe;
    fs.mkdirSync(dir, { recursive: true });
    await new Promise((resolve, reject) => rawExec(path.win32.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'), ['/nologo', '/r:System.Web.Extensions.dll', '/out:' + exe, source], { windowsHide: true, timeout: 60000 }, e => e ? reject(new Error('Could not compile Windows terminal bridge.')) : resolve()));
    fs.writeFileSync(stamp, hash); return exe;
  })();
  try { return await building; } finally { building = null; }
}
export async function spawnConpty(name, args = [], opts = {}) {
  const exe = await conpty(), c = command(name, args);
  return rawSpawn(exe, [c.file, ...c.args], { ...opts, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
}
