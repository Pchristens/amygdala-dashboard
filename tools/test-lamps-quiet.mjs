import assert from 'node:assert/strict';
import { panelDocument } from './panel-dom.mjs';
import { createPanel } from '../public/panel.js';

globalThis.document = panelDocument(); globalThis.window = {}; globalThis.requestAnimationFrame = fn => fn();
document.createElementNS = (_ns, tag) => document.createElement(tag);
const panel = createPanel({ api: async () => ({ ok: true }) });
const base = { zones: [{ id: 'village' }], residents: [], workers: [], posts: [], exhibits: [], tales: [], audits: [], usage: {
  guidance: 'normal', limits: { source: 'provider', providers: [{ id: 'claude', label: 'Claude', source: 'provider', windows: [] }] },
  village: { today: { tokens: 0, turns: 0 }, allTime: { tokens: 0, turns: 0, measuredTurns: 0 }, byProvider: {}, byResident: {}, byKind: {}, history: [], recent: [] },
  sessions: { status: 'unmeasured' },
} };
const lamps = () => document.getElementById('lamps');
panel.update(structuredClone(base));
let root = lamps();
assert.match(root.textContent, /No village turns yet; breakdowns appear after the first turn\./);
assert.equal(root.querySelectorAll('.stat-tile').length, 2, 'quiet village shows only today and all-time tiles');
assert.equal(root.querySelectorAll('.spark, .bars').length, 0, 'quiet village folds empty history and breakdowns');
assert.doesNotMatch(root.textContent, /Recent turns|No history yet|nothing yet|No turns yet today/);
assert.match(root.textContent, /not reported|Claude/);
assert.match(root.textContent, /The heroes’ sessions/, "the heroes’ sessions are not village turns and always show");

const busy = structuredClone(base);
Object.assign(busy.usage.village.today, { tokens: 120, turns: 1 });
Object.assign(busy.usage.village.allTime, { tokens: 120, turns: 1, measuredTurns: 1 });
busy.usage.village.perArtifact = 120; busy.usage.village.perConfirmedFix = 60;
busy.usage.village.history = [{ day: 'today', tokens: 120, turns: 1 }];
busy.usage.village.byResident = { Synthetic: { tokens: 120, turns: 1 } };
busy.usage.village.byKind = { life: { tokens: 120, turns: 1 } };
busy.usage.village.byProvider = { anthropic: { tokens: 120, turns: 1 } };
busy.usage.village.recent = [{ resident: 'Synthetic', provider: 'anthropic', status: 'reported', total: 120, endedAt: Date.now() }];
panel.update(busy); root = lamps();
assert.match(root.textContent, /No history yet\.|Last 1 days/);
assert.match(root.textContent, /By resident · today/); assert.match(root.textContent, /By kind · today/);
assert.match(root.textContent, /By provider · all time/); assert.match(root.textContent, /Recent turns/);
assert.equal(root.querySelectorAll('.stat-tile').length, 4, 'busy village retains all four metric tiles');
console.log('quiet Lamps: short empty state; busy data retains sections');
