// v0.47: automatic turns keep to the active hours and spread the day's budget over them.
import assert from 'node:assert/strict';
import { World } from '../lib/world.js';

const P = World.prototype, at = (h, m = 0) => new Date(2026, 9, 28, h, m);
const w = { s: { activeHours: { start: 8, end: 24 }, tickSeconds: 180, dailyTurnBudget: 24, autoTurns: { date: '', count: 0 } }, changed() {} };
for (const k of ['turnWindowLeft', 'autoGapMs', 'autoTurnsToday', 'setHours']) w[k] = P[k].bind(w);

// 8am to midnight: nothing before 8, the whole window at 8, none after midnight.
assert.equal(w.turnWindowLeft(at(3)), null); assert.equal(w.turnWindowLeft(at(7, 59)), null);
assert.equal(w.turnWindowLeft(at(8)), 16 * 3600000); assert.equal(w.turnWindowLeft(at(23, 30)), 1800000);
// 24 turns over 16 hours is one every 40 minutes; the pace is only a floor.
assert.equal(w.autoGapMs(at(8)), 40 * 60000); assert.equal(w.autoGapMs(at(2)), null);
w.s.tickSeconds = 3600; assert.equal(w.autoGapMs(at(8)), 3600000); w.s.tickSeconds = 180;
// Turns already spent tighten nothing: the remaining budget is spread over the time left.
w.s.autoTurns = { date: at(20).toDateString(), count: 20 };
const realDate = globalThis.Date; // autoTurnsToday reads today's date; pin it
globalThis.Date = class extends realDate { constructor(...a) { super(...(a.length ? a : [2026, 9, 28, 20])); } };
assert.equal(w.autoGapMs(at(20)), 3600000); // 4 hours left, 4 turns left
globalThis.Date = realDate;
// A window that wraps past midnight is cut at midnight (the budget resets then).
w.setHours(22, 2); assert.equal(w.turnWindowLeft(at(23)), 3600000); assert.equal(w.turnWindowLeft(at(1)), 3600000); assert.equal(w.turnWindowLeft(at(12)), null);
assert.throws(() => w.setHours(5, 5)); assert.throws(() => w.setHours('x', 3));
w.setHours(0, 24); assert.equal(w.turnWindowLeft(at(0)), 24 * 3600000); // all day
console.log('hours: active window and spread pacing passed');
