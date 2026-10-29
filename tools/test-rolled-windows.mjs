// v0.55: a window past its reset time counts as spent no more. Codex reports only on its next request, so an old 100%
// must not block its residents (or show as 100%) after the reset.
import assert from 'node:assert/strict';
import { Usage, rolled } from '../lib/usage.js';

const now = Date.now(), sec = ms => Math.floor(ms / 1000);
assert.equal(rolled({ resets_at: sec(now - 60000) }), true); assert.equal(rolled({ resets_at: now - 60000 }), true); // seconds or ms
assert.equal(rolled({ resets_at: sec(now + 60000) }), false); assert.equal(rolled({}), false); assert.equal(rolled({ resets_at: 0 }), false);

const u = { limits: { observedAt: now, providers: [{ id: 'codex', label: 'Codex', observedAt: now - 3600000, windows: [
  { kind: 'five_hour', label: '5h', used_percentage: 100, resets_at: sec(now - 60000) },
  { kind: 'seven_day', label: '7d', used_percentage: 34, resets_at: sec(now + 5 * 86400000) }] }] } };
const pressure = Usage.prototype.providerPressure.bind(u);
assert.equal(pressure('openai'), 34); // the rolled 5h no longer gates; the live 7d still does
u.limits.providers[0].windows[0].resets_at = sec(now + 60000);
assert.equal(pressure('openai'), 100); // before the reset it still blocks
u.limits.providers[0].windows[0].resets_at = sec(now - 60000);

// The human's view shows the rolled window as reset, without changing the stored reading.
const shown = Usage.prototype.limitsView.call(u).providers[0].windows;
assert.equal(shown[0].used_percentage, 0); assert.equal(shown[0].rolledOver, true); assert.equal(shown[1].used_percentage, 34); assert.equal(shown[1].rolledOver, undefined);
assert.equal(u.limits.providers[0].windows[0].used_percentage, 100);
console.log('rolled windows: past-reset windows stop gating and show as reset passed');
