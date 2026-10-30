// Only a verified commit and a small label leave the transcript's machine.
import fs from 'node:fs';
import { promisify } from 'node:util';
import { execFile } from './bin.js';
import { transcriptTail } from './sites.js';
import { scanAllowed } from './hero-apprentices.js';
const exec = promisify(execFile);
export const cleanMilestoneName = s => String(s || '').replace(/[^A-Za-z0-9 .,!:;()_\/'"-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
export function milestoneOf(text) {
  const lines = String(text || '').split('\n\n---\n\n').at(-1).split(/\r?\n/); let found = null;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/\bmilestone\b|\b(?:phase|stage)\s+\d+\b[^\n]*?\b(?:complete|done|finished)\b/i); if (!m) continue;
    const hash = lines.slice(i, i + 3).join('\n').match(/\b[0-9a-f]{7,40}\b/i); if (!hash) continue;
    const label = lines[i].slice(m.index).split(/\s*[—–]|\bcommit\b|\b[0-9a-f]{7,40}\b/i)[0].replace(/[\s:(*-]+$/, '');
    found = { sha: hash[0].toLowerCase(), name: /^milestone$/i.test(label) ? '' : cleanMilestoneName(label) };
  }
  return found;
}
export async function verifyCommit(dir, sha) {
  if (!dir || !/^[0-9a-f]{7,40}$/i.test(sha)) return false;
  try { await exec('git', ['-C', dir, 'cat-file', '-e', `${sha}^{commit}`], { timeout: 5000 }); const { stdout } = await exec('git', ['-C', dir, 'rev-parse', `${sha}^{commit}`], { timeout: 5000 }); return /^[0-9a-f]{40}$/.test(stdout.trim()) ? stdout.trim() : false; } catch { return false; }
}
export class MilestoneScanner {
  constructor() { this.cache = new Map(); }
  async scan(w, confirmed) {
    if (!scanAllowed(w, confirmed) || w.host !== 'local' || w.archived || w.stale || !w.transcriptPath) { this.cache.delete(w?.id); return null; }
    if (!['waiting', 'idle'].includes(w.status)) return null;
    try {
      const mtime = fs.statSync(w.transcriptPath).mtimeMs, old = this.cache.get(w.id);
      if (old?.mtime === mtime && old.file === w.transcriptPath && old.dir === w.path) return old.milestone;
      const report = milestoneOf(transcriptTail(w.transcriptPath, 4000)), sha = report && await verifyCommit(w.path, report.sha), milestone = sha ? { sha, name: report.name } : null;
      this.cache.set(w.id, { mtime, file: w.transcriptPath, dir: w.path, milestone }); return milestone;
    } catch { this.cache.delete(w.id); return null; }
  }
  retain(ids) { for (const id of this.cache.keys()) if (!ids.includes(id)) this.cache.delete(id); }
}
