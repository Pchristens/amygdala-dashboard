// Touch scrolling for hero terminals: a swipe sends SGR wheel reports (what a desktop wheel sends, so tmux scrolls its
// history), small jitters stay taps, a fast swipe goes further and a flick glides on, and typing first stops the glide and
// scrolls back to the bottom so keys reach the hero. A fake clock and timer; no browser.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { terminalSwipe, SWIPE_STEP, swipeGain } from '../public/terminal-input.js';
let clock = 0; const timers = new Map(); let nextId = 1;
const schedule = (fn, ms) => { const id = nextId++; timers.set(id, fn); return id; }, cancel = id => timers.delete(id);
const runTimers = (max = 1000) => { let n = 0; while (timers.size && n++ < max) { const [id, fn] = timers.entries().next().value; timers.delete(id); clock += 16; fn(); } return n; };
const sent = [], sw = terminalSwipe({ send: d => sent.push(d), size: () => ({ cols: 80, rows: 24 }), now: () => clock, schedule, cancel });
const ev = (y, n = 1) => ({ touches: Array.from({ length: n }, () => ({ clientY: y })), prevented: 0, preventDefault() { this.prevented++; }, stopPropagation() {} });
const reports = (list, dir) => list.join('').split(`\x1b[<${dir};40;12M`).length - 1;
// A slow drag: 4 px per 16 ms (0.25 px/ms) tracks the finger one-for-one, with no fling on release.
const drag = (from, to, step = 4) => { sw.start(ev(from)); let y = from, last; while (y !== to) { y += Math.sign(to - y) * Math.min(step, Math.abs(to - y)); clock += 16; sw.move(last = ev(y)); } return last; };

// A tap (under 8 px) sends nothing and is not prevented, so it still focuses the terminal.
sw.start(ev(100)); clock += 16; let m = ev(105); sw.move(m); let end = ev(105); sw.end(end);
assert.deepEqual(sent, []); assert.equal(m.prevented, 0); assert.equal(end.prevented, 0);
// Finger down = back through history (wheel up); the page doesn't scroll; a slow drag doesn't glide.
m = drag(100, 100 + SWIPE_STEP * 3); end = ev(0); sw.end(end); runTimers();
assert.equal(reports(sent, 64), 3); assert.equal(m.prevented, 1); assert.equal(end.prevented, 1); assert.equal(sw.scrolled, 3);
// Finger up scrolls down, but never past what was scrolled.
drag(500, 500 - SWIPE_STEP * 5); sw.end(ev(0)); runTimers();
assert.equal(reports(sent, 65), 3); assert.equal(sw.scrolled, 0);
// Two fingers (a pinch) are left alone.
const before = sent.length; sw.start(ev(100, 2)); clock += 16; sw.move(ev(300, 2)); assert.equal(sent.length, before);

// Speed gain: none when slow, up to 4x when fast.
assert.equal(swipeGain(0.2), 1); assert.equal(swipeGain(-0.2), 1); assert(swipeGain(1) > 2); assert.equal(swipeGain(10), 4);
// A fast swipe of the same length goes further than a slow one.
sent.length = 0; drag(0, 400, 4); sw.end(ev(0)); runTimers(); const slow = sw.scrolled;
sw.typed(); sent.length = 0; drag(0, 400, 40); clock += 0; const fastBeforeRelease = sw.scrolled;
assert(fastBeforeRelease > slow * 2, `fast ${fastBeforeRelease} vs slow ${slow}`);
// A flick keeps scrolling after the finger lifts, slowing to a stop.
sw.end(ev(0)); assert.equal(timers.size, 1, 'a flick glides'); const frames = runTimers();
assert(sw.scrolled > fastBeforeRelease, 'the glide scrolled further'); assert(frames > 10 && frames < 200, `glide frames ${frames}`); assert.equal(timers.size, 0);
// A pause before lifting the finger (holding still) means no glide.
sw.typed(); drag(0, 400, 40); clock += 200; sw.end(ev(0)); assert.equal(timers.size, 0);
// A new touch stops a glide at once.
sw.typed(); drag(0, 400, 40); sw.end(ev(0)); assert.equal(timers.size, 1); sw.start(ev(0)); assert.equal(timers.size, 0);
// A downward glide stops at the bottom rather than sending reports tmux would drop.
sw.typed(); drag(0, 200, 4); sw.end(ev(0)); const scrolled = sw.scrolled; assert(scrolled > 0);
sent.length = 0; drag(1000, 0, 60); sw.end(ev(0)); runTimers();
assert.equal(sw.scrolled, 0); assert.equal(reports(sent, 65), scrolled); assert.equal(timers.size, 0);
// Typing while scrolled stops a glide and returns to the bottom first (two spare steps); not scrolled, nothing extra.
drag(0, 400, 40); sw.end(ev(0)); assert.equal(timers.size, 1); const at = sw.scrolled; sent.length = 0; sw.typed();
assert.equal(timers.size, 0); assert.equal(reports(sent, 65), at + 2); sw.typed(); assert.equal(sent.length, 1);
// Dispose stops a glide.
drag(0, 400, 40); sw.end(ev(0)); sw.dispose(); assert.equal(timers.size, 0);
// panel.js wires it with non-passive capture listeners, skips Windows consoles, calls typed() before input, disposes it.
const panel = fs.readFileSync(new URL('../public/panel.js', import.meta.url), 'utf8');
assert.match(panel, /worker\.os === 'windows' && !worker\.node \? null : terminalSwipe\(/);
assert.match(panel, /\{ capture: true, passive: false \}/);
assert.match(panel, /swipe\?\.typed\(\); transport\.data\(data\);/);
assert.match(panel, /swipe\?\.dispose\(\);/);
console.log('terminal swipe ok');
