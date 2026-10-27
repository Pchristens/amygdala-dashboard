// The Tablet of Omens: an append-only, hash-chained record of every omen event, inscribed in Linear B.
// Unlike the isle's Linear A (undeciphered, i.e. sealed), Linear B can be read: every inscription is a reversible
// encoding of its entry's hash, so the human can dig from glyphs → hash → recorded finding → the exact lines in the
// reviewed snapshot → the change the hero actually made since. Editing any recorded entry breaks the chain visibly.
import { execFile } from './bin.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const z = x => x?.zone ?? 'village';

// 64 assigned Linear B syllabograms (U+10000–1005D has gaps) → one glyph per 6 bits.
const GLYPHS = [];
for (let cp = 0x10000; GLYPHS.length < 64; cp++) if (![0x1000c, 0x10027, 0x1003b, 0x1003e, 0x1004e, 0x1004f].includes(cp)) GLYPHS.push(String.fromCodePoint(cp));
const INDEX = new Map(GLYPHS.map((g, i) => [g, i]));

export function inscribe(hex) {
  const bits = [...Buffer.from(hex, 'hex')].map(b => b.toString(2).padStart(8, '0')).join('');
  const out = [];
  for (let i = 0; i < bits.length; i += 6) out.push(GLYPHS[parseInt(bits.slice(i, i + 6).padEnd(6, '0'), 2)]);
  return out.join('');
}
export function decipher(glyphs, bytes = 32) {
  const bits = Array.from(glyphs).map(g => { const v = INDEX.get(g); if (v == null) throw new Error('not a tablet glyph'); return v.toString(2).padStart(6, '0'); }).join('');
  return Buffer.from(Array.from({ length: bytes }, (_, i) => parseInt(bits.slice(i * 8, i * 8 + 8), 2))).toString('hex');
}

function git(dir, args) {
  return new Promise(res => execFile('git', ['-C', dir, ...args], { timeout: 20000, maxBuffer: 4 << 20 }, (err, out) => res(err ? null : String(out))));
}

// The facts an entry commits to. Free-form prose is included so later edits are detectable, but stays data.
function record(f, o, event) {
  return JSON.stringify({
    event, zone: z(f), finding: f.id, offering: o.id, project: o.project, kind: o.kind, commit: o.headCommit || null, diffHash: o.diffHash,
    file: f.file, line: f.line, severity: f.severity, claim: f.claim, scenario: f.scenario, evidence: f.evidence, reviewer: f.reviewer, provider: f.provider,
    seconds: f.seconds.map(s => [s.by, s.provider, s.note]), disputes: f.disputes.map(d => [d.by, d.provider, d.kind, d.note]),
    verdict: f.verdict ? [f.verdict.by, f.verdict.verdict, f.verdict.reasoning] : null,
    delivery: f.delivery?.state === 'queued' || f.delivery?.state === 'landed' ? [f.delivery.state, f.delivery.sendId || null] : null,
  });
}

export class Tablet {
  constructor(world) { this.w = world; world.s.tablet ??= []; }
  entries(zone) { return this.w.s.tablet.filter(e => z(e) === zone); }

  // Append an event for a finding (omen formed, decreed, rejected, insufficient_evidence, delivered, fixed).
  inscribeEvent(f, event) {
    if (z(f) === 'isle' && this.w.seal?.locked) return;
    const o = this.w.temple.get(f.offeringId);
    const rec = record(f, o, event), recordHash = sha(rec);
    const prev = this.entries(z(f)).at(-1)?.hash ?? '0'.repeat(64);
    const hash = sha(prev + recordHash);
    const e = { id: this.w.id('tb'), zone: z(f), findingId: f.id, event, record: rec, recordHash, prev, hash, inscription: inscribe(hash), ts: Date.now() };
    this.w.s.tablet.push(e);
    f.inscription = e.inscription;
    this.w.changed();
    return e;
  }

  // Recompute the whole chain for a zone; report the first break.
  verify(zone) {
    let prev = '0'.repeat(64);
    for (const [i, e] of this.entries(zone).entries()) {
      if (e.prev !== prev) return { ok: false, at: i, id: e.id, reason: 'chain link does not match the previous entry' };
      if (sha(e.record) !== e.recordHash) return { ok: false, at: i, id: e.id, reason: 'recorded content was altered' };
      if (sha(prev + e.recordHash) !== e.hash || inscribe(e.hash) !== e.inscription) return { ok: false, at: i, id: e.id, reason: 'inscription does not match its content' };
      prev = e.hash;
    }
    return { ok: true, entries: this.entries(zone).length, head: prev };
  }

  // Dig into an omen: every layer from the glyphs down to the code.
  async trail(findingId) {
    const f = this.w.s.findings.find(x => x.id === findingId);
    if (!f) throw new Error('No such omen.');
    if (z(f) === 'isle') this.w.assertOpen('isle');
    const o = this.w.temple.get(f.offeringId);
    const entries = this.entries(z(f)).filter(e => e.findingId === f.id);
    const latest = entries.at(-1);
    const chain = this.verify(z(f));
    // Does the live finding still say what the tablet recorded?
    const drift = latest ? (() => { const now = JSON.parse(record(f, o, latest.event)), was = JSON.parse(latest.record);
      return Object.keys(was).filter(k => k !== 'delivery' && JSON.stringify(was[k]) !== JSON.stringify(now[k])); })() : [];

    // Locate the evidence in the reviewed snapshot (file-relative new-side line numbers from the hunk headers).
    const snap = this.w.temple.readSnapshot(o);
    const located = locate(snap, f.file, f.evidence, o.kind);

    // The hero's answer: what changed in that file since the reviewed snapshot, and is the evidence still there?
    let answer = null;
    if (o.kind !== 'scroll' && o.path && o.headCommit) {
      const diff = await git(o.path, ['diff', '--no-color', '--no-ext-diff', o.headCommit, '--', f.file]);
      const current = await git(o.path, ['show', `HEAD:${f.file}`]);
      const work = await git(o.path, ['diff', '--no-color', 'HEAD', '--', f.file]);
      const head = (await git(o.path, ['rev-parse', 'HEAD']))?.trim() ?? null;
      const norm = s => String(s ?? '').replace(/\s+/g, ' ');
      const ev = norm(String(f.evidence).replace(/^[+\- ]/gm, ''));
      answer = {
        headNow: head, snapshotCommit: o.headCommit,
        changedSinceSnapshot: !!(diff && diff.trim()), diff: diff ? diff.slice(0, 40000) : '',
        evidenceStillInCommittedFile: current == null ? null : norm(current).includes(ev),
        evidenceStillInWorkingFile: (() => { const fp = path.join(o.path, f.file); if (!fp.startsWith(o.path + path.sep) || !fs.existsSync(fp)) return null; return norm(fs.readFileSync(fp, 'utf8')).includes(ev); })(),
        uncommittedChanges: !!(work && work.trim()),
      };
    }
    return {
      finding: f.id, status: f.status, zone: z(f),
      inscription: latest?.inscription ?? null,
      deciphered: latest ? decipher(latest.inscription) : null,         // = entry hash
      entries: entries.map(e => ({ id: e.id, event: e.event, ts: e.ts, inscription: e.inscription, hash: e.hash, prev: e.prev, recordHash: e.recordHash, record: JSON.parse(e.record) })),
      chain, drift,
      snapshot: { offering: o.id, kind: o.kind, commit: o.headCommit || null, diffHash: o.diffHash, file: f.file, ...located },
      answer,
    };
  }
}

// Find the quoted evidence inside the snapshot, returning the surrounding hunk with real line numbers.
function locate(snap, file, evidence, kind) {
  const norm = s => String(s).replace(/^[+\- ]/, '').replace(/\s+/g, ' ').trim();
  const want = String(evidence).split('\n').map(norm).filter(Boolean);
  if (!want.length) return { found: false };
  const lines = snap.split('\n');
  let inFile = kind === 'scroll', newLine = 0, hunk = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith('+++ ')) { inFile = l.slice(4).replace(/^b\//, '') === file; continue; }
    const h = l.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (h) { newLine = +h[1]; hunk = i; continue; }
    if (!inFile) continue;
    if (norm(l) && norm(l).includes(want[0]) || want[0].includes(norm(l)) && norm(l).length > 8) {
      const at = newLine;
      const from = Math.max(hunk ?? 0, i - 6), to = Math.min(lines.length, i + want.length + 6);
      return { found: true, line: at, excerpt: lines.slice(from, to).join('\n') };
    }
    if (!l.startsWith('-')) newLine++;
  }
  return { found: false };
}
