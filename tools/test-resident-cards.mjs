import fs from 'node:fs';
import assert from 'node:assert/strict';
import { panelDocument } from './panel-dom.mjs';
import { h } from '../public/util.js';
import { residentIdentity } from '../public/panel.js';
import { zoneOf } from '../public/svg-util.js';

globalThis.document = panelDocument();
const { residentCard } = await import('../public/cards.js');

const base = { name: 'Synthetic Ada', title: 'The Test Smith', role: 'smith', agent: 'codex', model: 'test-model', primaryModel: 'primary-test', color: '#aabbaa', zone: 'village', mood: 'calm', doing: 'reading', enabled: true, lastTurnAt: Date.now() - 60000, persona: 'PERSONA NOT FOR CARD', appearance: { motto: 'MOTTO NOT FOR CARD', self_description: 'OWN WORDS NOT FOR CARD' }, turns: 999 };
const snapshot = () => ({ world: { activeTurns: [] }, posts: [{ zone: 'village', author: base.name, text: 'A synthetic last post.\nWith a second line.', ts: Date.now() - 30000 }], commitments: [{ zone: 'village', id: 'one', ownerId: base.name, status: 'active', objective: 'First objective', nextAction: 'First next action' }, { zone: 'village', id: 'two', ownerId: base.name, status: 'active', objective: 'Second objective should fold', nextAction: 'Second next action' }], usage: { village: { weeklyPerTurn: { [base.name]: { perTurnPct: 0.25, samples: 3 } } } } });
const mounted = (r = base, s = snapshot(), actions = {}) => { const root = residentCard(r, s, actions); document.body.append(root); return root; };
const button = (root, label) => root.querySelectorAll('button').find(n => n.textContent === label);
const click = element => { assert(element, 'action must exist'); element.dispatchEvent({ type: 'click', stopPropagation() {} }); };
const visible = root => { const text = node => node.hidden ? '' : node.nodeType === 3 ? node.textContent : node.childNodes.map(text).join(' '); return text(root); };
const tests = [
  ['compact content', () => {
    const root = mounted({ ...base, onBackup: true });
    assert.doesNotMatch(root.textContent, /PERSONA NOT FOR CARD|MOTTO NOT FOR CARD|OWN WORDS NOT FOR CARD|999 turns|Second objective should fold|Second next action/);
    assert.match(root.textContent, /First objective/); assert.match(root.textContent, /First next action/); assert.match(root.textContent, /\+1 more/);
    assert.match(root.textContent, /⇄ backup/); assert.match(root.textContent, /The Test Smith/);
    assert(!root.querySelectorAll('.chip').some(n => n.textContent === 'codex'), 'agent chip must be omitted');
    assert(root.querySelector('.card-actions').hidden, 'actions row is hidden without callbacks');
    assert.equal(root.querySelectorAll('.card-close').length, 1, 'standalone card has its own close');
    assert(root.querySelector('[data-field="last-post"]').textContent.length < 150);
    assert(!root.querySelector('[data-field="last-post"]').textContent.includes('\n'));
  }],
  ['status precedence and wake rules', () => {
    const s = snapshot(), r = { ...base, hibernating: true, hibernateReason: 'usage', enabled: false, parallel: [{}, {}] }; s.world.activeTurns = [{ resident: r.name }];
    const root = mounted(r, s);
    assert.match(visible(root), /in a turn now · \+2 orders/); assert(button(root, 'Wake now').disabled);
    s.world.activeTurns = []; root.update(r, s); assert.match(visible(root), /hibernating · usage/); assert(!button(root, 'Wake now').disabled);
    root.update({ ...r, hibernating: false }, s); assert.match(visible(root), /not in turns/);
    root.update(base, s); assert.match(visible(root), /idle · last turn/);
    root.update({ ...base, lastTurnAt: null }, s); assert.match(visible(root), /idle · no turns yet/);
  }],
  ['sealed boundary', () => {
    // Entirely fabricated boundary fixture: private-content properties throw if the renderer even attempts a read.
    const r = { ...base, mood: 'sealed' }, s = snapshot();
    Object.defineProperty(r, 'doing', { get() { throw new Error('must not read sealed doing'); } });
    Object.defineProperty(s, 'posts', { get() { throw new Error('must not read sealed posts'); } });
    Object.defineProperty(s, 'commitments', { get() { throw new Error('must not read sealed commitments'); } });
    const root = mounted(r, s); assert.match(visible(root), /beyond the seal/);
    assert(!visible(root).includes('Last post')); assert(button(root, 'Wake now').disabled);
    const existing = mounted(); existing.update(r, s); assert(!existing.textContent.includes('synthetic last post'));
  }],
  ['weekly sampling gates', () => {
    const s = snapshot(), root = mounted(base, s); assert.match(visible(root), /0\.25%.*per turn/);
    s.usage.village.weeklyPerTurn[base.name].samples = 2; root.update(base, s); assert.doesNotMatch(visible(root), /%.*per turn/);
    s.usage.village.weeklyPerTurn[base.name].samples = 3; s.usage.village.weeklyPerTurn[base.name].perTurnPct = null;
    root.update(base, s); assert.doesNotMatch(visible(root), /%.*per turn/);
    s.usage.village.weeklyPerTurn[base.name].perTurnPct = 0; root.update(base, s); assert.match(visible(root), /0%.*per turn/);
    root.update({ ...base, zone: 'isle' }, s); assert.doesNotMatch(visible(root), /%.*per turn/);
  }],
  ['dialog and stable focused update', () => {
    const opener = h('button', { text: 'Synthetic opener' }); document.body.append(opener); opener.focus();
    const root = mounted(); root.open();
    assert.equal(root.getAttribute('role'), 'dialog'); assert.equal(root.getAttribute('aria-modal'), 'false'); assert.equal(root.getAttribute('tabindex'), '-1');
    assert.equal(document.getElementById(root.getAttribute('aria-labelledby')).textContent, base.name);
    assert.ok(document.activeElement === root);
    const details = button(root, 'Details'); details.focus();
    root.update({ ...base, doing: 'new synthetic activity', onBackup: true }, snapshot());
    assert.ok(document.activeElement === details && button(root, 'Details') === details, 'snapshot must keep the focused action node');
    assert.match(root.textContent, /new synthetic activity/);
    root.close(); assert.ok(document.activeElement === opener, 'closing restores the opener');
  }],
  ['embedded card omits duplicate close', () => {
    const root = residentCard(base, snapshot(), { onClose() {} }, { embedded: true });
    assert.equal(root.querySelectorAll('.card-close').length, 0);
  }],
  ['snapshot does not replace the focused card subtree', () => {
    const root = mounted(), name = root.querySelector('.card-name'); name.setAttribute('tabindex', '-1'); name.focus();
    root.update({ ...base, doing: 'updated activity' }, snapshot());
    assert.ok(root.querySelector('.card-name') === name && document.activeElement === name, 'snapshot must retain existing focused card fields');
  }],
  ['actions use current identity and follow state', () => {
    const calls = []; let following = false;
    const actions = { onClose: () => calls.push(['close']), onWake: name => calls.push(['wake', name]), onDetails: name => calls.push(['details', name]), onOrder: name => calls.push(['order', name]), isFollowing: () => following, onFollow: (name, on) => { following = on; calls.push(['follow', name, on]); } };
    const root = mounted(base, snapshot(), actions); root.open(); click(button(root, 'Follow')); assert(button(root, 'Unfollow'));
    click(button(root, 'Unfollow')); assert(button(root, 'Follow'));
    root.update({ ...base, name: 'Synthetic Renamed' }, snapshot()); click(button(root, 'Wake now'));
    assert.deepEqual(calls.at(-1), ['wake', 'Synthetic Renamed']);
    click(button(root, 'Details')); assert.deepEqual(calls.slice(-2), [['close'], ['details', 'Synthetic Renamed']]);
    root.open(); click(button(root, 'Order…')); assert.deepEqual(calls.slice(-2), [['close'], ['order', 'Synthetic Renamed']]);
    root.open(); root.close(); const count = calls.length; root.close(); assert.equal(calls.length, count, 'close is idempotent');
    root.open(); root.update(base, snapshot(), { ...actions, onClose: () => root.close() }); root.close();
    assert(root.hidden, 'recursive page close callback must terminate');
  }],
];
// A busy resident's card stays short and never taller than the visible map (Wren in the middle of a Mac window).
const css = fs.readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
tests.push(['card height is bounded', () => {
  for (const sel of ['.resident-card-work > b, .resident-card-work > div', '.resident-card-post']) assert.match(css, new RegExp(sel.replace(/[.*+?^${}()|[\]\\>]/g, '\\$&') + ' \\{[^}]*-webkit-line-clamp: 2'), sel);
  assert.match(css, /#card \.resident-card \{ max-height: calc\(100vh - var\(--header-h\) - 48px\); overflow-y: auto; \}/);
}]);
let failures = 0;
for (const [name, test] of tests) { try { test(); console.log(`PASS ${name}`); } catch (e) { failures++; console.error(`FAIL ${name}: ${e.message.split('\n')[0]}`); } }
assert.equal(failures, 0, `resident card: ${failures} regression failures`);
