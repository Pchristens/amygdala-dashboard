// Prefer explicit overrides, then this machine's local install, then PATH.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function bin(name) {
  const key = { 'agent-deck': 'HEARTHFIELD_AGENT_DECK', tmux: 'HEARTHFIELD_TMUX' }[name];
  if (key && process.env[key]) return process.env[key];
  const local = path.join(os.homedir(), '.local/bin', name);
  return fs.existsSync(local) ? local : name;
}
