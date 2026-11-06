// A node passes its Codex reading on when it is newer, and again every ten minutes: the server keeps readings in memory,
// so after a restart it showed a stale log (Codex "100% left") until Codex next ran on that machine.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { codexDue } from './amygdala-node.mjs';
const now = 10_000_000;
assert.equal(codexDue(200, 100, now, now), true, 'a newer reading goes at once');
assert.equal(codexDue(100, 100, now - 60000, now), false, 'the same reading is not resent within ten minutes');
assert.equal(codexDue(100, 100, now - 600001, now), true, 'the same reading is resent after ten minutes');
assert.equal(codexDue(50, 0, 0, now), true, 'the first reading goes');
const src = fs.readFileSync(new URL('./amygdala-node.mjs', import.meta.url), 'utf8');
assert.match(src, /codexDue\(u\.observedAt, codexSent, codexSentAt\)/); assert.match(src, /codexSent = pendingCodex\.observedAt; codexSentAt = Date\.now\(\);/);
console.log('node codex ok');
