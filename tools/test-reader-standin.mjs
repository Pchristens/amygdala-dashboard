// v0.88: on-demand residents stay out of the routine round, and the second reader examines when the examiner can't.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { World } from '../lib/world.js';
import { Usage } from '../lib/usage.js';
import { Conductor } from '../lib/conductor.js';
Usage.prototype.pollDeck = () => {}; Usage.prototype.probe = () => {};
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amygdala-reader-'));
const config = [{ name: 'Themis', rank: 'priest', agent: 'claude', model: 'claude-opus-5-5' }, { name: 'Quill', rank: 'low', agent: 'codex', model: 'gpt-6.1-sol' },
  { name: 'Hesper', rank: 'low', agent: 'grok', model: 'grok-4.7', role: 'reader', onDemand: true }, { name: 'Phronesis', rank: 'low', agent: 'grok', model: 'grok-4.7', onDemand: true }, { name: 'Wren', rank: 'low', agent: 'claude', model: 'claude-sonnet-5-5' }];
let w;
try {
  w = new World(dir, config, path.join(dir, 'roster.json')); w.s.paused = false; w.s.activeHours = { start: 0, end: 24 };
  const c = Object.assign(Object.create(Conductor.prototype), { world: w, queue: [], pendingDuties: [], running: new Map(), tick() {} }); w.conductor = c;
  const g = w.governance; g.transport = async () => '{}';
  const make = async () => { const o = { id: w.id('of'), zone: 'village', provider: 'anthropic', tool: 'claude', kind: 'commit', project: 'test', host: 'local', workerId: 'missing', headCommit: 'a'.repeat(40), status: 'open', title: 'test', commanded: {}, reviewers: [], anchored: [], createdAt: Date.now() }; w.s.offerings.push(o); await g.consider(o); return o; };
  // The examiner is free: he examines, no stand-in.
  let o = await make(); assert.equal(o.gov.examination.by, 'Quill'); assert(!o.gov.examination.standIn);
  // The examiner rests: the second reader examines in his place, and the card says why.
  w.setHibernate('Quill', true);
  o = await make(); assert.equal(o.gov.examination.state, 'pending'); assert.equal(o.gov.examination.by, 'Hesper'); assert.deepEqual(o.gov.examination.standIn, { for: 'Quill', reason: 'examiner is hibernating' });
  assert(c.pendingDuties.some(d => d.examinationId === o.id && d.resident === 'Hesper'));
  // Both resting: skipped as before, never blocking the ruling.
  w.setHibernate('Hesper', true);
  o = await make(); assert.equal(o.gov.examination.state, 'skipped'); assert.equal(o.gov.examination.by, 'Quill'); assert(!o.gov.examination.standIn);
  w.setHibernate('Quill', false); w.setHibernate('Hesper', false);
  // The routine round never picks an on-demand resident.
  let picked = []; c.run = r => { picked.push(r.name); c.turn = null; }; c.hasNews = () => true; c.lastEnd = 0; w.s.tickSeconds = 15; c.queue = []; c.pendingDuties = []; c.dispatchDuties = () => {}; c.rr = 0;
  for (let i = 0; i < 8; i++) { c.turn = null; c.lastEnd = 0; c.schedule(); }
  assert(picked.length > 0); assert(!picked.includes('Hesper') && !picked.includes('Phronesis'), picked.join());
  // ...but a call still wakes them.
  picked = []; c.wake('Phronesis', 'Wren mentioned you', { human: false }); c.turn = null; c.lastEnd = Date.now(); c.schedule(); assert.deepEqual(picked, ['Phronesis']);
  console.log('PASS: on-demand residents leave the routine round; the second reader stands in for a resting examiner');
} finally { w?.stop?.(); fs.rmSync(dir, { recursive: true, force: true }); }
