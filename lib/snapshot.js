// An offering's view of a hero's work, shared by the server (local heroes) and the node helper (node heroes): the git
// change it is offering, and files at the reviewed commit. Runs only git, in the hero's own project folder.
import { execFile } from './bin.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const MAX_SNAPSHOT = 80 * 1024;
export const SECRET_PATH = /(^|\/)(\.env[^/]*|.*\.(pem|key|p12|pfx|keystore|jks)|id_(rsa|ed25519|ecdsa)[^/]*|\.npmrc|\.netrc|\.pypirc|credentials[^/]*|secrets?[^/]*|\.aws\/|\.ssh\/|\.gnupg\/)$/i;
export const sha = s => crypto.createHash('sha256').update(s).digest('hex');

export function run(cmd, args, opts = {}) {
  return new Promise(resolve => {
    const child = execFile(cmd, args, { timeout: 20000, maxBuffer: 4 << 20, ...opts }, (err, stdout, stderr) => resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') }));
    if (opts.input != null) child.stdin.end(opts.input);
  });
}

// Tracked secret files are left out of what reviewers see, by literal pathspec as in the release diff (v0.60).
const hideSecrets = names => { const s = names.split('\0').filter(f => f && SECRET_PATH.test(f)).map(f => `:(top,exclude,literal)${f}`); return s.length ? ['--', ':(top)', ...s] : []; };

// With a commit, that commit alone: a hero's finished work stays reviewable after others commit on top of it.
export async function snapshotOf(dir, commit) {
  const g = (...a) => run('git', ['-C', dir, ...a]);
  if ((await g('rev-parse', '--is-inside-work-tree')).err) throw new Error('That project is not a git repository, so there is no change to review.');
  // Listed again afterwards: a secret file changed between the two git calls must not slip through.
  const secretless = async (names, ...a) => {
    const list = async () => { const n = await g(...names, '--name-only', '--no-renames', '-z'); return n.err ? null : hideSecrets(n.stdout); };
    const ex = await list(); if (!ex) return '';
    const out = (await g(...a, ...ex)).stdout;
    if (String(await list()) !== String(ex)) throw new Error('The work changed while it was being offered; try again.');
    return out;
  };
  const show = c => secretless(['show', c, '--format='], 'show', c, '--no-color', '--format=commit %H%n%s%n', '--patch');
  if (commit != null) {
    const c = /^[0-9a-f]{7,64}$/i.test(String(commit)) && (await g('rev-parse', '--verify', '--quiet', `${commit}^{commit}`)).stdout.trim();
    if (!c) throw new Error('No such commit in that project.');
    return { head: c, kind: 'commit', diff: await show(c) };
  }
  const head = (await g('rev-parse', 'HEAD')).stdout.trim();
  let kind = 'working changes', diff = await secretless(['diff', 'HEAD'], 'diff', 'HEAD', '--no-color', '--no-ext-diff');
  const untracked = (await g('ls-files', '--others', '--exclude-standard')).stdout.trim().split('\n').filter(f => f && !SECRET_PATH.test(f));
  for (const f of untracked.slice(0, 20)) diff += (await g('diff', '--no-index', '--no-color', '/dev/null', f)).stdout;
  if (!diff.trim()) { kind = 'last commit'; diff = await show('HEAD'); }
  return { head, kind, diff };
}

// What an offering keeps of a diff: the first MAX_SNAPSHOT characters, the hash and file list of the whole change.
export function digest(diff) {
  const kept = diff.slice(0, MAX_SNAPSHOT), files = d => [...new Set([...d.matchAll(/^\+\+\+ b\/(.+)$/gm)].map(m => m[1]))];
  return { kept, hash: sha(diff), allFiles: files(diff).slice(0, 500), files: files(kept), truncated: diff.length > MAX_SNAPSHOT };
}

export function safeRel(file) {
  const rel = String(file || '').replace(/^\.\/+/, '');
  if (!rel || rel.length > 1024 || rel.includes('\\') || /^[A-Za-z]:/.test(rel) || rel.startsWith('/') || rel.split('/').includes('..') || SECRET_PATH.test(rel)) throw new Error('That path is not readable.');
  return rel;
}

// Lines start..end (1-based, at most 800) of a file at a commit, with the file's line count.
export async function commitLines(dir, commit, file, start = 1, end = 400) {
  const rel = safeRel(file);
  if (!/^[0-9a-f]{7,64}$/i.test(String(commit))) throw new Error('No such file in that commit.');
  const r = await run('git', ['-C', dir, 'show', `${commit}:${rel}`], { maxBuffer: 2 << 20 });
  if (r.err) throw new Error('No such file in that commit.');
  const lines = r.stdout.split('\n'), a = Math.max(1, +start || 1), b = Math.min(lines.length, Math.max(a, +end || a + 399), a + 799);
  return { rel, a, b, total: lines.length, lines: lines.slice(a - 1, b) };
}

// Evidence checked against both the reviewed commit and the current working file.
export async function fixView(dir, commit, file, evidence) {
  const rel = safeRel(file);
  if (SECRET_PATH.test(rel)) throw new Error('That path is not readable.');
  if (!/^[0-9a-f]{7,64}$/i.test(String(commit))) throw new Error('No such file in that commit.');
  const g = (...args) => run('git', ['-C', dir, ...args]);
  const diffResult = await g('diff', '--no-color', '--no-ext-diff', String(commit), '--', rel);
  const committed = await g('show', `HEAD:${rel}`);
  const work = await g('diff', '--no-color', 'HEAD', '--', rel);
  const head = await g('rev-parse', 'HEAD');
  const fp = path.resolve(dir, rel), root = path.resolve(dir) + path.sep;
  let inside = fp.startsWith(root), exists = false;
  try { const real = fs.realpathSync(fp), realRoot = fs.realpathSync(dir) + path.sep; inside = inside && real.startsWith(realRoot); exists = inside; } catch {}
  const norm = s => String(s ?? '').replace(/\s+/g, ' ');
  const ev = norm(String(evidence).replace(/^[+\- ]/gm, ''));
  const diff = diffResult.err ? '' : diffResult.stdout;
  return { head: head.err ? null : head.stdout.trim(), changedSinceSnapshot: !!diff.trim(), diff: diff.slice(0, 40000),
    evidenceStillInCommittedFile: committed.err ? null : norm(committed.stdout).includes(ev),
    evidenceStillInWorkingFile: !exists ? null : norm(fs.readFileSync(fp, 'utf8')).includes(ev),
    uncommittedChanges: !work.err && !!work.stdout.trim() };
}
