// A guidance run's temp folder that Windows still holds (EPERM) must not crash the server.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const src = fs.readFileSync(new URL('../lib/guidance.js', import.meta.url), 'utf8');
const line = src.split('\n').find(l => l.includes('fs.rmSync(cwd'));
assert(line && /^\s*try \{ fs\.rmSync\(cwd/.test(line) && /catch \{/.test(line), 'the cleanup is inside try/catch');
assert.match(line, /\.unref\(\)/, 'a later retry never keeps the process alive');
const orig = fs.rmSync; let threw = false;
fs.rmSync = () => { threw = true; const e = new Error('EPERM, Permission denied'); e.code = 'EPERM'; throw e; };
const { runGuidance } = await import('../lib/guidance.js');
const r = { name: 'X', agent: 'grok', model: 'm', persona: '' }; // unsupported, so nothing is spawned
await assert.rejects(runGuidance(r, { visitor: 'Guest', question: 'q' }, { timeoutMs: 1 }));
fs.rmSync = orig; assert(threw, 'the failing cleanup ran and was caught');
console.log('guidance cleanup: a held temp folder is retried later, never fatal');
