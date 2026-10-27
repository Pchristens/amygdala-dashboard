// Small DOM + formatting helpers. All text goes through textContent.
import { toLinearA } from './svg-util.js';

export function h(tag, props = {}, ...children) {
  const e = document.createElement(tag);
  for (const k in props) {
    const v = props[k];
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = String(v);
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') for (const d in v) e.dataset[d] = v[d];
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, String(v));
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    e.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return e;
}

export const AGENTS = ['claude', 'codex', 'antigravity', 'grok', 'gemini'];
export function agentClass(agent) {
  return AGENTS.includes(agent) ? `chip-${agent}` : 'chip-other';
}
export function agentColorVar(agent) {
  return `var(--${AGENTS.includes(agent) ? agent : 'other'})`;
}

export function relTime(ts, now = Date.now()) {
  const t = +ts;
  if (!Number.isFinite(t) || t <= 0) return '';
  const s = Math.round((now - t) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const hr = Math.round(m / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.round(hr / 24);
  return `${d}d ago`;
}

export function initials(name) {
  const s = String(name || '?').trim();
  return s ? s[0].toUpperCase() : '?';
}

// Avatar disc colored by resident color (if known) or by kind.
export function safeCssColor(c, fallback = 'var(--other)') {
  const s = String(c || '').trim();
  return /^#[0-9a-f]{3,8}$/i.test(s) || /^var\(--[a-z0-9-]+\)$/i.test(s) ? s : fallback;
}
export function avatar(name, color, extraClass = '') {
  const a = h('span', { class: `avatar ${extraClass}`.trim(), text: initials(name) });
  a.style.background = safeCssColor(color);
  return a;
}

export function toast(msg, isError = false, ms = 2600) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = String(msg);
  t.classList.toggle('error', !!isError);
  t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.hidden = true; }, ms);
}

// One commitment (resident project) as a small block. compact = inside a resident row/card.
export function commitmentEl(c, { compact = false } = {}) {
  const status = ['active', 'done', 'dropped'].includes(c.status) ? c.status : 'active';
  const el = h('div', { class: `commit commit-${status} ${compact ? 'compact' : ''}`.trim() });
  const mark = status === 'done' ? '✓' : status === 'dropped' ? '–' : c.blockedOn ? '⏸' : '⚑';
  el.appendChild(h('div', { class: 'commit-head' },
    h('span', { class: 'commit-mark', text: mark }),
    h('span', { class: 'commit-objective', text: String(c.objective || '(untitled project)') }),
    compact ? null : h('span', { class: 'commit-owner', text: String(c.ownerId || '') }),
  ));
  const collabs = Array.isArray(c.collaborators) ? c.collaborators.filter(Boolean).map(String) : [];
  if (status === 'active' && c.nextAction) el.appendChild(h('div', { class: 'commit-row', text: `next: ${c.nextAction}` }));
  if (status === 'active' && c.blockedOn) el.appendChild(h('div', { class: 'commit-row blocked', text: `blocked on: ${c.blockedOn}` }));
  if (collabs.length) el.appendChild(h('div', { class: 'commit-row dim', text: `with ${collabs.join(', ')}` }));
  if (status === 'done') el.appendChild(h('div', { class: 'commit-row dim', text: `finished ${relTime(c.updatedAt)}` }));
  return el;
}

// Engraved stone tablet showing the seal's runic ciphertext lines, with a "Break the seal" button.
export function runeTablet(runes, { title = 'Sealed', hint = '', onBreak = null, compact = false } = {}) {
  const lines = (Array.isArray(runes) ? runes : []).slice(0, compact ? 4 : 10).map((l) => String(l).slice(0, 72));
  const t = h('div', { class: `rune-tablet ${compact ? 'compact' : ''}` });
  t.appendChild(h('div', { class: 'rune-tablet-title', text: title }));
  const body = h('div', { class: 'rune-lines', lang: 'und' });
  for (const l of lines) body.appendChild(h('div', { class: 'rune-line', text: l }));
  if (!lines.length) body.appendChild(h('div', { class: 'rune-line', text: toLinearA('sealed beyond reading') }));
  t.appendChild(body);
  if (hint) t.appendChild(h('div', { class: 'rune-tablet-hint', text: hint }));
  if (onBreak) t.appendChild(h('button', { class: 'btn btn-primary', type: 'button', text: '🔓 Break the seal', onClick: onBreak }));
  return t;
}

// Visual "engraving" of readable text into Linear A (purely cosmetic, not encryption).
export function toRunes(text) { return toLinearA(text); }

export function capitalize(s) {
  s = String(s || '');
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
