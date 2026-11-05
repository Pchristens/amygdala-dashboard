// Touch scrolling for hero terminals: a swipe sends SGR wheel reports (what a desktop wheel sends, so tmux scrolls its
// history), small jitters stay taps, and typing first scrolls back to the bottom so keys reach the hero.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { terminalSwipe, SWIPE_STEP } from '../public/terminal-input.js';
const sent = [], sw = terminalSwipe({ send: d => sent.push(d), size: () => ({ cols: 80, rows: 24 }) });
const ev = (y, n = 1) => { const e = { touches: Array.from({ length: n }, () => ({ clientY: y })), prevented: 0, preventDefault() { this.prevented++; }, stopPropagation() {} }; return e; };
const up = n => `\x1b[<64;40;12M`.repeat(n), down = n => `\x1b[<65;40;12M`.repeat(n);

// A tap (under 8 px) sends nothing and is not prevented, so it still focuses the terminal.
sw.start(ev(100)); let m = ev(105); sw.move(m); let end = ev(105); sw.end(end);
assert.deepEqual(sent, []); assert.equal(m.prevented, 0); assert.equal(end.prevented, 0);
// Finger down = back through history (wheel up), one report per step; the page doesn't scroll.
sw.start(ev(100)); m = ev(100 + SWIPE_STEP * 3); sw.move(m); end = ev(0); sw.end(end);
assert.deepEqual(sent, [up(3)]); assert.equal(m.prevented, 1); assert.equal(end.prevented, 1); assert.equal(sw.scrolled, 3);
// Finger up scrolls down, but never past what was scrolled.
sw.start(ev(500)); sw.move(ev(500 - SWIPE_STEP * 5)); sw.end(ev(0));
assert.deepEqual(sent.slice(1), [down(3)]); assert.equal(sw.scrolled, 0);
// Two fingers (a pinch) are left alone.
sw.start(ev(100, 2)); sw.move(ev(300, 2)); assert.equal(sent.length, 2);
// Typing while scrolled returns to the bottom first (two spare steps); not scrolled, nothing extra.
sw.start(ev(0)); sw.move(ev(SWIPE_STEP * 2)); sw.end(ev(0)); sw.typed();
assert.deepEqual(sent.slice(-2), [up(2), down(4)]); sw.typed(); assert.equal(sent.length, 4);
// panel.js wires it with non-passive capture listeners, skips Windows consoles, and calls typed() before input.
const panel = fs.readFileSync(new URL('../public/panel.js', import.meta.url), 'utf8');
assert.match(panel, /worker\.os === 'windows' && !worker\.node \? null : terminalSwipe\(/);
assert.match(panel, /\{ capture: true, passive: false \}/);
assert.match(panel, /swipe\?\.typed\(\); transport\.data\(data\);/);
console.log('terminal swipe ok');
