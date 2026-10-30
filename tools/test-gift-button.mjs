import assert from 'node:assert/strict';
import fs from 'node:fs';

// C14: the gift button is a quiet labelled icon that shows when a gift is being placed; the hint covers trackpads.
const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8'), app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
assert.match(html, /<button id="gift-btn" class="btn btn-icon gift-btn"[^>]*aria-pressed="false"[^>]*aria-label="Leave a gift"><svg/);
assert.match(app, /\$\('gift-btn'\)\.setAttribute\('aria-pressed', String\(on\)\)/);
assert(!/textContent = on \? 'Placing a gift/.test(app), 'the icon is not overwritten with text');
assert.match(html, /scroll or pinch to zoom/);
assert.match(fs.readFileSync(new URL('../public/style.css', import.meta.url), 'utf8'), /\.gift-btn\[aria-pressed="true"\]/);
console.log('gift button: labelled icon, pressed while placing; hint covers pinch');
// C11: Temple site marks are line art, not emoji (no torii).
const panel = fs.readFileSync(new URL('../public/panel.js', import.meta.url), 'utf8');
assert(!/[⛩📜🔥⛏]/u.test(panel), 'no site emoji left in the panel');
assert.match(panel, /function siteGlyph\(id\) \{[^\n]*<svg viewBox="0 0 18 18"[^\n]*stroke="currentColor"/);
assert(!/Share a milestone 🌸/u.test(panel + fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8')), 'buttons carry no emoji');
