import assert from 'node:assert/strict';
import fs from 'node:fs';

// C11: the dark theme is warm stone, not indigo, with near-opaque glass so the sea does not muddy the drawer.
const css = fs.readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
const dark = css.slice(css.indexOf('@media (prefers-color-scheme: dark)'), css.indexOf('* { box-sizing'));
assert(!/#161A33|#1F2546|#272E54|#323A64/i.test(dark), 'no indigo surfaces left in the dark theme');
assert.equal((dark.match(/--panel: #38342D;/g) || []).length, 2, 'both dark blocks (system and chosen) share the warm panel');
assert.equal((dark.match(/--glass-drawer: 95%;/g) || []).length, 2, 'dark glass is near-opaque in both blocks');
for (const v of ['--glass-header', '--glass-rail', '--glass-drawer']) assert.match(css, new RegExp(`color-mix\\(in srgb, var\\(--panel\\) var\\(${v}\\), transparent\\)`), `${v} drives its surface`);
assert.match(css.slice(0, css.indexOf('@media (prefers-color-scheme: dark)')), /--glass-drawer: 80%;/, 'the light theme keeps its glass');
assert(!/#8a7ec8|#7A62C9[^;]*;\s*font-size|counsel-chip/i.test(css.replace(/--antigravity: #7A62C9;/g, '')), 'no violet omen or blue counsel styling left, and no dead counsel chip');
for (const [sel, token] of [['.badge-omen', 'omen'], ['.need-omen', 'omen'], ['.badge-counsel', 'counsel'], ['.pill-counsel.counsel-new', 'counsel']]) assert.match(css.slice(css.indexOf(sel + ' {')), new RegExp(`^[^}]*var\\(--${token}\\)`), `${sel} uses --${token}`);
assert.match(fs.readFileSync(new URL('../public/panel.js', import.meta.url), 'utf8'), /Object\.hasOwn\(SITE_PATHS, id\)/, 'site marks read only own keys');
console.log('dark palette: warm stone, near-opaque glass, light theme unchanged');
