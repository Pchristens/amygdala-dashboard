// Small DOM for panel renderer regressions: removal drops focus and assigning value moves the caret.
// It deliberately implements only the DOM operations used by these synthetic village fixtures.
export function panelDocument() {
  let doc;
  class Node {
    constructor(tag, text = '') { this.nodeType = tag === '#text' ? 3 : 1; this.tagName = tag.toUpperCase(); this.childNodes = []; this.parentNode = null; this.attrs = new Map(); this.dataset = {}; this.style = {}; this.listeners = new Map(); this._text = text; this._value = ''; this.checked = false; this.hidden = false; this.scrollTop = 0; this.scrollHeight = 0; this.clientHeight = 100; this.selectionStart = this.selectionEnd = 0; }
    get children() { return this.childNodes.filter(n => n.nodeType === 1); }
    get parentElement() { return this.parentNode; }
    get firstChild() { return this.childNodes[0] || null; }
    get lastChild() { return this.childNodes.at(-1) || null; }
    get nextSibling() { return this.parentNode?.childNodes[this.parentNode.childNodes.indexOf(this) + 1] || null; }
    get isConnected() { return this === doc.body || !!this.parentNode?.isConnected; }
    get attributes() { return [...this.attrs].map(([name, value]) => ({ name, value })); }
    get className() { return this.getAttribute('class') || ''; }
    set className(v) { this.attrs.set('class', v); }
    get classList() { return { contains: c => this.className.split(/\s+/).includes(c), add: c => this.classList.toggle(c, true), remove: c => this.classList.toggle(c, false), toggle: (c, force) => { const names = new Set(this.className.split(/\s+/).filter(Boolean)), on = force ?? !names.has(c); if (on) names.add(c); else names.delete(c); this.className = [...names].join(' '); return on; } }; }
    get textContent() { return this.nodeType === 3 ? this._text : this.childNodes.map(n => n.textContent).join(''); }
    set textContent(v) { if (this.nodeType === 3) this._text = String(v); else { this.replaceChildren(); if (v !== '') this.append(doc.createTextNode(String(v))); } }
    get options() { return this.children.filter(n => n.tagName === 'OPTION'); }
    get value() { return this.tagName === 'SELECT' ? (this.options.find(n => n.selected)?.value ?? this.options[0]?.value ?? '') : this._value; }
    set value(v) { if (this.tagName === 'SELECT') { for (const o of this.options) o.selected = o.value === String(v); } else { this._value = String(v); this.selectionStart = this.selectionEnd = this._value.length; } }
    setAttribute(k, v) { this.attrs.set(k, String(v)); if (k === 'value') this.value = v; else if (k === 'checked' || k === 'selected' || k === 'hidden') this[k] = true; else if (k.startsWith('data-')) this.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(v); }
    getAttribute(k) { return this.attrs.get(k) ?? null; }
    removeAttribute(k) { this.attrs.delete(k); if (k === 'checked' || k === 'selected' || k === 'hidden') this[k] = false; }
    contains(n) { return n === this || this.childNodes.some(c => c.contains(n)); }
    remove() { if (!this.parentNode) return; if (this.contains(doc.activeElement)) doc.activeElement = doc.body; const a = this.parentNode.childNodes; a.splice(a.indexOf(this), 1); this.parentNode = null; }
    insertBefore(n, before) { if (n === before) return n; n.remove(); n.parentNode = this; const i = before ? this.childNodes.indexOf(before) : -1; if (i < 0) this.childNodes.push(n); else this.childNodes.splice(i, 0, n); return n; }
    appendChild(n) { return this.insertBefore(n, null); }
    append(...nodes) { for (const n of nodes) this.appendChild(typeof n === 'string' ? doc.createTextNode(n) : n); }
    replaceChildren(...nodes) { for (const n of [...this.childNodes]) n.remove(); this.append(...nodes); }
    replaceWith(n) { this.parentNode.insertBefore(n, this); this.remove(); }
    matches(s) { const attr = s.match(/\[([^=\]]+)(?:="([^"]*)")?\]/); if (attr && (this.getAttribute(attr[1]) == null || attr[2] != null && this.getAttribute(attr[1]) !== attr[2])) return false; s = s.replace(/\[[^\]]+\]/g, ''); const id = s.match(/#([\w-]+)/), cls = s.match(/\.([\w-]+)/), tag = s.match(/^\w+/); return (!id || this.getAttribute('id') === id[1]) && (!cls || this.classList.contains(cls[1])) && (!tag || this.tagName === tag[0].toUpperCase()); }
    querySelectorAll(s) { const out = []; const walk = n => { for (const c of n.children) { if (s.split(',').some(part => c.matches(part.trim()))) out.push(c); walk(c); } }; walk(this); return out; }
    querySelector(s) { return this.querySelectorAll(s)[0] || null; }
    closest(s) { return this.matches(s) ? this : this.parentNode?.closest(s) || null; }
    addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(fn); }
    dispatchEvent(event) { event.target ||= this; for (const fn of this.listeners.get(event.type) || []) fn(event); if (event.bubbles) this.parentNode?.dispatchEvent(event); return true; }
    focus() { if (doc.activeElement !== this) doc.activeElement?.blur(); doc.activeElement = this; this.dispatchEvent({ type: 'focus' }); }
    blur() { if (doc.activeElement === this) { doc.activeElement = doc.body; this.dispatchEvent({ type: 'blur' }); this.dispatchEvent({ type: 'focusout', bubbles: true }); } }
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
    scrollIntoView() {}
  }
  doc = { title: 'Panel test', createElement: tag => new Node(tag), createTextNode: text => new Node('#text', text), addEventListener() {}, querySelector: s => doc.body.querySelector(s), querySelectorAll: s => doc.body.querySelectorAll(s), getElementById: id => doc.body.querySelector('#' + id) };
  doc.body = new Node('body'); doc.activeElement = doc.body;
  const ids = ['channels', 'board-scroll', 'posts', 'board-empty', 'board-sealed', 'projects-strip', 'composer', 'send', 'composer-channel', 'composer-zone', 'reply-strip', 'reply-strip-text', 'reply-cancel', 'exhibits', 'exhibits-list', 'exhibits-sealed', 'residents', 'workshop', 'badge-wait', 'lamps', 'exhibit-tabs', 'tales', 'gate', 'orders', 'badge-petitions', 'count-board', 'count-exhibits', 'count-residents', 'count-workshop', 'badge-omen', 'badge-counsel', 'count-lamps'];
  for (const id of ids) { const n = doc.createElement(id === 'composer' ? 'textarea' : 'div'); n.setAttribute('id', id); doc.body.append(n); }
  const composer = doc.createElement('div'); composer.className = 'composer'; doc.body.append(composer); composer.append(doc.getElementById('composer'));
  return doc;
}
