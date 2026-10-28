// Codex's allowance lives in session logs on whichever machine ran Codex; nodes pass theirs on and the newest reading wins.
import assert from 'node:assert/strict';
import { Usage } from '../lib/usage.js';
import { validateReport } from '../lib/nodes.js';

const u = { limits: { providers: [] }, w: { changed() {} } };
for (const k of ['mergeCodex', 'mergeDeck', 'setProvider']) u[k] = Usage.prototype[k].bind(u);
const win = p => [{ kind: 'five_hour', label: '5h', used_percentage: p, resets_at: Date.now() + 3600000 }];
const now = Date.now();
u.mergeCodex({ windows: win(10), observedAt: now - 3600000, source: 'codex session log' });
assert.equal(u.limits.providers[0].windows[0].used_percentage, 10);
// A node's fresher reading replaces the server's stale one; an older one never does.
u.mergeDeck({ id: 'codex', windows: win(40), observedAt: now - 60000 });
assert.equal(u.limits.providers[0].windows[0].used_percentage, 40); assert.equal(u.limits.providers[0].observedAt, now - 60000);
u.mergeCodex({ windows: win(5), observedAt: now - 7200000 }); assert.equal(u.limits.providers[0].windows[0].used_percentage, 40);
u.mergeCodex({ windows: win(5) }); assert.equal(u.limits.providers[0].windows[0].used_percentage, 40); // no timestamp, no trust
assert.equal(u.limits.providers.length, 1);

// Nodes may report codex with its observation time; a time in the future or junk is refused.
const base = { hostname: 'h', os: 'linux', deckAvailable: true, sessions: [], results: [] };
const ok = validateReport({ ...base, usage: { id: 'codex', windows: win(20), observedAt: now - 1000, extra: 'x' } });
assert.deepEqual(Object.keys(ok.usage).sort(), ['id', 'observedAt', 'windows']);
assert.throws(() => validateReport({ ...base, usage: { id: 'codex', windows: win(20), observedAt: now + 3600000 } }));
assert.throws(() => validateReport({ ...base, usage: { id: 'codex', windows: win(20), observedAt: 'soon' } }));
assert.throws(() => validateReport({ ...base, usage: { id: 'openai', windows: win(20) } }));
console.log('codex usage: node readings, newest wins, validation passed');
