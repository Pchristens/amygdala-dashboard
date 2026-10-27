// Shell-free executable resolution. npm's Windows shims are data, never shell commands.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { promisify } from 'node:util';
import { spawn as rawSpawn, execFile as rawExecFile } from 'node:child_process';

export const env = (name, source = process.env) => source['AMYGDALA_' + name] ?? source['HEARTHFIELD_' + name];

export const hostOs = (platform = process.platform) => ({ darwin: 'macos', win32: 'windows', linux: 'linux' }[platform] || null);
export function buildPath({ platform = process.platform, env = process.env, home = os.homedir(), unix = ['/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'] } = {}) {
  const delimiter = platform === 'win32' ? ';' : path.delimiter;
  return [...new Set([...(platform === 'win32' ? [] : [path.join(home, '.local/bin'), ...unix]), ...(env.PATH || env.Path || '').split(delimiter).filter(Boolean)])].join(delimiter);
}
export function bin(name, { platform = process.platform, env: source = process.env, home = os.homedir() } = {}) {
  const key = { 'agent-deck': 'AGENT_DECK', tmux: 'TMUX' }[name];
  name = key && env(key, source) || name;
  if (platform !== 'win32') { const local = path.join(home, '.local/bin', name); return fs.existsSync(local) ? local : name; }
  const dirs = /[\\/]/.test(name) ? [''] : (source.PATH || source.Path || '').split(';').filter(Boolean);
  const extensions = path.extname(name) ? [''] : ['', ...(source.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';')];
  for (const dir of dirs) for (const ext of extensions) for (const suffix of new Set([ext, ext.toLowerCase()])) {
    const file = dir ? path.join(dir.replace(/^"|"$/g, ''), name + suffix) : name + suffix;
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return file;
  }
  throw new Error(`Executable not found on PATH: ${name}`);
}
export function command(name, args = [], options = {}) {
  const platform = options.platform || process.platform, file = bin(name, options);
  if (platform !== 'win32' || !/\.(cmd|bat)$/i.test(file)) return { file, args };
  const shim = fs.readFileSync(file, 'utf8');
  const match = shim.match(/"%_prog%"\s+"%(?:dp0|~dp0)%?[\\/]([^"\r\n]+\.(?:c?js|mjs))"\s+%\*/i);
  if (!match) throw new Error(`Cannot safely resolve npm shim: ${file}; install a native executable or standard npm shim (shell fallback is disabled).`);
  const entry = path.resolve(path.dirname(file), ...match[1].split(/[\\/]/));
  if (!fs.existsSync(entry)) throw new Error(`npm shim entry is missing: ${file}`);
  const adjacent = path.join(path.dirname(file), 'node.exe');
  const node = fs.existsSync(adjacent) ? adjacent : bin('node.exe', options);
  return { file: node, args: [entry, ...args] };
}
let deckWarned = false;
export function deckAvailable() {
  if (env('NO_DECK')) return false;
  let available = false;
  try { const file = bin('agent-deck'); available = process.platform === 'win32' ? !!file : file !== 'agent-deck' || buildPath().split(path.delimiter).some(d => fs.existsSync(path.join(d, file))); } catch {}
  if (!available && !deckWarned) { deckWarned = true; console.warn('agent-deck unavailable: session sync, commissions, wrap-up and deck usage are disabled.'); }
  return available;
}
export const commissionReason = 'Sessions cannot be launched from this host: agent-deck is unavailable.';
export function spawn(name, args, opts = {}) { const c = command(name, args, { env: opts.env || process.env }); return rawSpawn(c.file, c.args, { ...opts, shell: false }); }
export function execFile(name, args, opts, callback) {
  if (typeof opts === 'function') { callback = opts; opts = {}; }
  try { const c = command(name, args, { env: opts?.env || process.env }); return rawExecFile(c.file, c.args, { ...opts, shell: false }, callback); }
  catch (err) { const stdin = new PassThrough(); stdin.resume(); queueMicrotask(() => { stdin.destroy(); callback?.(err, '', ''); }); return { stdin }; }
}
export function killTree(child, signal = 'SIGKILL') {
  if (!child?.pid) return;
  if (process.platform === 'win32') { rawExecFile('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {}); return; }
  try { process.kill(-child.pid, signal); } catch { try { child.kill(signal); } catch {} }
}
export function refreshAuth(source, target, platform = process.platform) {
  if (platform !== 'win32') { if (!fs.existsSync(target)) try { fs.symlinkSync(source, target); } catch {} return; }
  if (!fs.existsSync(source)) return;
  if (!fs.existsSync(target)) try { fs.linkSync(source, target); return; } catch {}
  if (!fs.existsSync(target) || fs.statSync(source).mtimeMs > fs.statSync(target).mtimeMs) fs.copyFileSync(source, target);
}

execFile[promisify.custom] = (name, args, opts) => new Promise((resolve, reject) => execFile(name, args, opts, (err, stdout, stderr) => err ? reject(err) : resolve({ stdout, stderr })));
