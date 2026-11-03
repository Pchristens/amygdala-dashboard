// The Watchtower's permanent log (v0.89): append-only, hash-chained, village only, read by the human page alone.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Watchtower, validAuditHit } from '../lib/audit.js';
import { AuditLog } from '../lib/auditlog.js';
import { World } from '../lib/world.js';
import { Usage } from '../lib/usage.js';
Usage.prototype.pollDeck = () => {}; Usage.prototype.probe = () => {};
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-log-test-')); let w;
try {
  const file = path.join(dir, 'audit-log.jsonl'), lines = () => fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
  const hero = { id: 'local:h', sessionId: 'h', host: 'local', zone: 'village', tool: 'claude', path: '/project', title: 'Synthetic hero', project: 'fixture', status: 'running' };
  w = new World(dir, [{ name: 'Examiner', role: 'examiner', agent: 'codex', model: 'gpt-6-luna' }, { name: 'Smith', role: 'smith', agent: 'codex', model: 'gpt-6.1-terra' }], path.join(dir, 'residents.json')); w.workers = [hero]; w.s.paused = false;
  let verdict = 'benign'; const calls = [], c = { pressureBlocked: () => false, isolatedRuns: 0, setAgyUrl() {} };
  // A stub runner: no model CLI is ever called.
  const tower = w.watchtower = new Watchtower(w, c, { start: false, runner: async r => { calls.push(r.name); return { answer: JSON.stringify({ verdict, escalate: false, summary: `Synthetic ${verdict}` }) }; } });
  const hit = (rule, severity, excerpt) => ({ heroId: 'h', rule, severity, ts: Date.now(), excerpt });

  // 1000 characters validate; 1001 are refused; an old node's 300 still pass.
  for (const n of [300, 1000]) assert(validAuditHit(hit('sudo', 'critical', 'x'.repeat(n))), String(n));
  assert(!validAuditHit(hit('sudo', 'critical', 'x'.repeat(1001))));
  // A long excerpt is kept whole (up to 1000), redacted over its whole span.
  const secret = 'sk-' + 'q'.repeat(30), long = 'git push origin feature ' + 'word '.repeat(120) + ' ' + secret;
  tower.accept(hero, [hit('push', 'high', long)]); const first = w.s.audits.at(-1);
  assert(first.excerpt.length > 300 && first.excerpt.length <= 1000); assert(!first.excerpt.includes(secret)); assert(first.excerpt.includes('[redacted]'));
  let log = lines(); assert.equal(log.length, 1); assert.equal(log[0].kind, 'hit'); assert.equal(log[0].auditId, first.id); assert.equal(log[0].excerpt, first.excerpt, 'logged exactly as stored'); assert.equal(log[0].heroTitle, 'Synthetic hero'); assert.equal(log[0].status, 'pending'); assert.equal(log[0].prev, '');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  // A first look, then a critical hit that rings and goes straight to the escalation reviewer.
  await tower.tick(1000000); assert.deepEqual(calls, ['Examiner']);
  tower.accept(hero, [hit('sudo', 'critical', 'sudo rm thing')]); const crit = w.s.audits.at(-1);
  verdict = 'dangerous'; await tower.tick(1700000); assert.deepEqual(calls, ['Examiner', 'Smith']);
  log = lines();
  const v1 = log.find(e => e.kind === 'verdict' && e.auditIds.includes(first.id)); assert.equal(v1.reviewer, 'Examiner'); assert.equal(v1.verdict, 'benign'); assert.equal(v1.tier, 1); assert.equal(v1.offeringId, w.s.offerings.find(o => o.auditIds.includes(first.id)).id);
  const v2 = log.find(e => e.kind === 'verdict' && e.auditIds.includes(crit.id)); assert.equal(v2.reviewer, 'Smith'); assert.equal(v2.verdict, 'dangerous'); assert.equal(v2.tier, 2);
  const bells = log.filter(e => e.kind === 'bell'); assert(bells.some(b => b.severity === 'urgent' && b.auditIds.includes(crit.id))); assert(!bells.some(b => b.severity === 'attention'), 'the hourly bell limit holds; the log records only bells that rang');
  for (let i = 1; i < log.length; i++) { assert.equal(log[i].seq, i + 1); assert.equal(log[i].prev, log[i - 1].hash); }
  assert.equal(tower.log.verify(), true);
  // An escalation and its resolution: a tier-one "dangerous" waits for the strong reviewer, which then answers.
  const saved = tower.reviewer; tower.reviewer = tier => tier === 'tier2' ? null : saved.call(tower, tier);
  verdict = 'dangerous'; tower.accept(hero, [hit('pull-request', 'high', 'gh pr merge 7')]); const pr = w.s.audits.at(-1); await tower.tick(2400000);
  assert(lines().some(e => e.kind === 'escalation' && e.state === 'pending' && e.auditIds.includes(pr.id)));
  tower.reviewer = saved; await tower.tick(3100000); assert(lines().some(e => e.kind === 'escalation' && e.state === 'resolved' && e.auditIds.includes(pr.id)));
  // Settings and opt-outs record who changed what.
  tower.settings({ dailyCap: 30 }, 'steward'); tower.settings({ heroId: hero.id, optOut: true }); tower.settings({ heroId: hero.id, optOut: false });
  log = lines(); assert.deepEqual(log.filter(e => e.kind === 'settings').at(-1).changes, { dailyCap: 30 }); assert.equal(log.filter(e => e.kind === 'settings').at(-1).who, 'steward');
  assert.deepEqual(log.filter(e => e.kind === 'optout').map(e => [e.optOut, e.who]), [[true, 'human'], [false, 'human']]);

  // Isle, tagged, quarantined, sealed and private heroes never reach the log, even when handed to it directly.
  const before = fs.readFileSync(file, 'utf8');
  for (const flags of [{ zone: 'isle' }, { isleTagged: true }, { quarantined: true }, { sealed: true }, { private: true }, { zone: undefined }]) {
    const h = { ...hero, ...flags, id: 'local:x', title: 'ISLE_SECRET_TITLE' }, a = { id: 'au-x', rule: 'sudo', severity: 'critical', ts: 1, excerpt: 'ISLE_SECRET_EXCERPT', status: 'pending' };
    assert.equal(tower.log.hit(h, a), null); assert.equal(tower.log.verdict(h, 'of', ['au-x'], { reviewer: 'Smith', verdict: 'benign', escalate: false, summary: 'x' }, 1), null);
    assert.equal(tower.log.bell(h, { id: 9, severity: 'urgent' }, ['au-x'], 'sudo'), null); assert.equal(tower.log.escalation(h, 'of', ['au-x'], true), null); assert.equal(tower.log.optout(h, 'human', true), null);
    w.workers = [hero, h]; tower.accept(h, [hit('sudo', 'critical', 'ISLE_SECRET_EXCERPT')]); tower.ring(h, 'sudo', 'urgent', ['au-x']); w.workers = [hero];
  }
  assert.equal(fs.readFileSync(file, 'utf8'), before); assert(!before.includes('ISLE_SECRET'));

  // The working-state cap of 1000 drops no log entries.
  const hitsBefore = lines().filter(e => e.kind === 'hit').length;
  for (let i = 0; i < 1005; i++) { tower.limits.heroes.clear(); tower.accept(hero, [hit('push', 'high', `git push origin feature-${i}`)]); }
  assert.equal(w.s.audits.length, 1000); assert.equal(lines().filter(e => e.kind === 'hit').length, hitsBefore + 1005); assert.equal(tower.log.verify(), true);

  // A restart continues the chain from the tail.
  const last = lines().at(-1), again = new AuditLog(dir); assert.equal(again.seq, last.seq); assert.equal(again.last, last.hash);
  const next = again.append('settings', { who: 'human', changes: { enabled: true } }); assert.equal(next.seq, last.seq + 1); assert.equal(next.prev, last.hash); assert.equal(again.verify(), true);

  // GET: filters, paging and the hit-verdict-bell join.
  const q = p => tower.log.query(p);
  const sudo = q({ rule: 'sudo' }); assert.equal(sudo.verified, true); assert.equal(sudo.entries.length, 1); const row = sudo.entries[0];
  assert.equal(row.auditId, crit.id); assert.deepEqual(row.verdicts.map(v => v.reviewer), ['Smith']); assert.deepEqual(row.bells.map(b => b.severity), ['urgent']); assert.deepEqual(q({ rule: 'pull-request' }).entries[0].bells.map(b => b.severity), ['attention']); assert(!('hash' in row) && !('prev' in row));
  assert.equal(q({ q: 'feature-1004' }).entries[0].excerpt, 'git push origin feature-1004');
  assert.equal(q({ q: 'feature-1004' }).entries.length, 1); assert.equal(q({ q: 'Synthetic benign' }).entries[0].auditId, first.id, 'text search reaches the verdict');
  assert(q({ severity: 'critical' }).entries.every(e => e.severity === 'critical')); assert(q({ hero: 'synthetic' }).entries.length > 0); assert.equal(q({ hero: 'nobody' }).entries.length, 0);
  assert.equal(q({ since: Date.now() + 60000 }).entries.length, 0); assert.equal(q({ until: 0 }).entries.length, 0); assert(q({ since: new Date(Date.now() - 3600000).toISOString() }).entries.length > 0);
  const page1 = q({ limit: 500, rule: 'push' }); assert.equal(page1.entries.length, 200, 'at most 200 a page'); assert(page1.next);
  for (let i = 1; i < page1.entries.length; i++) assert(page1.entries[i].seq < page1.entries[i - 1].seq, 'newest first');
  const page2 = q({ limit: 200, rule: 'push', before: page1.next }); assert(page2.entries[0].seq < page1.entries.at(-1).seq);
  let seen = 0, cursor; do { const pg = q({ rule: 'push', limit: 200, before: cursor }); seen += pg.entries.length; cursor = pg.next; } while (cursor); assert.equal(seen, 1006);
  assert(q({}).entries.some(e => e.kind === 'settings')); assert(q({ rule: 'push' }).entries.every(e => e.kind === 'hit'));

  // Tampering with one line breaks the chain, and the check notices even after it was cached.
  const text = fs.readFileSync(file, 'utf8'), tampered = text.replace('git push origin feature-500', 'git push origin feature-5OO');
  assert.notEqual(tampered, text); fs.writeFileSync(file, tampered); assert.equal(new AuditLog(dir).verify(), false);
  assert.equal(q({}).verified, false); fs.writeFileSync(file, text + '\n'); assert.equal(tower.log.verify(), false, 'a stray line is not a valid entry');
  fs.writeFileSync(file, text); assert.equal(new AuditLog(dir).verify(), true);
  const deleted = text.split('\n'); deleted.splice(3, 1); fs.writeFileSync(file, deleted.join('\n')); assert.equal(new AuditLog(dir).verify(), false, 'a removed line breaks it'); fs.writeFileSync(file, text);
  // A crash mid-append leaves a torn last line: it fails until the chain picks up after it on a line of its own; a line made unreadable in the middle still breaks the chain.
  fs.writeFileSync(file, text + '{"seq":99999,"kind":"hi'); assert.equal(new AuditLog(dir).verify(), false, 'a torn final line fails');
  const healed = new AuditLog(dir), after = healed.append('settings', { who: 'human', changes: { enabled: true } }); assert.equal(after.prev, JSON.parse(text.trim().split('\n').at(-1)).hash);
  const lines2 = fs.readFileSync(file, 'utf8').split('\n'); assert.equal(JSON.parse(lines2.at(-2)).seq, after.seq, 'the next entry starts on its own line'); assert.equal(healed.verify(), true, 'the chain continues past the torn line');
  const broken = text.split('\n'); broken[3] = broken[3].slice(0, 20); fs.writeFileSync(file, broken.join('\n')); assert.equal(new AuditLog(dir).verify(), false, 'an unreadable middle line breaks the chain'); fs.writeFileSync(file, text);

  // The human page only: the route sits behind the page token, the gate never routes /api/, and no snapshot carries the log.
  const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const token = server.indexOf("if (p.startsWith('/api/') && !tokenOk(req, url)) return json(res, 401"), route = server.indexOf("p === '/api/audit/log'");
  assert(token > 0 && route > token, 'the log route follows the page-token check');
  const gate = server.slice(server.indexOf('function openGate()')); assert(!gate.includes('/api/audit'), 'the gate has no audit route'); assert(!/startsWith\('\/api\/'\)/.test(gate), 'the gate never routes /api/');
  assert.match(server, /'POST \/api\/audit\/settings': \(b, req\) => world\.watchtower\.settings\(b, actorOf\(req\)\)/);
  assert(!JSON.stringify(w.snapshot()).includes('feature-')); assert(!('auditLog' in w.snapshot({ human: true })));
} finally { if (w) { clearTimeout(w.saveTimer); clearInterval(w.seal.timer); } fs.rmSync(dir, { recursive: true, force: true }); }
console.log('audit log ok');
