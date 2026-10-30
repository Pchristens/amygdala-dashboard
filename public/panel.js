import { terminalInput, terminalKeys, terminalImages } from './terminal-input.js';
const osLabel = os => ({ macos: 'macOS', windows: 'Windows', linux: 'Linux' }[os] || '');
// Side panel: Board / Exhibits / Residents / Workshop tabs, with a Village / Isle zone switch.
import { h, agentClass, relTime, avatar, capitalize, commitmentEl, safeCssColor, runeTablet, toRunes } from './util.js';
import { zoneOf } from './svg-util.js';

const CHANNELS = ['commons', 'projects', 'discoveries', 'play'];
const AGENT_DECK_URL = 'http://127.0.0.1:8420';
const DAY = 24 * 3600 * 1000;
export const VIEW_DESTINATION = Object.freeze({ board: 'activity', exhibits: 'activity', tales: 'activity', residents: 'people', workshop: 'work', orders: 'work', terminal: 'work', place: 'activity', lamps: 'lamps' });
export const DESTINATION_VIEWS = Object.freeze({ activity: ['board', 'exhibits', 'tales'], people: ['residents'], work: ['workshop', 'orders'], lamps: ['lamps'] });

// Agent Deck lives on each machine's own loopback: on the village machine link its local heroes; through a keeper
// (another machine viewing), link only that node's heroes, to the viewer's own Deck.
export function deckLink(worker) {
  const viewer = globalThis.document?.querySelector?.('meta[name="hf-relayed"]')?.getAttribute?.('content');
  const session = !viewer ? (worker?.id?.startsWith('local:') ? worker.id.slice(6) : null) : viewer !== '1' && worker?.node === viewer ? worker.sessionId : null;
  return session ? `${AGENT_DECK_URL}/s/${encodeURIComponent(session)}` : null;
}

export function residentIdentity(r, snapshot) {
  const box = h('div', { class: 'resident-identity' });
  if (r.title || r.role) box.append(h('div', { class: 'resident-title', text: String(r.title || capitalize(r.role)) }));
  if (r.formerNames?.length) box.append(h('div', { class: 'resident-former', text: `formerly ${r.formerNames.join(', ')}` }));
  if (r.role === 'starwatcher') {
    const reading = snapshot.starwatch || {};
    box.append(h('div', { class: 'starwatch-time', text: reading.nextReadingAt ? `Next reading: ${new Date(reading.nextReadingAt).toLocaleString()}` : 'Next reading: not scheduled' }));
    if (reading.running) box.append(h('span', { class: 'pill pill-running', text: 'reading under way' }));
  }
  return box;
}

export function createPanel(opts) {
  const $ = (id) => document.getElementById(id);
  const els = {
    tabs: Array.from(document.querySelectorAll('.drawer-tab')),
    bodies: Array.from(document.querySelectorAll('.tab-body')),
    channels: $('channels'),
    boardScroll: $('board-scroll'),
    posts: $('posts'),
    boardEmpty: $('board-empty'),
    boardSealed: $('board-sealed'),
    projectsStrip: $('projects-strip'),
    composer: $('composer'),
    composerBox: document.querySelector('.composer'),
    send: $('send'),
    composerChannel: $('composer-channel'),
    composerZone: $('composer-zone'),
    replyStrip: $('reply-strip'),
    replyStripText: $('reply-strip-text'),
    replyCancel: $('reply-cancel'),
    exhibits: $('exhibits'),
    exhibitsList: $('exhibits-list'),
    exhibitsSealed: $('exhibits-sealed'),
    residents: $('residents'),
    workshop: $('workshop'),
    badgeWait: $('badge-wait'),
    lamps: $('lamps'),
    zoneSwitches: Array.from(document.querySelectorAll('.zone-switch')),
  };
  let state = {};
  let activeTab = 'board';
  let channel = 'commons';
  let zone = 'village';
  let replyTo = null;
  let residentColors = new Map();
  const postEls = new Map();
  let newPill = null;

  const hasIsle = () => (state.zones || []).some((z) => z && z.id === 'isle');
  const sealed = () => !!(state.seal && state.seal.enabled && state.seal.locked);
  const isleLocked = () => zone === 'isle' && sealed();

  // Keep settings mounted: detaching even the same input loses native focus/caret (and number-input drafts).
  function clearExcept(root, keep) { for (const child of [...root.childNodes]) if (child !== keep) child.remove(); }
  function settingField(controls, key, label, tag, props, save, choices = null) {
    controls._fields ||= new Map();
    let input = controls._fields.get(key);
    if (!input) {
      input = h(tag, props); controls._fields.set(key, input);
      input.addEventListener('input', () => { input._editing = true; });
      input.addEventListener('blur', () => { input._editing = false; });
      input.addEventListener('change', () => input._save(input));
      controls.append(props.type === 'checkbox' ? h('label', {}, input, label) : h('label', {}, label, input));
    }
    input._save = save;
    const editing = document.activeElement === input && input._editing;
    if (!editing) {
      if (choices) {
        const next = JSON.stringify(choices);
        if (input._choices !== next) { input.replaceChildren(...choices.map(([value, text]) => h('option', { value, text }))); input._choices = next; }
      }
      if ('value' in props && input.value !== String(props.value ?? '')) input.value = props.value ?? '';
      if ('checked' in props) input.checked = !!props.checked;
    }
    return input;
  }

  // Gate credentials live only in this dialog, which is destroyed on close.
  function issuePass(kind) {
    const hero = kind === 'heroes', node = kind === 'nodes';
    const dialog = h('dialog', { class: 'dialog pass-dialog' });
    const form = h('form', { autocomplete: 'off' });
    const name = h('input', { class: 'input', required: true, maxlength: 80 });
    const label = h('input', { class: 'input', maxlength: 160 });
    const hours = h('input', { class: 'input', type: 'number', min: 1, max: node ? 2160 : 8760, value: 24, required: true });
    const zoneInput = h('select', { class: 'input' }, h('option', { value: 'village', text: 'Village' }), h('option', { value: 'isle', text: 'Isle' }));
    const error = h('div', { class: 'dialog-error', role: 'alert' });
    const submit = h('button', { class: 'btn btn-primary', type: 'submit', text: 'Issue pass' });
    const close = () => dialog.close();
    form.append(h('h2', { text: `Issue a ${node ? 'node' : hero ? 'hero' : 'visitor'} pass` }),
      h('label', { class: 'field' }, 'Name', name), h('label', { class: 'field' }, 'Label', label),
      h('label', { class: 'field' }, 'Hours', hours));
    if (hero) form.append(h('label', { class: 'field' }, 'Zone', zoneInput));
    form.append(error, h('div', { class: 'dialog-actions' }, h('button', { class: 'btn', type: 'button', text: 'Close', onClick: close }), submit));
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); submit.disabled = true; error.textContent = '';
      const result = await opts.api(`/api/${kind}/pass`, { name: name.value.trim(), label: label.value.trim(), hours: +hours.value, ...(hero ? { zone: zoneInput.value } : {}) });
      if (!dialog.open) return;
      if (!result?.token) { error.textContent = result?.error || 'No token was returned.'; submit.disabled = false; return; }
      const token = result.token;
      form.textContent = '';
      form.append(h('h2', { text: 'Copy your pass now' }), h('p', { text: 'This token is shown once. Closing this dialog clears it.' }));
      const snippet = (title, value) => {
        const field = h('textarea', { class: 'input pass-snippet', readonly: true, rows: 3, 'aria-label': title, text: value });
        form.append(h('label', { class: 'field' }, title, field), h('button', { class: 'btn btn-xs', type: 'button', text: `Copy ${title}`, onClick: async () => {
          try { await navigator.clipboard.writeText(value); } catch (_) { field.focus(); field.select(); }
        } }));
      };
      snippet('token', token);
      if (node) snippet('Node helper', `node tools/amygdala-node.mjs --server ${state.gateUrl || 'http://<gate>:8795'} --pass-file <private-pass-file>`);
      else if (hero) snippet('PowerShell launcher', `.\\amygdala-hero.ps1 -Pass ${token} -Title "My labour" grok`);
      else {
        const base = `${state.gateUrl || 'http://<this-machine-tailscale-ip>:8795'}/visit`;
        snippet('Grok CLI', `grok mcp add --transport http amygdala-visit ${base}/mcp --header "Authorization: Bearer ${token}"`);
        snippet('MCP JSON', JSON.stringify({ mcpServers: { 'amygdala-visit': { type: 'http', url: `${base}/mcp`, headers: { Authorization: `Bearer ${token}` } } } }, null, 2));
        snippet('curl REST', `curl -X POST ${base}/api/look -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" -d '{}'`);
      }
      form.append(h('div', { class: 'dialog-actions' }, h('button', { class: 'btn btn-primary', type: 'button', text: 'Done', onClick: close })));
    });
    dialog.append(form); document.body.append(dialog);
    dialog.addEventListener('close', () => { dialog.textContent = ''; dialog.remove(); }, { once: true });
    dialog.showModal(); name.focus();
  }
  const petitionSeen = new Set();
  let petitionFoldOpen = false; const petitionRowsOpen = new Set(); // survive the redraw on every state update
  let notifyPetitions = false, titleTimer = null;
  let visitorFoldOpen = false;
  const baseTitle = document.title;
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { clearInterval(titleTimer); titleTimer = null; document.title = baseTitle; } });
  function petitionDecision(p, deny = false) {
    const dialog = h('dialog', { class: 'dialog pass-dialog' });
    const answer = h('textarea', { class: 'input', rows: 8, maxlength: 20000, 'aria-label': 'Your answer' });
    const self = h('label', { class: 'dim-note' }, h('input', { type: 'checkbox', 'aria-label': 'Answer myself', onChange: () => { answer.hidden = deny || !self.firstChild.checked; } }), ' Answer myself');
    const note = h('textarea', { class: 'input', rows: 2, maxlength: 2000, placeholder: 'Optional note', 'aria-label': 'Optional note' });
    const error = h('div', { class: 'dialog-error', role: 'alert' });
    answer.hidden = true; self.hidden = deny;
    const decide = async action => {
      const result = await opts.api(`/api/petitions/${encodeURIComponent(p.id)}/${action}`, { ...(self.firstChild.checked && { answerer: 'self', answer: answer.value }), note: note.value });
      if (result?.ok === false) error.textContent = result.error; else dialog.close();
    };
    dialog.append(h('h2', { text: `Guidance for ${p.visitor}` }), h('p', { class: 'petition-text', text: p.question }), self, answer, note, error,
      h('div', { class: 'dialog-actions' }, h('button', { class: 'btn', text: 'Cancel', onClick: () => dialog.close() }), h('button', { class: 'btn', text: 'Deny', onClick: () => decide('deny') }), deny ? null : h('button', { class: 'btn btn-primary', text: 'Allow', onClick: () => decide('allow') })));
    document.body.append(dialog); dialog.addEventListener('close', () => dialog.remove(), { once: true }); dialog.showModal();
  }
  // A petition hero: its link, the relay switch, Close, and the thread (visitor messages and the hero's tagged replies).
  function petitionHero(card, p) {
    const linked = ['commissioning', 'commissioned'].includes(p.status), w = (state.workers || []).find(x => x.id === p.heroId);
    const label = { open: 'linked', private: 'private: relay paused', gone: 'gone', starting: 'starting…', unlinked: 'waiting for the session' }[p.hero] || p.hero || '';
    card.append(h('div', { class: 'dim-note' }, `Hero: ${p.heroTitle}${label ? ` · ${label}` : ''} `, w && p.hero === 'open' && opts.canOpenTerminal?.(w) ? h('button', { class: 'btn btn-xs', text: 'Terminal ▸', onClick: () => opts.onTerminal?.(w) }) : null));
    for (const m of (p.thread || []).slice(-30)) card.append(h('b', { text: m.from === 'hero' ? p.heroTitle : `${p.visitor}${m.status && m.status !== 'delivered' ? ` (${m.status})` : ''}` }), h('p', { class: 'petition-text', text: m.text }));
    if (!linked) return;
    const relay = h('input', { type: 'checkbox', checked: p.relay !== false, onChange: async () => { const r = await opts.api(`/api/petitions/${encodeURIComponent(p.id)}/relay`, { on: relay.checked }); if (r?.ok === false) relay.checked = !relay.checked; } });
    card.append(h('label', { class: 'dim-note' }, relay, ' Relay visitor messages'), ' ',
      h('button', { class: 'btn btn-xs', text: 'Close', title: 'End the link with the visitor; the hero keeps working', onClick: () => opts.api(`/api/petitions/${encodeURIComponent(p.id)}/close`, {}) }));
  }
  function petitionFiles(card, p) {
    const list = h('div', { class: 'petition-files' }), error = h('div', { class: 'dialog-error' }), base = `/api/petitions/${encodeURIComponent(p.id)}/files`;
    const draw = () => {
      list.textContent = '';
      for (const f of p.files || []) list.append(h('div', { class: 'petition-file' }, h('span', { text: `${f.name} · ${f.size.toLocaleString()} bytes` }), h('button', { class: 'btn btn-xs', text: 'Remove', onClick: async () => {
        try { const r = await opts.api(`${base}/remove`, { fileId: f.id }); if (!r?.ok) throw new Error(r?.error || 'Could not remove file.'); p.files = p.files.filter(x => x.id !== f.id); error.textContent = ''; draw(); } catch (e) { error.textContent = e.message; }
      } })));
    };
    const input = h('input', { type: 'file', accept: '.csv,.tsv,.txt,.md,.json', hidden: true, onChange: async () => {
      const file = input.files[0]; if (!file) return;
      try { const r = await opts.api(base, { name: file.name, content: await file.text() }); if (!r?.ok) throw new Error(r?.error || 'Could not attach file.'); (p.files ??= []).push(r.file); error.textContent = ''; draw(); } catch (e) { error.textContent = e.message; } finally { input.value = ''; }
    } });
    draw(); card.append(list, input, h('button', { class: 'btn btn-xs', text: 'Attach a file…', onClick: () => input.click() }), error);
  }
  function renderPetitions(root) {
    const petitions = state.petitions || [], pending = petitions.filter(p => p.status === 'pending');
    const badge = $('badge-petitions'); if (badge) { badge.hidden = !pending.length; badge.textContent = String(pending.length); }
    for (const p of pending) {
      if (!petitionSeen.has(p.id) && notifyPetitions && window.Notification?.permission === 'granted') {
        new Notification('Amygdala: guidance requested', { body: `${p.visitor} is waiting for your decision.` });
        if (document.hidden && !titleTimer) titleTimer = setInterval(() => { document.title = document.title === baseTitle ? 'Guidance awaits · Amygdala' : baseTitle; }, 1200);
      }
      petitionSeen.add(p.id);
    }
    if (!petitions.length) return;
    root.append(h('h2', { text: `Petitions${pending.length ? ` (${pending.length})` : ''}` }));
    const live = ['pending', 'dispatching', 'allowed', 'answering', 'commissioning', 'commissioned'];
    const active = petitions.filter(p => live.includes(p.status));
    const history = petitions.filter(p => !live.includes(p.status)).slice(-20).reverse();
    for (const p of active) root.append(petitionCard(p));
    if (!history.length) return;
    // Finished petitions fold away so the residents stay in view; each opens to its full card on demand.
    const fold = h('details', { class: 'temple-fold petition-history' }, h('summary', { text: `Earlier petitions (${history.length})` })); fold.open = petitionFoldOpen;
    fold.addEventListener('toggle', () => { petitionFoldOpen = fold.open; });
    for (const p of history) {
      const row = h('details', { class: 'petition-row' }, h('summary', {}, h('b', { text: p.visitor }), ` · ${p.about || 'Guidance'} · `, h('span', { class: 'dim-note', text: `${new Date(p.askedAt).toLocaleDateString()} · ${p.status}` })));
      row.open = petitionRowsOpen.has(p.id); if (row.open) row.append(petitionCard(p));
      row.addEventListener('toggle', () => { if (row.open) { petitionRowsOpen.add(p.id); if (row.children.length < 2) row.append(petitionCard(p)); } else petitionRowsOpen.delete(p.id); });
      fold.append(row);
    }
    root.append(fold);
  }
  function petitionCard(p) {
    {
      const card = h('div', { class: 'gate-pass' }, h('b', { text: p.visitor }), h('div', { text: p.about || 'Guidance' }),
        h('div', { class: 'dim-note', text: `${new Date(p.askedAt).toLocaleString()} · ${p.status}${p.depth === 'research' ? ' · research' : ''}` }), h('p', { class: 'petition-text', text: p.question }));
      if (p.status === 'pending') {
        card.append(h('p', { class: 'dim-note' }, h('small', {}, h('i', { text: p.triage?.greeting || `${harbourName()} is reading your question` }))));
        if (p.triage) card.append(h('span', { class: 'chip', text: p.triage.tier }), h('p', { class: 'dim-note', text: `${p.triage.by || harbourName()} suggests ${p.triage.suggest || 'Answer myself'} — ${p.triage.reason}` }));
      }
      if (p.status === 'dispatching') card.append(h('div', { class: 'dim-note', text: `${harbourName()} is choosing who answers…` }));
      if (p.dispatch && p.status !== 'dispatching') card.append(h('div', { class: 'dim-note', text: `${p.dispatch.by === 'fallback' ? 'The village' : p.dispatch.by} sent it to ${p.dispatch.answerer} · ${p.dispatch.depth} · ${p.dispatch.rounds} follow-ups — ${p.dispatch.reason}${p.dispatch.fallback ? ' (fallback)' : ''}` }));
      if (p.answer) card.append(h('b', { text: p.answerer || 'Answer' }), h('p', { class: 'petition-text', text: p.answer }));
      for (const f of p.followups || []) card.append(h('div', { class: 'dim-note', text: 'Visitor follow-up' }), h('p', { class: 'petition-text', text: f.question }), h('p', { class: 'petition-text', text: f.answer || f.status }));
      if (p.rounds != null && p.status === 'answered') card.append(h('div', { class: 'dim-note', text: `${Math.max(0, p.rounds - (p.followups || []).filter(f => f.status !== 'failed').length)} follow-ups left` }));
      if (p.note) card.append(h('p', { class: 'petition-text dim-note', text: p.note }));
      if (p.heroTitle && p.status !== 'pending') petitionHero(card, p);
      if (p.status === 'pending') card.append(h('button', { class: 'btn btn-xs', text: 'Allow…', onClick: () => petitionDecision(p) }), ' ', h('button', { class: 'btn btn-xs', text: 'Deny…', onClick: () => petitionDecision(p, true) }), ' ', h('button', { class: 'btn btn-xs', text: 'Make it a hero…', title: 'Commission a hero for this request; it can talk with the visitor', onClick: () => opts.onPetitionHero?.(p) }));
      if (!['pending', 'declined', 'denied'].includes(p.status)) petitionFiles(card, p);
      return card;
    }
  }
  function renderGate() {
    const root = $('gate'); root.textContent = '';
    const petitionRoot = $('petitions'); if (petitionRoot) { petitionRoot.textContent = ''; renderPetitions(petitionRoot); }
    const fold = h('details', { class: 'temple-fold' }); fold.open = visitorFoldOpen;
    fold.addEventListener('toggle', () => { visitorFoldOpen = fold.open; });
    fold.append(h('summary', { text: 'Visitors & passes' }), h('div', { class: 'panel-settings' }));
    const content = fold.lastChild;
    content.append(h('h2', { text: 'Visitors' }));
    content.append(h('button', { class: 'btn btn-xs', text: notifyPetitions ? 'Notifications on · turn off' : 'Notify me', onClick: async () => {
      if (notifyPetitions) notifyPetitions = false;
      else if (window.Notification) notifyPetitions = (await Notification.requestPermission()) === 'granted';
      renderOrders();
    renderGate();
    } }));
    const date = (ts) => ts ? new Date(ts).toLocaleString() : 'never';
    for (const [kind, key, title] of [['visitors', 'visitorPasses', 'Visitor'], ['heroes', 'heroPasses', 'Hero'], ['nodes', 'nodes', 'Node']]) {
      content.append(h('div', { class: 'temple-section-title', text: `${title} passes` }), h('button', { class: 'btn btn-xs', type: 'button', text: `Issue a ${title.toLowerCase()} pass…`, onClick: () => issuePass(kind) }));
      const list = state[key] || [];
      if (!list.length) content.append(h('p', { class: 'dim-note', text: 'No passes issued.' }));
      for (const pass of list) {
        const revoke = h('button', { class: 'btn btn-xs', type: 'button', text: 'Revoke', disabled: !!pass.revoked });
        revoke.addEventListener('click', async () => { revoke.disabled = true; const result = await opts.api(`/api/${kind}/revoke`, { id: pass.id }); if (result?.ok === false) revoke.disabled = false; });
        content.append(h('div', { class: 'gate-pass' }, h('b', { text: String(pass.name || 'Unnamed') }), ' ',
          kind === 'nodes' ? h('button', { class: 'btn btn-xs', text: pass.notify === false ? 'Notifications off' : 'Notifications on', onClick: () => opts.api('/api/nodes/notify', { id: pass.id, on: pass.notify === false }) }) : null,
          kind === 'heroes' ? h('span', { class: 'chip', text: pass.zone || 'village' }) : null,
          h('div', { text: String(pass.label || '') }), h('div', { class: 'dim-note', text: `${pass.revoked ? 'Revoked · ' : ''}expires ${date(pass.expiresAt)}${kind === 'visitors' ? ` · last seen ${date(pass.lastSeen)}` : ''}` }), revoke));
      }
    }
    root.append(fold);
  }
  let exhibitView = 'art';
  let taleControls = null;
  let taleFold = null;
  let taleSettingsOpen = false;
  let talesDirty = false;
  let talesFocusout = false;
  function renderTales() {
    const root = $('tales');
    if (!talesFocusout) { root.addEventListener('focusout', (e) => { if (root.contains(e.relatedTarget)) return; queueMicrotask(() => { if (!root.contains(document.activeElement) && talesDirty) renderTales(); }); }); talesFocusout = true; }
    const active = document.activeElement;
    // A sealed isle always applies at once; otherwise wait until the human stops typing in a tale.
    if (!isleLocked() && root.contains(active) && !taleControls?.contains(active) && (active?.matches?.('input,textarea,select,[contenteditable="true"]') || active?.isContentEditable)) { talesDirty = true; return; }
    talesDirty = false;
    if (isleLocked() || !state.taleSettings) { taleControls = null; taleFold = null; }
    clearExcept(root, taleFold);
    if (isleLocked()) { renderSealedTablet(root); return; }
    if (state.taleSettings) {
      if (!taleControls) taleControls = h('div', { class: 'panel-settings' }, h('b', { text: 'Epic labours - any threshold earns a tale' }));
      if (!taleFold) { taleFold = h('details', { class: 'temple-fold' }, h('summary', { text: 'Tale settings' }), taleControls); taleFold.open = taleSettingsOpen; taleFold.addEventListener('toggle', () => { taleSettingsOpen = taleFold.open; }); }
      const controls = taleControls, error = controls._error ||= h('span', { role: 'status' });
      for (const [key, label, max] of [['minHours', 'Hours worked', 48], ['minFixed', 'Findings fixed', 1000], ['minCommits', 'Commits', 1000]]) {
        settingField(controls, key, label, 'input', { type: 'number', min: '0', max: String(max), step: key === 'minHours' ? '0.1' : '1', value: state.taleSettings[key], 'aria-label': label },
          async input => { try { const result = await opts.api('/api/tales/settings', { [key]: input.value === '' ? null : +input.value }); error.textContent = result?.error || ''; } catch (e) { error.textContent = e.message; } });
      }
      if (!error.parentNode) controls.append(error);
    }
    // Tales go above the settings fold; the fold itself never moves, so a focused threshold keeps its focus.
    const add = n => taleFold?.parentNode === root ? root.insertBefore(n, taleFold) : root.append(n);
    const list = (state.tales || []).filter((t) => zoneOf(t) === zone).slice().reverse();
    if (!list.length) add(h('div', { class: 'empty', text: 'No labours recorded yet.' }));
    for (const t of list) add(h('article', { class: 'tale-scroll' },
      h('h2', { text: t.tale?.title || (t.owed === false ? 'Labour recorded' : 'The tale is yet to be told') }),
      h('div', { class: 'dim-note', text: `Bard: ${t.bard || (t.owed === false ? 'no tale owed' : 'awaiting a bard')} · ${t.hero || 'Hero'} · ${t.project || '—'} · ${t.site || '—'}` }),
      h('div', { text: `${Math.round((+t.workedMs || 0) / 60000)} minutes worked` }),
      h('div', { class: 'tale-commits' }, (t.commits || []).map((c) => h('span', { class: 'chip', text: String(c) }))),
      h('div', { class: 'dim-note', text: t.stat || 'No committed diffstat recorded.' }),
      h('div', { text: `Omens answered: ${(t.fixed || []).join(' · ') || 'none recorded'}` }),
      t.uncommitted ? h('div', { class: 'dim-note', text: 'Uncommitted changes remain.' }) : null,
      t.words ? h('blockquote', { text: String(t.words) }) : null,
      h('div', { class: 'tale-text', text: t.tale?.text || (t.owed === false ? 'The labour stands as facts.' : 'The tale is yet to be told.') })));
    if (taleFold && taleFold.parentNode !== root) root.append(taleFold);
  }

  let ordersKey = '', finishedOpen = false;
  function orderRecipientSelection(residents, selected) {
    const keep = new Set(residents), prior = selected.includes('all') ? ['all'] : selected.filter(name => keep.has(name));
    return prior;
  }
  function renderOrders() {
    const root = document.getElementById('orders'); if (!root || !state.orders) return;
    if (!root._form) {
      const to = h('div', { class: 'order-to', 'aria-label': 'Recipients' }), headline = h('input', { class: 'input', placeholder: 'Headline (optional)', maxLength: 180, 'aria-label': 'Headline' }), brief = h('textarea', { class: 'input', placeholder: 'Private brief', maxLength: 12000, required: true, 'aria-label': 'Private brief' });
      const submit = h('button', { class: 'btn btn-primary', type: 'submit', text: 'Give an order' }), error = h('div', { class: 'dim-note' });
      const form = h('form', { class: 'order-form' }, h('h3', { text: 'Give an order' }), h('label', { text: 'Recipients' }), to, headline, brief, submit, error);
      form.addEventListener('submit', async e => { e.preventDefault(); submit.disabled = true; const result = await opts.api('/api/orders', { to: (picked => picked.includes('all') ? 'all' : picked)(to._checks.filter(c => c.checked).map(c => c.value)), headline: headline.value, brief: brief.value }); submit.disabled = false; error.textContent = result?.error || ''; if (result?.id) { brief.value = ''; headline.value = ''; } });
      root._form = form; root._to = to; root._list = h('div'); root.append(form, root._list);
    }
    const residents = (state.residents || []).filter(r => r.zone === 'village' && r.enabled && !r.hibernate);
    const key = residents.map(r => r.name).join('|'); if (root._key !== key) {
      const prior = [...(root._to._checks || [])].filter(c => c.checked).map(c => c.value), selected = new Set(orderRecipientSelection(residents.map(r => r.name), prior));
      root._to.textContent = ''; root._to._checks = [];
      const addRecipient = (name, labelText) => { const input = h('input', { type: 'checkbox', value: name }); input.checked = selected.has(name); input.addEventListener('change', () => { if (!input.checked) return; if (name === 'all') { for (const other of root._to._checks) if (other !== input) other.checked = false; } else { const all = root._to._checks.find(c => c.value === 'all'); if (all) all.checked = false; } }); root._to._checks.push(input); root._to.append(h('label', {}, input, h('span', { text: labelText }))); };
      addRecipient('all', 'Whole village'); for (const r of residents) addRecipient(r.name, r.name);
      root._key = key;
    }
    const next = JSON.stringify(state.orders); if (ordersKey === next) return; ordersKey = next;
    const openOrderIds = new Set([...root._list.querySelectorAll('.order-card')].filter(card => card.querySelector('details')?.open).map(card => JSON.parse(card.dataset.orderIds || '[]')[0])); root._list.textContent = '';
    const groups = new Map(); for (const o of state.orders) { const key = o.group || o.id; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(o); }
    const ordered = [...groups.values()].reverse(), finished = [], open = [];
    for (const members of ordered) (members.every(m => ['answered', 'cancelled', 'failed'].includes(m.status)) ? finished : open).push(members);
    const finishedFold = finished.length ? h('details', { class: 'temple-fold' }) : null;
    if (finishedFold) finishedFold.append(h('summary', { text: `Finished orders (${finished.length})` }));
    if (finishedFold) { finishedFold.open = finishedOpen; finishedFold.addEventListener('toggle', () => { finishedOpen = finishedFold.open; }); }
    for (const members of [...open, ...finished]) {
      const o = members[0];
      const counts = new Map(); for (const m of members) counts.set(m.status, (counts.get(m.status) || 0) + 1);
      const summary = members.length > 1 ? `${members.length} residents · ${[...counts].map(([status, count]) => `${count} ${status}`).join(', ')}` : `${o.to} · ${o.status}`;
      const card = h('article', { class: 'order-card' }, h('div', { class: 'dim-note', text: summary }), h('h3', { text: o.headline }), h('p', { text: o.chat || o.error || '' }));
      const details = h('details', {}, h('summary', { text: 'Brief and report' })), content = h('div'); details.append(content);
      details.addEventListener('toggle', async () => { if (!details.open) return; const full = await opts.api(o.group ? `/api/orders/group/${encodeURIComponent(o.group)}` : `/api/orders/${encodeURIComponent(o.id)}`, null, 'GET'); content.textContent = ''; if (!full?.id) { content.textContent = full?.error || 'Could not load order.'; return; } for (const member of full.members || [full]) { if (full.members) content.append(h('h3', { text: member.to })); for (const [label, value] of [['Brief', member.brief], ['Chat', member.chat], ['Report', member.report], ['Data', member.data ? JSON.stringify(member.data, null, 2) : '']]) if (value) content.append(h('h4', { text: label }), h('pre', { text: value })); } });
      card.dataset.orderIds = JSON.stringify(members.map(m => m.id)); details.open = openOrderIds.has(members[0].id);
      card.append(details); for (const m of members) if (['queued', 'working'].includes(m.status)) card.append(h('button', { class: 'btn btn-xs', text: `Cancel ${m.to}`, onClick: () => opts.api(`/api/orders/${encodeURIComponent(m.id)}/cancel`, {}) }));
      if (finishedFold && finished.includes(members)) { if (!finishedFold.parentNode) root._list.append(finishedFold); finishedFold.append(card); } else root._list.append(card);
    }
  }

  // ---- tabs ----
  for (const t of els.tabs) t.addEventListener('click', () => selectTab(t.dataset.tab));
  // WAI-ARIA tabs: arrows move focus and select (wrapping), Home/End jump to the ends; the close button is not in els.tabs.
  function tabKey(e, tabs = els.tabs) {
    const list = [...tabs].filter(t => !t.hidden); const i = list.indexOf(e.target); if (i < 0) return;
    const to = e.key === 'ArrowRight' ? (i + 1) % list.length : e.key === 'ArrowLeft' ? (i - 1 + list.length) % list.length : e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : -1;
    if (to < 0) return;
    e.preventDefault(); selectTab(list[to].dataset.tab); list[to].focus();
  }
  for (const t of els.tabs) t.addEventListener('keydown', tabKey);
  function selectTab(name) {
    if (name === 'tales') { exhibitView = 'tales'; name = 'exhibits'; } else if (name === 'exhibits') exhibitView = 'art';
    if (!els.bodies.some((b) => b.dataset.tab === name)) return;
    activeTab = exhibitView === 'tales' && name === 'exhibits' ? 'tales' : name;
    const destination = VIEW_DESTINATION[activeTab];
    const switcher = document.querySelector('.drawer-switcher');
    const views = DESTINATION_VIEWS[destination] || [activeTab]; // a view outside the four places still opens
    const switcherView = views.includes(activeTab) ? activeTab : views[0];
    for (const t of els.tabs) { const belongs = views.includes(t.dataset.tab); t.hidden = !belongs; const on = t.dataset.tab === switcherView; t.setAttribute('aria-selected', on ? 'true' : 'false'); t.tabIndex = on ? 0 : -1; }
    if (switcher) { switcher.hidden = views.length < 2; switcher.setAttribute('aria-label', `${destination ? destination[0].toUpperCase() + destination.slice(1) : 'Panel'} views`); }
    const title = document.getElementById('drawer-title'); if (title) title.textContent = ({ activity: 'Activity', people: 'People', work: 'Work', lamps: 'Lamps' })[destination] || '';
    for (const b of els.bodies) b.hidden = b.dataset.tab !== name;
    if (name === 'exhibits') { els.exhibits.hidden = exhibitView !== 'art'; $('tales').hidden = exhibitView !== 'tales'; if (exhibitView === 'tales') renderTales(); }
    if (name === 'board') scrollBoardToBottom(true);
    opts.onViewChange?.(name);
  }

  // ---- zone switch ----
  for (const sw of els.zoneSwitches) {
    sw.addEventListener('click', (e) => {
      const b = e.target.closest('[data-zone]');
      if (b) setZone(b.dataset.zone);
      else if (e.target.closest('.seal-setup-btn')) opts.onSetupSeal?.();
    });
  }
  function setZone(z) {
    if (z !== 'village' && z !== 'isle') return;
    if (zone === z) return;
    zone = z;
    renderZoneSwitches();
    els.composerZone.textContent = z === 'isle' ? 'the isle' : 'the village';
    els.posts.textContent = '';
    postEls.clear();
    setReply(null);
    renderBoard(true);
    renderProjectsStrip();
    renderExhibits();
    renderTales();
    renderWorkshop();
    renderLamps();
    scrollBoardToBottom(true);
    opts.onZoneChange?.(z);
  }
  function renderZoneSwitches() {
    const show = hasIsle();
    const countsBy = (list) => {
      const c = { village: 0, isle: 0 };
      for (const x of list || []) if (x) c[zoneOf(x)]++;
      return c;
    };
    const pc = countsBy(state.posts), ec = countsBy(state.exhibits), oc = countsBy(state.offerings);
    for (const sw of els.zoneSwitches) {
      sw.hidden = !show;
      const counts = sw.dataset.for === 'exhibits' ? ec : sw.dataset.for === 'temple' ? oc : sw.dataset.for === 'lamps' ? { village: 0, isle: 0 } : pc;
      for (const b of sw.querySelectorAll('[data-zone]')) {
        b.setAttribute('aria-selected', b.dataset.zone === zone ? 'true' : 'false');
        const n = b.querySelector('.n');
        if (n) n.textContent = counts[b.dataset.zone] ? String(counts[b.dataset.zone]) : '';
        const lock = b.querySelector('.lock');
        if (lock) lock.hidden = !(b.dataset.zone === 'isle' && sealed());
      }
      let setup = sw.querySelector('.seal-setup-btn');
      const offer = show && state.seal && state.seal.enabled === false && zone === 'isle';
      if (offer && !setup) sw.appendChild(h('button', { class: 'btn btn-ghost btn-xs seal-setup-btn', type: 'button', text: 'Seal the isle in runes…' }));
      if (!offer && setup) setup.remove();
    }
  }

  // ---- channels ----
  els.channels.addEventListener('click', (e) => {
    const b = e.target.closest('.subtab');
    if (b) setChannel(b.dataset.channel);
  });
  function setChannel(c) {
    if (!CHANNELS.includes(c)) return;
    channel = c;
    for (const b of els.channels.querySelectorAll('.subtab')) b.setAttribute('aria-selected', b.dataset.channel === c ? 'true' : 'false');
    els.composerChannel.textContent = c;
    setReply(null);
    els.posts.textContent = '';
    postEls.clear();
    renderBoard(true);
    renderProjectsStrip();
    scrollBoardToBottom(true);
  }

  // ---- composer ----
  // @mention autocomplete (names, model nicknames, families, @all)
  const mentionBox = h('div', { class: 'mention-box', hidden: true });
  els.composer.parentElement.appendChild(mentionBox);
  let mentionItems = [], mentionIdx = 0;
  function mentionCandidates(q) {
    const aliases = state.mentionAliases && typeof state.mentionAliases === 'object' ? state.mentionAliases : {};
    const names = Object.keys(aliases).filter((n) => (state.residents || []).some((r) => r && r.name === n && zoneOf(r) === zone));
    const ql = q.toLowerCase();
    const out = [];
    for (const n of names) if (!ql || n.toLowerCase().startsWith(ql)) out.push({ token: n, label: n, who: [n], kind: 'name' });
    const byAlias = new Map();
    for (const n of names) for (const a of aliases[n] || []) { const al = String(a).toLowerCase(); if (al === n.toLowerCase()) continue; if (!byAlias.has(al)) byAlias.set(al, []); byAlias.get(al).push(n); }
    for (const [al, who] of byAlias) if (!ql || al.startsWith(ql)) out.push({ token: al, label: al, who, kind: who.length > 1 ? 'family' : 'nick' });
    const everyone = names.filter((n) => (state.residents || []).find((r) => r && r.name === n)?.rank !== 'priest');
    if (!ql || 'all'.startsWith(ql)) out.push({ token: 'all', label: 'all', who: everyone, kind: 'all' });
    return out.slice(0, 9);
  }
  function mentionQuery() { const v = els.composer.value, c = els.composer.selectionStart ?? v.length; const m = /(^|\s)@([\w.-]*)$/.exec(v.slice(0, c)); return m ? { q: m[2], start: c - m[2].length - 1, end: c } : null; }
  function renderMentions() {
    const mq = mentionQuery();
    if (!mq) { mentionBox.hidden = true; return; }
    mentionItems = mentionCandidates(mq.q);
    mentionBox.textContent = '';
    if (!mentionItems.length) { mentionBox.hidden = true; return; }
    mentionIdx = Math.min(mentionIdx, mentionItems.length - 1);
    mentionItems.forEach((it, i) => {
      const row = h('div', { class: `mention-item ${i === mentionIdx ? 'active' : ''}`, dataset: { i } });
      const r = it.kind === 'name' ? residentByName(it.token) : null;
      if (r) row.append(avatar(r.name, r.color, 'xs'), h('b', { text: `@${it.token}` }), h('span', { class: `chip model ${agentClass(r.agent)}`, text: String(r.model || '') }));
      else row.append(h('b', { text: `@${it.token}` }), h('span', { class: 'mention-arrow', text: '→' }), h('span', { class: 'mention-who', text: it.who.join(', ') }));
      if (it.kind === 'all' || it.who.length > 1) row.append(h('span', { class: 'mention-cost', text: `wakes ${it.who.length} resident${it.who.length === 1 ? '' : 's'}` }));
      row.addEventListener('pointerdown', (e) => { e.preventDefault(); applyMention(i); });
      mentionBox.appendChild(row);
    });
    mentionBox.hidden = false;
  }
  function applyMention(i) {
    const it = mentionItems[i]; const mq = mentionQuery(); if (!it || !mq) return;
    const v = els.composer.value;
    els.composer.value = `${v.slice(0, mq.start)}@${it.token} ${v.slice(mq.end)}`;
    const pos = mq.start + it.token.length + 2; els.composer.setSelectionRange(pos, pos);
    mentionBox.hidden = true; autosize();
  }
  els.composer.addEventListener('keydown', (e) => {
    if (!mentionBox.hidden) {
      if (e.key === 'ArrowDown') { mentionIdx = (mentionIdx + 1) % mentionItems.length; renderMentions(); e.preventDefault(); return; }
      if (e.key === 'ArrowUp') { mentionIdx = (mentionIdx - 1 + mentionItems.length) % mentionItems.length; renderMentions(); e.preventDefault(); return; }
      if (e.key === 'Tab' || e.key === 'Enter') { applyMention(mentionIdx); e.preventDefault(); return; }
      if (e.key === 'Escape') { mentionBox.hidden = true; e.preventDefault(); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    if (e.key === 'Escape') setReply(null);
  });
  els.composer.addEventListener('input', () => { autosize(); mentionIdx = 0; renderMentions(); });
  els.composer.addEventListener('blur', () => setTimeout(() => { mentionBox.hidden = true; }, 120));
  function autosize() {
    els.composer.style.height = 'auto';
    els.composer.style.height = Math.min(120, els.composer.scrollHeight) + 'px';
  }
  els.send.addEventListener('click', send);
  els.replyCancel.addEventListener('click', () => setReply(null));
  async function send() {
    const text = els.composer.value.trim();
    if (!text || isleLocked()) return;
    els.send.disabled = true;
    try {
      const ok = await opts.onPost?.({ text, channel, replyTo: replyTo?.id || null, zone });
      if (ok !== false) { els.composer.value = ''; autosize(); setReply(null); scrollBoardToBottom(true); }
    } finally {
      els.send.disabled = false;
      els.composer.focus();
    }
  }
  function setReply(post) {
    replyTo = post || null;
    els.replyStrip.hidden = !replyTo;
    if (replyTo) els.replyStripText.textContent = `↪ replying to ${replyTo.author}: ${String(replyTo.text || '').slice(0, 80)}`;
  }

  // ---- board ----
  function isNearBottom() {
    const s = els.boardScroll;
    return s.scrollHeight - s.scrollTop - s.clientHeight < 48;
  }
  function scrollBoardToBottom(force) {
    if (force || isNearBottom()) {
      requestAnimationFrame(() => { els.boardScroll.scrollTop = els.boardScroll.scrollHeight; });
      hideNewPill();
    }
  }
  els.boardScroll.addEventListener('scroll', () => { if (isNearBottom()) hideNewPill(); });
  function showNewPill(n) {
    if (!newPill) {
      newPill = h('button', { class: 'btn btn-primary btn-xs new-posts-pill', type: 'button', onClick: () => scrollBoardToBottom(true) });
      els.boardScroll.appendChild(newPill);
    }
    newPill.textContent = `${n} new ↓`;
    newPill.hidden = false;
  }
  function hideNewPill() { if (newPill) newPill.hidden = true; }

  function postById(id) { return (state.posts || []).find((p) => p && p.id === id) || null; }
  function makePost(p) {
    const kind = p.authorKind === 'human' ? 'human' : p.authorKind === 'system' ? 'system' : 'resident';
    const li = h('li', { class: `post ${kind}`, dataset: { id: p.id } });
    if (kind !== 'system') {
      const color = kind === 'human' ? 'var(--human)' : residentColors.get(p.author) || 'var(--other)';
      li.appendChild(avatar(p.author, color));
    }
    const body = h('div', { class: 'post-body' });
    if (kind !== 'system') {
      body.appendChild(h('div', { class: 'post-head' },
        h('span', { class: `post-author ${kind}`, text: String(p.author || '?') }),
        h('span', { class: 'post-time', text: relTime(p.ts), dataset: { ts: p.ts } }),
        h('span', { class: 'post-actions' }, h('button', { class: 'btn btn-ghost btn-xs', type: 'button', text: 'reply', onClick: () => { setReply(p); els.composer.focus(); } })),
      ));
    }
    if (p.replyTo) {
      const parent = postById(p.replyTo);
      body.appendChild(h('div', { class: 'post-reply-line', text: `↪ replying to ${parent ? parent.author : 'an earlier post'}` }));
    }
    body.appendChild(mentionText(String(p.text || '')));
    li.appendChild(body);
    return li;
  }
  // Each @Name takes that resident's own colour (names and personal nicknames); @You, families and unknowns keep the accent.
  // Residents name themselves, so the harbourmaster is found by role rather than by name.
  function harbourName() { return (state.residents || []).find((r) => r && r.role === 'harbourmaster')?.name || 'The harbourmaster'; }
  function mentionColor(tag) {
    const residents = state.residents || [], aliases = state.mentionAliases && typeof state.mentionAliases === 'object' ? state.mentionAliases : {};
    const byName = residents.find((r) => r?.name?.toLowerCase() === tag || (r?.formerNames || []).some((n) => n.toLowerCase() === tag));
    if (byName) return /^#[0-9a-f]{3,8}$/i.test(byName.color || '') ? byName.color : null;
    const owners = Object.keys(aliases).filter((n) => (aliases[n] || []).some((a) => String(a).toLowerCase() === tag));
    const r = owners.length === 1 && residents.find((x) => x?.name === owners[0]);
    return r && /^#[0-9a-f]{3,8}$/i.test(r.color || '') ? r.color : null;
  }
  function mentionText(text) {
    const el = h('div', { class: 'post-text' });
    const parts = text.split(/(@[\w.-]+)/g);
    for (const part of parts) {
      if (!/^@[\w.-]+$/.test(part)) { if (part) el.appendChild(document.createTextNode(part)); continue; }
      const color = mentionColor(part.slice(1).toLowerCase());
      el.appendChild(h('span', { class: 'mention', text: part, ...(color && { style: `color:${color}` }) }));
    }
    return el;
  }
  function renderBoard(fresh) {
    const locked = isleLocked();
    els.boardSealed.hidden = !locked;
    els.composerBox.classList.toggle('disabled', locked);
    els.composer.disabled = locked;
    els.send.disabled = locked;
    if (locked) {
      renderSealedTablet(els.boardSealed);
      els.posts.textContent = ''; postEls.clear();
      els.boardEmpty.hidden = true;
      updateChannelCounts();
      return;
    }
    const posts = (state.posts || []).filter((p) => p && p.channel === channel && zoneOf(p) === zone);
    const nearBottom = fresh || isNearBottom();
    const ids = new Set();
    let added = 0;
    let lastEl = null;
    for (const p of posts) {
      ids.add(p.id);
      let li = postEls.get(p.id);
      if (!li) {
        li = makePost(p);
        postEls.set(p.id, li);
        if (lastEl && lastEl.nextSibling) els.posts.insertBefore(li, lastEl.nextSibling);
        else if (!lastEl && els.posts.firstChild) els.posts.insertBefore(li, els.posts.firstChild);
        else els.posts.appendChild(li);
        added++;
      } else {
        const txt = li.querySelector('.post-text');
        if (txt.textContent !== String(p.text || '')) txt.textContent = String(p.text || '');
      }
      lastEl = li;
    }
    for (const [id, li] of postEls) if (!ids.has(id)) { li.remove(); postEls.delete(id); }
    els.boardEmpty.hidden = posts.length > 0;
    if (added && !fresh) {
      if (nearBottom) scrollBoardToBottom(true);
      else showNewPill(added);
    }
    updateChannelCounts();
  }
  function updateChannelCounts() {
    for (const b of els.channels.querySelectorAll('.subtab')) {
      const n = (state.posts || []).filter((p) => p && p.channel === b.dataset.channel && zoneOf(p) === zone).length;
      let s = b.querySelector('.n');
      if (!s) { s = h('span', { class: 'n' }); b.appendChild(s); }
      s.textContent = n ? String(n) : '';
    }
  }
  function renderSealedTablet(container) {
    const runes = Array.isArray(state.seal?.runes) ? state.seal.runes : [];
    const key = runes.join('\n');
    if (container._key === key) return;
    container._key = key;
    container.textContent = '';
    container.appendChild(runeTablet(runes, { title: 'The isle is sealed', hint: 'Its records are held in runes until the seal is broken.', onBreak: () => opts.onBreakSeal?.() }));
  }

  // ---- exhibits ----
  const exhibitEls = new Map();
  function renderExhibits() {
    const locked = isleLocked();
    els.exhibitsSealed.hidden = !locked;
    els.exhibitsList.hidden = locked;
    if (locked) { renderSealedTablet(els.exhibitsSealed); return; }
    const list = (state.exhibits || []).filter((e) => e && e.id && zoneOf(e) === zone);
    const ids = new Set();
    const ordered = [...list].reverse();
    let prev = null;
    for (const ex of ordered) {
      ids.add(ex.id);
      let card = exhibitEls.get(ex.id);
      if (!card) { card = makeExhibit(ex); exhibitEls.set(ex.id, card); }
      if (prev) { if (prev.nextSibling !== card) els.exhibitsList.insertBefore(card, prev.nextSibling); }
      else if (els.exhibitsList.firstChild !== card) els.exhibitsList.insertBefore(card, els.exhibitsList.firstChild);
      prev = card;
    }
    for (const [id, c] of exhibitEls) if (!ids.has(id)) { c.remove(); exhibitEls.delete(id); }
    let empty = els.exhibitsList.querySelector('.empty');
    if (!list.length && !empty) els.exhibitsList.appendChild(h('div', { class: 'empty', text: zone === 'isle' ? 'Nothing has been made on the isle yet.' : 'No exhibits yet. The studio is quiet.' }));
    if (list.length && empty) empty.remove();
  }
  function makeExhibit(ex) {
    const card = h('div', { class: 'exhibit', dataset: { id: ex.id } });
    const place = (state.places || []).find((p) => p && p.id === ex.placeId);
    card.appendChild(h('div', { class: 'exhibit-head' },
      h('span', { class: 'exhibit-kind', text: String(ex.kind || '') }),
      h('span', { class: 'exhibit-title', text: String(ex.title || 'Untitled') }),
      h('span', { class: 'exhibit-by', text: `${ex.author || '?'}${place ? ` · ${place.name}` : ''} · ${relTime(ex.ts)}` }),
    ));
    const kind = ex.kind;
    if (kind === 'pixelart') card.appendChild(renderPixelart(ex.content));
    else if (kind === 'melody') card.appendChild(renderMelody(ex.content));
    else {
      const text = typeof ex.content === 'string' ? ex.content : '';
      const t = h('div', { class: `exhibit-text ${kind === 'poem' ? 'poem' : 'story'}`, text });
      card.appendChild(t);
      if (text.length > 280 || text.split('\n').length > 7) {
        t.classList.add('clamped');
        const more = h('button', { class: 'btn btn-ghost btn-xs exhibit-more', type: 'button', text: 'Read more' });
        more.addEventListener('click', () => { more.textContent = t.classList.toggle('clamped') ? 'Read more' : 'Show less'; });
        card.appendChild(more);
      }
    }
    return card;
  }
  function renderPixelart(content) {
    const wrap = h('div', { class: 'pixelart-wrap' });
    const canvas = h('canvas', { class: 'pixelart', width: 16, height: 16 });
    wrap.appendChild(canvas);
    try {
      const palette = Array.isArray(content?.palette) ? content.palette : [];
      const rows = Array.isArray(content?.rows) ? content.rows : [];
      const ctx = canvas.getContext('2d');
      for (let y = 0; y < 16; y++) {
        const row = String(rows[y] || '');
        for (let x = 0; x < 16; x++) {
          const ch = row[x];
          if (ch == null || ch === '.') continue;
          const col = palette[ch.charCodeAt(0) - 48];
          if (typeof col !== 'string' || !/^#[0-9a-f]{3,8}$/i.test(col)) continue;
          ctx.fillStyle = col;
          ctx.fillRect(x, y, 1, 1);
        }
      }
    } catch (_) { /* malformed content: leave transparent */ }
    return wrap;
  }
  function renderMelody(content) {
    const notes = Array.isArray(content?.notes) ? content.notes.map(String).slice(0, 128) : [];
    const tempo = Math.max(30, Math.min(300, +content?.tempo || 96));
    const row = h('div', { class: 'melody' });
    const btn = h('button', { class: 'btn btn-primary melody-play', type: 'button', text: '▶', 'aria-label': 'Play melody' });
    const bars = h('div', { class: 'melody-notes' });
    const pitches = notes.map(noteMidi);
    const valid = pitches.filter((p) => p != null);
    const lo = valid.length ? Math.min(...valid) : 60, hi = valid.length ? Math.max(...valid) : 72;
    const noteEls = notes.map((n, i) => {
      const m = pitches[i];
      const bar = h('div', { class: `melody-note ${m == null ? 'rest' : ''}`, title: n });
      bar.style.height = m == null ? '2px' : `${20 + ((m - lo) / Math.max(1, hi - lo)) * 80}%`;
      bars.appendChild(bar);
      return bar;
    });
    let playing = null;
    btn.addEventListener('click', () => {
      if (playing) { playing.stop(); playing = null; btn.textContent = '▶'; return; }
      playing = playMelody(notes, tempo, (i) => noteEls.forEach((e, j) => e.classList.toggle('on', j === i)),
        () => { playing = null; btn.textContent = '▶'; noteEls.forEach((e) => e.classList.remove('on')); });
      btn.textContent = '■';
    });
    row.append(btn, bars, h('span', { class: 'melody-meta', text: `♩ ${tempo} · ${notes.length} notes` }));
    return row;
  }

  // ---- commitments ----
  function allCommitments() { return (state.commitments || []).filter((c) => c && c.id && c.ownerId); }
  function commitmentsFor(name) {
    const now = Date.now();
    return allCommitments().filter((c) => c.ownerId === name && (c.status === 'active' || now - (+c.updatedAt || 0) < DAY));
  }
  function renderProjectsStrip() {
    const strip = els.projectsStrip;
    if (channel !== 'projects' || isleLocked()) { strip.hidden = true; return; }
    const now = Date.now();
    const list = allCommitments().filter((c) => zoneOf(c) === zone && (c.status === 'active' || (c.status === 'done' && now - (+c.updatedAt || 0) < DAY)));
    list.sort((a, b) => (a.status === b.status ? (+b.updatedAt || 0) - (+a.updatedAt || 0) : a.status === 'active' ? -1 : 1));
    const key = list.map((c) => `${c.id}:${c.status}:${c.updatedAt}:${c.nextAction}:${c.blockedOn}`).join('|');
    strip.hidden = list.length === 0;
    if (strip._key === key) return;
    strip._key = key;
    strip.textContent = '';
    strip.appendChild(h('div', { class: 'strip-title', text: `Projects in progress · ${list.filter((c) => c.status === 'active').length} active` }));
    for (const c of list) strip.appendChild(commitmentEl(c, { compact: false }));
  }

  // ---- residents ----
  const residentRows = new Map();
  let isleDivider = null;
  function renderResidents() {
    const list = (state.residents || []).filter((r) => r && r.name);
    const active = new Set((state.world?.activeTurns || [state.world?.activeTurn].filter(Boolean)).map(t => t.resident));
    const names = new Set();
    const ordered = [...list.filter((r) => zoneOf(r) === 'village'), ...list.filter((r) => zoneOf(r) === 'isle')];
    const isleCount = list.filter((r) => zoneOf(r) === 'isle').length;
    if (!isleDivider) isleDivider = h('div', { class: 'zone-divider' }, h('span', { text: 'On the Far Isle' }), h('span', { class: 'zone-divider-lock', text: ' · sealed' }));
    isleDivider.querySelector('.zone-divider-lock').hidden = !sealed();
    let prev = null;
    let dividerPlaced = false;
    for (const r of ordered) {
      names.add(r.name);
      if (!dividerPlaced && zoneOf(r) === 'isle') {
        dividerPlaced = true;
        if (prev) { if (prev.nextSibling !== isleDivider) els.residents.insertBefore(isleDivider, prev.nextSibling); }
        else if (els.residents.firstChild !== isleDivider) els.residents.insertBefore(isleDivider, els.residents.firstChild);
        prev = isleDivider;
      }
      let row = residentRows.get(r.name);
      if (!row) { row = makeResidentRow(r); residentRows.set(r.name, row); }
      updateResidentRow(row, r, active);
      if (prev) { if (prev.nextSibling !== row) els.residents.insertBefore(row, prev.nextSibling); }
      else if (els.residents.firstChild !== row) els.residents.insertBefore(row, els.residents.firstChild);
      prev = row;
    }
    if (!isleCount && isleDivider.isConnected) isleDivider.remove();
    for (const [n, row] of residentRows) if (!names.has(n)) { row.remove(); residentRows.delete(n); }
    if (list.length) els.residents.querySelector('.empty')?.remove();
    else if (!els.residents.querySelector('.empty')) els.residents.appendChild(h('div', { class: 'empty', text: 'No residents yet.' }));
  }
  function makeResidentRow(r) {
    const row = h('div', { class: 'resident-row', dataset: { name: r.name } });
    row._avatar = avatar(r.name, r.color);
    row._name = h('div', { class: 'resident-name' }, h('span', { class: 'nm', text: r.name }));
    row._dot = h('span', { class: 'turn-dot', title: 'taking a turn' });
    row._chips = h('div', { class: 'resident-chips' });
    row._meta = h('div', { class: 'resident-meta' });
    row._persona = h('div', { class: 'resident-persona' });
    row._personaText = h('div');
    row._personaView = clamped(`resident:${r.name}`, row._personaText, String(r.persona || ''), 6);
    row._facts = h('div', { class: 'resident-facts' });
    row._modelTitle = h('h4', { class: 'resident-section-title', text: 'Model' }); row._model = h('div', { class: 'resident-facts' });
    row._rhythmTitle = h('h4', { class: 'resident-section-title', text: 'Rhythm' }); row._rhythm = h('div', { class: 'resident-facts' });
    row._allowanceTitle = h('h4', { class: 'resident-section-title', text: 'Allowance' }); row._allowance = h('div', { class: 'resident-facts' });
    row._commits = h('div', { class: 'resident-commits' });
    row._postsTitle = h('h4', { class: 'resident-section-title', text: 'Recent posts' }); row._posts = h('div', { class: 'resident-posts' });
    row._exhibits = h('button', { class: 'btn btn-ghost btn-xs resident-exhibits', type: 'button' });
    row._exhibits.addEventListener('click', () => selectTab('exhibits'));
    row._aboutTitle = h('h4', { class: 'resident-section-title', text: 'About' });
    row._commitTitle = h('h4', { class: 'resident-section-title', text: 'Commitments' });
    row._participationTitle = h('h4', { class: 'resident-section-title', text: 'Participation' });
    row._toggle = h('button', { class: 'btn btn-ghost btn-xs row-toggle', type: 'button', 'aria-controls': `resident-more-${r.name}`, dataset: { key: `resident:${r.name}` } });
    row._more = h('div', { class: 'resident-more', id: `resident-more-${r.name}` }, row._aboutTitle, row._persona, row._facts, row._modelTitle, row._model, row._rhythmTitle, row._rhythm, row._allowanceTitle, row._allowance, row._commitTitle, row._commits, row._postsTitle, row._posts, row._exhibits);
    row._persona.appendChild(row._personaView);
    row._switch = h('button', { class: 'switch', type: 'button', role: 'switch', 'aria-checked': 'true', title: 'Include in turns' });
    row._switch.addEventListener('click', () => {
      const on = row._switch.getAttribute('aria-checked') === 'true';
      row._switch.setAttribute('aria-checked', on ? 'false' : 'true');
      opts.onToggleResident?.(r.name, !on);
    });
    row._wake = h('button', { class: 'btn btn-xs', type: 'button', text: 'Wake now' });
    row._wake.addEventListener('click', () => opts.onWake?.(r.name));
    row._hibernate = h('button', { class: 'btn btn-xs', type: 'button', text: 'Hibernate' });
    row._hibernate.addEventListener('click', () => opts.onHibernate?.(r.name, row._hibernate.dataset.on !== 'true'));
    row._identity = h('div');
    const mid = h('div', {}, row._name, row._identity, row._chips, row._meta);
    row._switchLabel = h('label', { class: 'resident-switch-label' }, row._switch, h('span', { text: 'In turns' }));
    row._participation = h('div', { class: 'resident-ctl' }, row._participationTitle, row._switchLabel, row._hibernate);
    row._wakeSection = h('div', { class: 'resident-wake' }, row._wake);
    row._toggle.addEventListener('click', (e) => { e.stopPropagation(); if (residentOpen.has(row.dataset.name)) residentOpen.delete(row.dataset.name); else residentOpen.add(row.dataset.name); applyResidentOpen(row); });
    row.append(row._avatar, mid, row._toggle, row._more, row._participation, row._wakeSection);
    return row;
  }
  function applyResidentOpen(row) { const open = residentOpen.has(row.dataset.name); row._more.hidden = row._participation.hidden = row._wakeSection.hidden = !open; row._toggle.setAttribute('aria-expanded', String(open)); row._toggle.textContent = open ? 'Less ▴' : 'More ▾'; }
  function updateResidentRow(row, r, active) {
    row.classList.toggle('off', r.enabled === false);
    row.classList.toggle('sealed', r.mood === 'sealed');
    row._avatar.style.background = safeCssColor(r.color);
    const isActive = active.has(r.name);
    if (isActive && !row._dot.isConnected) row._name.appendChild(row._dot);
    if (!isActive && row._dot.isConnected) row._dot.remove();
    const chipKey = `${r.agent}|${r.model}|${r.effort}|${zoneOf(r)}|${r.rank}`;
    if (row._chipKey !== chipKey) {
      row._chipKey = chipKey;
      row._chips.textContent = '';
      row._chips.append(...[
        h('span', { class: `chip ${agentClass(r.agent)}`, text: String(r.agent || 'agent') }),
        h('span', { class: `chip model ${agentClass(r.agent)}`, text: `${r.model || ''}${r.effort ? ` · ${r.effort}` : ''}` }),
        zoneOf(r) === 'isle' ? h('span', { class: 'chip chip-isle', text: 'isle' }) : null,
        r.rank ? h('span', { class: `chip chip-rank rank-${r.rank}`, text: r.rank === 'priest' ? '☀ High Priest' : r.rank === 'high' ? '✦ high' : 'low' }) : null,
      ].filter(Boolean));
    }
    row._hibernate.dataset.on = String(!!r.hibernate); row._hibernate.textContent = r.hibernate ? 'Clear hibernation' : 'Hibernate';
    row._meta.textContent = '';
    if (r.hibernating) row._meta.append(h('span', { class: 'dim', text: '💤 hibernating · ' }));
    if (r.onBackup) row._meta.append(h('span', { class: 'dim', text: `⇄ ${r.model} at the wheel · `, title: `Backup for ${r.primaryModel}` }));
    row._meta.append(
      h('span', { text: `${r.mood ? capitalize(r.mood) : '—'}` }),
      h('span', { class: 'dim', text: ' · ' }),
      h('span', { text: r.mood === 'sealed' ? 'beyond the seal' : String(r.doing || 'idle') }),
      h('span', { class: 'dim', text: ` · ${+r.turns || 0} turn${(+r.turns || 0) === 1 ? '' : 's'}` }),
    );
    const privateRow = r.mood === 'sealed' || zoneOf(r) === 'isle';
    row._personaText.textContent = privateRow ? '' : String(r.persona || '');
    row._aboutTitle.hidden = privateRow || (!r.persona && !r.role && !r.title && !r.appearance && !r.formerNames?.length);
    row._facts.textContent = '';
    if (!privateRow) {
      const facts = [r.role || '' /* the title already heads the row */, r.appearance ? (r.appearance.motto ? `“${r.appearance.motto}”` : '') : 'plain clay', r.formerNames?.length ? `once: ${r.formerNames.join(', ')}` : ''].filter(Boolean);
      row._facts.textContent = facts.join(' · ');
      row._persona.hidden = !r.persona;
    } else { row._facts.textContent = ''; row._persona.hidden = true; }
    const usage = state.usage?.village?.weeklyPerTurn?.[r.name];
    row._model.textContent = privateRow ? '' : `${r.model || ''}${r.effort ? ` (${r.effort} effort)` : ''}${r.onBackup && r.primaryModel && r.primaryModel !== r.model ? ` · on backup for ${r.primaryModel}` : ''}${r.agent ? ` · ${r.agent}` : ''}`;
    row._modelTitle.hidden = privateRow; row._model.hidden = privateRow;
    const rhythm = privateRow ? [] : [`${+r.turns || 0} turns`, r.lastTurnAt ? `last turn ${relTime(r.lastTurnAt)}` : '', r.hibernating ? `hibernating since ${relTime(r.hibernatingSince)}${r.hibernateReason ? `: ${r.hibernateReason}` : ''}` : '', (Array.isArray(r.parallel) ? r.parallel.length : +r.parallel) > 0 ? `${Array.isArray(r.parallel) ? r.parallel.length : +r.parallel} parallel orders` : ''].filter(Boolean);
    row._rhythm.textContent = rhythm.join(' · '); row._rhythmTitle.hidden = row._rhythm.hidden = privateRow;
    const setAside = Object.entries(usage?.reasons || {}).map(([k, n]) => `${k} ×${n}`).join(', '); // reasons are { reason: count }
    row._allowance.textContent = !privateRow && usage ? `${usage.perTurnPct == null ? 'no clean sample yet' : `≈${usage.perTurnPct}% of the ${usage.window} per turn`}, ${usage.samples} sample${usage.samples === 1 ? '' : 's'}${usage.discarded > 0 ? ` · ${usage.discarded} set aside${setAside ? `: ${setAside}` : ''}` : ''}` : '';
    row._allowanceTitle.hidden = row._allowance.hidden = privateRow || !usage;
    const mine = privateRow ? [] : commitmentsFor(r.name).filter((c) => c.status === 'active' || (c.status === 'done' && Date.now() - (+c.updatedAt || 0) < DAY));
    const ckey = mine.map((c) => `${c.id}:${c.status}:${c.updatedAt}:${c.nextAction}:${c.blockedOn}`).join('|');
    if (row._ckey !== ckey) {
      row._ckey = ckey;
      row._commits.textContent = '';
      for (const c of mine) row._commits.appendChild(commitmentEl(c, { compact: true }));
    }
    row._commitTitle.hidden = privateRow || !mine.length;
    const posts = privateRow ? [] : (state.posts || []).filter(p => p && p.author === r.name && (!p.zone || p.zone === 'village')).sort((a, b) => (+b.ts || 0) - (+a.ts || 0)).slice(0, 3);
    row._posts.replaceChildren(...posts.map(p => h('div', { class: 'resident-post', text: `${String(p.text || p.body || '').slice(0, 140)}${String(p.text || p.body || '').length > 140 ? '…' : ''}${p.ts ? ` · ${relTime(p.ts)}` : ''}` })));
    row._postsTitle.hidden = row._posts.hidden = privateRow || !posts.length;
    const exhibitCount = privateRow ? 0 : (state.exhibits || []).filter(e => e && e.author === r.name && (!e.zone || e.zone === 'village')).length;
    row._exhibits.textContent = `${exhibitCount} exhibits`; row._exhibits.hidden = privateRow || !exhibitCount;
    row._switch.setAttribute('aria-checked', r.enabled === false ? 'false' : 'true');
    row._wake.disabled = isActive || r.mood === 'sealed';
    row._identity.replaceChildren(residentIdentity(r, state));
    applyResidentOpen(row);
  }

  // ---- temple: gods (sessions), offerings, findings, the Tablet of Omens ----
  function quarantineKeys() {
    const set = new Set((state.quarantine || []).map(String));
    for (const w of state.workshops || []) if (w && zoneOf(w) === 'isle') set.add(`${w.project}@${w.host}`);
    return set;
  }
  const SEV_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
  const sev = (f) => (SEV_ORDER[f.severity] != null ? f.severity : 'low');
  function offeringsInZone() { return (state.offerings || []).filter((o) => o && o.id && zoneOf(o) === zone); }
  function findingsFor(offeringId) {
    return (state.findings || []).filter((f) => f && f.id && zoneOf(f) === zone && f.offeringId === offeringId).sort((a, b) => SEV_ORDER[sev(a)] - SEV_ORDER[sev(b)]);
  }
  function isOmenPending(f) { return f.status === 'omen' || (f.status === 'decreed' && f.delivery?.state !== 'landed'); }
  const TABLET_STATUSES = ['awaiting_confirmation', 'omen', 'decreed', 'fixed', 'rejected', 'insufficient_evidence'];
  const statusLabel = (s) => ({ awaiting_confirmation: 'awaiting confirmation', omen: 'omen', decreed: 'decree', fixed: 'fixed', rejected: 'set aside', insufficient_evidence: 'insufficient evidence', needs_context: 'needs context', refuted: 'refuted', disputed: 'disputed', open: 'open' })[s] || s;
  const shortHash = (s) => (s ? String(s).slice(0, 7) : '');
  function omenCount() { return (state.findings || []).filter((f) => f && isOmenPending(f)).length; }
  function residentByName(n) { return (state.residents || []).find((r) => r && r.name === n); }
  function providerChip(provider, label) {
    const p = String(provider || '').toLowerCase();
    const cls = p.includes('anthropic') ? 'chip-claude' : p.includes('openai') ? 'chip-codex' : p.includes('google') || p.includes('gemini') ? 'chip-gemini' : p.includes('xai') || p.includes('grok') ? 'chip-grok' : 'chip-other';
    return h('span', { class: `chip ${cls}`, text: String(label || provider || '?') });
  }
  function rankChip(name) {
    const r = residentByName(name);
    const rank = r?.rank;
    if (!rank) return null;
    return h('span', { class: `chip chip-rank rank-${rank}`, text: rank === 'priest' ? '☀ priest' : rank === 'high' ? '✦ high' : 'low' });
  }

  // The tab reads top-down by urgency: what needs the human, the heroes at work, then history and settings folded away.
  // It re-renders on every snapshot, so fold, strip and clamp state is remembered here for the session.
  let settingsFold = null;
  let workshopDirty = false, workshopFocusout = false;
  function renderWorkshop() {
    const root = els.workshop, active = document.activeElement;
    if (!workshopFocusout) { root.addEventListener('focusout', (e) => { if (root.contains(e.relatedTarget)) return; queueMicrotask(() => { if (!root.contains(document.activeElement) && workshopDirty) renderWorkshop(); }); }); workshopFocusout = true; }
    // Like Tales: an open site picker or a half-typed answer waits for focus to leave; Settings keeps its own fold, a sealed isle applies at once.
    if (!isleLocked() && root.contains(active) && !settingsFold?.contains(active) && (/^(INPUT|TEXTAREA|SELECT)$/.test(active?.tagName || '') || active?.isContentEditable)) { workshopDirty = true; return; }
    workshopDirty = false;
    if (zone !== 'village' || !(state.steward || state.auditSettings)) settingsFold = null;
    const focusKey = els.workshop.contains(document.activeElement) ? document.activeElement?.dataset?.key : null;
    clearExcept(els.workshop, settingsFold);
    if (isleLocked()) {
      const t = h('div');
      renderSealedTablet(t);
      els.workshop.appendChild(t.firstChild);
      renderGods();
      if (focusKey) [...els.workshop.querySelectorAll('button')].find((el) => el.dataset.key === focusKey)?.focus();
      return;
    }
    renderNeedsYou();
    renderGods();
    renderOfferings();
    renderGovernance();
    renderTablet();
    renderHall();
    renderSettings();
    // Move the refreshed content ahead of Settings, never Settings itself while an input may have focus.
    while (settingsFold?.nextSibling) els.workshop.insertBefore(settingsFold.nextSibling, settingsFold);
    if (focusKey) [...els.workshop.querySelectorAll('button')].find((el) => el.dataset.key === focusKey)?.focus();
  }
  const foldOpen = { offerings: false, governance: false, tablet: false, hall: false, settings: false };
  const needOpen = new Set(), expanded = new Set(), heroOpen = new Set(), residentOpen = new Set();
  let offeringsAll = false;
  function foldSection(key, label, count, ...extra) {
    const d = h('details', { class: 'temple-fold', id: key === 'hall' ? 'hall-heroes' : `fold-${key}` }); d.open = !!foldOpen[key];
    d.addEventListener('toggle', () => { foldOpen[key] = d.open; });
    d.appendChild(h('summary', { class: 'temple-section-title' }, h('span', { text: label }), count != null ? h('span', { class: 'count', text: String(count) }) : null, ...extra));
    return d;
  }
  // Long text clamps to a few lines behind a toggle. Cards are built before layout (and inside closed folds), so the
  // decision comes from the text itself rather than from measuring it.
  function clamped(key, el, text, lines = 6) {
    const t = String(text ?? '');
    if ((t.match(/\n/g) || []).length + 1 <= lines && t.length <= lines * 90) return el;
    const box = h('div', { class: `clamp ${expanded.has(key) ? 'expanded' : ''}` }, el);
    const toggle = h('button', { class: 'btn btn-ghost btn-xs clamp-toggle', type: 'button', text: expanded.has(key) ? 'Show less' : 'Show more' });
    toggle.addEventListener('click', (e) => { e.stopPropagation(); const open = box.classList.toggle('expanded'); if (open) expanded.add(key); else expanded.delete(key); toggle.textContent = open ? 'Show less' : 'Show more'; });
    box.appendChild(toggle);
    return box;
  }
  function heroesInZone() {
    const q = quarantineKeys();
    const isQ = (w) => q.has(`${w.project}@${w.host}`) || zoneOf(w) === 'isle';
    return (state.workers || []).filter((w) => w && w.id && (zone === 'isle') === isQ(w));
  }
  const waitingHero = (w) => zone === 'village' && w.status === 'waiting' && w.needsPermission && !w.stale;
  function needsJudgement(f) { return isOmenPending(f) || f.status === 'awaiting_confirmation'; }
  // Only what the human alone can move (v0.46): permission prompts and governance escalations. Routine Temple work lives
  // in its own sections below, live items first.
  const escalations = () => (zone === 'village' ? state.governance?.digest || [] : []).filter((d) => d && d.escalation);
  // The header's count is the village's, whichever zone the drawer shows and even while the Temple waits for typing.
  function villageNeedsCount() {
    const q = quarantineKeys();
    const heroes = (state.workers || []).filter((w) => w && w.id && !q.has(`${w.project}@${w.host}`) && zoneOf(w) !== 'isle' && w.status === 'waiting' && w.needsPermission && !w.stale);
    return heroes.length + (state.governance?.digest || []).filter((d) => d && d.escalation).length;
  }
  function renderNeedsYou() {
    const heroes = heroesInZone().filter(waitingHero), escs = escalations();
    const n = heroes.length + escs.length;
    els.workshop.appendChild(h('div', { class: 'temple-section-title needs-title' }, h('span', { text: 'Needs you' }), n ? h('span', { class: 'count count-need', text: String(n) }) : null));
    if (!n) { els.workshop.appendChild(h('div', { class: 'empty needs-none', text: 'Nothing needs you' })); return; }
    const strip = h('div', { class: 'needs-you' });
    for (const w of heroes) {
      const counsel = (state.counsel || []).filter((c) => c && c.workerId === w.id && c.status === 'new').length;
      const item = h('button', { class: 'need need-hero', type: 'button' }, h('span', { class: 'need-head' }, h('span', { class: 'pill pill-waiting', text: 'needs you' }), h('span', { class: 'need-name', text: String(w.title || w.id) }),
        h('span', { class: `chip ${agentClass(w.tool)}`, text: String(w.tool || 'tool') }), counsel ? h('span', { class: 'chip chip-other', text: `${counsel} counsel` }) : null,
        h('span', { class: 'need-sub', text: `${w.project || ''} · at ${siteList().find((s) => s.id === w.site)?.label || w.site || '?'}` })));
      item.addEventListener('click', () => { const row = [...els.workshop.querySelectorAll('.worker-row')].find((el) => el.dataset.workerId === w.id); if (!row) return; for (let p = row.parentElement; p && p !== els.workshop; p = p.parentElement) if (p.tagName === 'DETAILS') p.open = true; row.scrollIntoView?.({ block: 'nearest' }); row.classList.add('flash'); setTimeout(() => row.classList.remove('flash'), 1200); });
      strip.appendChild(item);
    }
    for (const d of escs) {
      const o = offeringsInZone().find((x) => x.id === d.offeringId);
      strip.appendChild(needItem(`g:${d.offeringId}`, 'offering', [h('span', { class: 'pill pill-error', text: 'your decision' }), h('span', { class: 'need-name', text: String(o?.title || d.project || d.offeringId) }),
        h('span', { class: 'worker-path', text: `${d.project || ''} ${shortHash(d.sha)}` }), h('span', { class: 'need-sub', text: String(d.text || '') })], () => (o ? offeringCard(o) : h('div', { class: 'dim-note', text: String(d.text || '') }))));
    }
    els.workshop.appendChild(strip);
  }
  function needItem(key, kind, head, build) {
    const d = h('details', { class: `need need-${kind}` }); d.open = needOpen.has(key);
    d.addEventListener('toggle', () => { if (d.open) needOpen.add(key); else needOpen.delete(key); });
    d.append(h('summary', { class: 'need-head' }, ...head.filter(Boolean)), h('div', { class: 'need-body' }, build()));
    return d;
  }
  const hallErrors = new Map(), hallBusy = new Set();
  function renderHall() {
    if (zone !== 'village' || !state.hall) return;
    const details = foldSection('hall', 'Hall of Heroes', state.hall.length);
    for (const w of state.hall) {
      const row = h('div', { class: 'panel-settings' }, h('b', { text: w.title }), h('p', { text: `${w.tool} · ${w.model || 'unknown model'} · ${w.host} (${w.os || 'unknown OS'}) · ${w.project} · ${w.lastActivityAt == null ? 'activity unknown' : new Date(w.lastActivityAt).toLocaleString()}` }));
      if (w.messages?.length) row.append(h('details', { class: 'hero-messages' }, h('summary', { text: `Messages (${w.messages.length})` }), ...w.messages.map(m => h('div', { class: 'hero-message' }, h('div', { class: 'dim-note', text: `${m.from === 'keeper' ? 'Keeper' : 'Hero'} · ${relTime(m.ts) || 'just now'}${m.status === 'sending' ? ' · waiting for a reply…' : m.status === 'failed' ? ` · failed: ${m.note || 'not delivered'}` : ''}` }), m.status === 'sending' ? null : h('div', { class: 'hero-message-text', text: m.text })))));
      for (const action of ['revive', 'tale', 'forget']) {
        const key = `${w.id}:${action}`, error = h('span', { role: 'status', text: hallErrors.get(key) || '' });
        const button = h('button', { class: 'btn btn-xs', type: 'button', text: action === 'revive' ? 'Revive' : action === 'tale' ? 'Tell the tale' : 'Forget', disabled: hallBusy.has(w.id) });
        button.addEventListener('click', async () => {
          if (action === 'forget' && !confirm(`Forget “${w.title}” from agent-deck? It can't be revived afterwards.`)) return;
          hallBusy.add(w.id); button.disabled = true; error.textContent = '';
          try { const result = await opts.api(action === 'tale' ? '/api/tales/complete' : `/api/heroes/${action}`, { workerId: w.id }); if (!result || result.ok === false || result.error) throw new Error(result?.error || 'Action failed.'); hallErrors.delete(key); }
          catch (e) { hallErrors.set(key, e.message); error.textContent = e.message; }
          finally { hallBusy.delete(w.id); button.disabled = false; }
        }); row.append(button, error);
      }
      details.append(row);
    }
    els.workshop.append(details);
  }
  function renderGods() {
    const workers = (state.workers || []).filter((w) => w && w.id);
    const inZone = heroesInZone();
    const title = h('div', { class: 'temple-section-title' }, h('span', { text: zone === 'isle' ? 'Heroes in quarantine' : 'Heroes' }), h('span', { class: 'count', text: String(inZone.length) }));
    if (zone === 'village') {
      const send = h('button', { class: 'btn btn-primary btn-xs send-god', type: 'button', text: 'Send a hero on a labour…', title: 'Commission a new real session at a site across the river' });
      send.addEventListener('click', () => opts.onCommission?.());
      title.appendChild(send);
    }
    els.workshop.appendChild(title);
    if (!workers.length) {
      els.workshop.appendChild(h('div', { class: 'empty', text: 'No heroes at the sites. Send one on a labour, or start a session in Agent Deck.' }));
      return;
    }
    const order = { waiting: -1, running: 0, error: 1, idle: 2, stopped: 3 };
    const sortW = (list) => list.sort((a, b) => (a.stale ? 9 : order[a.status] ?? 8) - (b.stale ? 9 : order[b.status] ?? 8));
    const rest = inZone;   // waiting heroes show at their site too, as well as in the Needs-you strip
    if (!inZone.length) els.workshop.appendChild(h('div', { class: 'empty', text: zone === 'isle' ? 'No sessions are quarantined on the isle.' : 'Every session is on the isle right now.' }));
    if (zone === 'village') {
      // group by site
      const sites = siteList();
      const bySite = new Map(sites.map((s) => [s.id, []]));
      for (const w of rest) { const k = bySite.has(w.site) ? w.site : sites[0]?.id; if (!bySite.has(k)) bySite.set(k, []); bySite.get(k).push(w); }
      const activeSites = [...bySite].filter(([, list]) => list.length), emptySites = [...bySite].filter(([, list]) => !list.length);
      for (const [siteId, list] of activeSites) {
        const s = sites.find((x) => x.id === siteId) || { label: siteId || 'Unplaced', purpose: '' };
        const group = h('div', { class: 'host-group site-group' },
          h('div', { class: 'host-title' }, siteGlyph(siteId), h('span', { text: s.label }), h('span', { class: 'site-purpose', text: s.purpose || '' })));
        for (const [proj, plist] of groupByProject(sortW(list))) group.appendChild(projectGroup(proj, plist, false));
        els.workshop.appendChild(group);
      }
      if (emptySites.length) els.workshop.appendChild(h('div', { class: 'dim-note site-empty', text: `Empty: ${emptySites.map(([id]) => sites.find((s) => s.id === id)?.label || id).join(' · ')}` }));
    } else {
      const hosts = new Map();
      for (const w of rest) { const host = String(w.host || 'local') + (w.os ? ` · ${osLabel(w.os)}` : ''); if (!hosts.has(host)) hosts.set(host, []); hosts.get(host).push(w); }
      for (const [host, list] of hosts) {
        const hg = h('div', { class: 'host-group' }, h('div', { class: 'host-title' }, h('span', { class: 'h-dot' }), host));
        for (const [proj, plist] of groupByProject(sortW(list))) hg.appendChild(projectGroup(proj, plist, true));
        els.workshop.appendChild(hg);
      }
    }
  }
  // v0.46 governance, read at leisure: escalations (a disputed change simply stays unshipped; no bell), what waits for a
  // ruling, and the ledger of skips, rulings, overrides, appeals and receipts.
  function renderGovernance() {
    const g = state.governance;
    if (zone !== 'village' || !g) return;
    const digest = g.digest || [], pending = g.pending || [], ledger = (g.ledger || []).slice().reverse();
    if (!digest.length && !pending.length && !ledger.length) return;
    const fold = foldSection('governance', 'Governance', digest.length || null, h('span', { class: 'dim-note gov-meta', text: `wakes today ${g.wakes?.used ?? 0} · ledger ${g.verified ? 'intact' : 'BROKEN'}` }));
    if (digest.length) {
      const box = h('div', { class: 'panel-settings gov-digest' }, h('b', { text: 'For your reading' }));
      for (const d of digest) box.append(h('p', {}, h('span', { class: 'worker-path', text: `${d.project || ''} ${shortHash(d.sha)} ` }), document.createTextNode(String(d.text || '')), d.escalation ? decideButton(d) : null));
      fold.append(box);
    }
    if (pending.length) {
      const box = h('div', { class: 'panel-settings' }, h('b', { text: 'Awaiting a ruling' }));
      for (const r of pending) box.append(h('p', { class: 'gov-row' }, h('span', { class: `pill gov-state gov-${r.state}`, text: r.state }), h('span', { class: 'need-name', text: ` ${r.title || r.project} ` }), h('span', { class: 'worker-path', text: `${r.project} ${shortHash(r.sha)}${r.stewardOwn ? ' · the Steward’s own' : ''} · report ${r.report ? 'given' : 'missing'} · tests ${r.tests || 'missing'}` }),
        h('span', { class: 'dim-note gov-why', text: (r.reasons || []).join('; ') }), decideButton(r)));
      fold.append(box);
    }
    if (ledger.length) {
      const lines = h('div', { class: 'audit-log' });
      for (const e of ledger) lines.append(h('p', { text: e.redacted ? `#${e.seq} ${e.kind} · moved to the isle` : `#${e.seq} ${new Date(e.ts).toLocaleString()} · ${e.kind}${e.what ? ` (${e.what})` : ''} by ${e.actor}${e.verdict ? ` · ${e.verdict}` : ''}${e.sha ? ` · ${shortHash(e.sha)}` : ''}${e.id ? ` · ${e.id}` : ''}${e.reason ? ` · ${e.reason}` : ''}` }));
      fold.append(h('div', { class: 'panel-settings' }, h('b', { text: 'Ledger' }), clamped('gov-ledger', lines, ledger.map((e) => e.reason || e.kind).join('\n'), 8)));
    }
    els.workshop.append(fold);
  }
  // The High Priest wakes by hand, once enough waits, or after the longest wait (v0.75); the line says which, and when she last woke.
  function priestWake(gov, pending) {
    const who = gov?.priest, waiting = pending.filter(r => r.state !== 'evidence').length;
    if (!who || !waiting || !opts.api) return null;
    const woke = Math.max(0, ...pending.map(r => +r.wokeAt || 0)), wakes = gov.wakes || {};
    const note = h('span', { class: 'dim-note gov-wake-note', text: ` ${woke ? `woken ${relTime(woke)}` : 'not woken yet'} · on her own at ${wakes.autoAt || 5} waiting or ${wakes.maxWaitHours || 12} h` });
    const button = h('button', { class: 'btn btn-xs gov-wake', type: 'button', text: `Wake ${who} (${waiting})`, title: `Wake ${who} now to rule on everything waiting`,
      onClick: async () => { button.disabled = true; const r = await opts.api('/api/governance/wake', {}); button.disabled = false; if (r?.ok !== false && r?.resident) note.textContent = ` waking ${r.resident} for ${r.offerings}…`; } });
    return h('span', { class: 'gov-wake-row' }, button, note);
  }
  // The human's own decision, final: for anything awaiting a ruling, or an escalation that only the human can settle.
  function decideButton(r) { return opts.onDecide && r.offeringId ? h('button', { class: 'btn btn-ghost btn-xs gov-decide', type: 'button', text: 'Decide…', onClick: () => opts.onDecide(r) }) : null; }
  // Steward and Watchtower controls, with the audit log: every control as before, folded under Settings & logs.
  function renderSettings() {
    if (zone !== 'village' || !(state.steward || state.auditSettings)) return;
    if (!settingsFold) { settingsFold = foldSection('settings', 'Settings & logs'); els.workshop.append(settingsFold); }
    const fold = settingsFold;
    if (!state.steward) { fold._steward?.remove(); fold._steward = null; }
    if (!state.auditSettings) { fold._audit?.remove(); fold._audit = null; }
    if (state.steward) {
      // Not 'card': that class is the absolutely positioned map popover and floats over the page.
      if (!fold._steward) { fold._steward = h('div', { class: 'panel-settings' }, h('b', { text: 'Steward · reset windows' })); fold.insertBefore(fold._steward, fold._audit || null); }
      const controls = fold._steward;
      for (const [key, label] of [['enabled', 'Use spare allowance before reset'], ['festivalEnabled', 'Festival fallback']]) {
        settingField(controls, key, label, 'input', { type: 'checkbox', checked: state.steward[key] }, input => opts.api('/api/steward/settings', { [key]: input.checked }));
      }
      for (const [key, label] of [['idleHours', 'Human idle hours'], ['sevenDayHours', 'Weekly hours left'], ['sevenDaySpare', 'Weekly spare %'], ['fiveHourHours', 'Five-hour hours left'], ['fiveHourSpare', 'Five-hour spare %']]) {
        settingField(controls, key, label, 'input', { type: 'number', min: '0', max: key.endsWith('Spare') ? '90' : '168', step: '0.5', value: state.steward[key], 'aria-label': label }, input => opts.api('/api/steward/settings', { [key]: +input.value }));
      }
      // The Steward's own session, which the Watch may restart when it falls over; chosen by hand, never by title.
      const current = state.stewardHero?.workerId, choices = [['', 'None (the Watch never restarts it)']];
      for (const w of (state.workers || []).filter((w) => w.zone === 'village' && w.node && w.tool === 'claude' && !w.private && !w.archived || w.id === current)) choices.push([w.id, `${w.title} · ${w.host}`]);
      if (current && !choices.some(([value]) => value === current)) choices.push([current, 'Set, not reporting now']);
      settingField(controls, 'hero', 'Steward session', 'select', { 'aria-label': 'Steward session', value: current || '' }, select => opts.api('/api/steward/hero', { workerId: select.value || null }), choices);
    }
    if (state.auditSettings) {
      if (!fold._audit) { fold._audit = h('div', { class: 'panel-settings' }, h('b', { text: 'Watchtower' })); fold.append(fold._audit); }
      const s = state.auditSettings, controls = fold._audit;
      settingField(controls, 'enabled', ' Audit autonomous heroes', 'input', { type: 'checkbox', checked: s.enabled }, input => opts.api('/api/audit/settings', { enabled: input.checked }));
      for (const [key, label] of [['tier1', 'First reviewer'], ['tier2', 'Escalation reviewer']]) {
        // Reviewers are picked by role (shown as title · model); a resident with a shared role is picked by name.
        const list = state.residents || [], choices = []; let selected;
        for (const r of list) { const value = r.role && list.filter(x => x.role === r.role).length === 1 ? r.role : r.name; choices.push([value, `${r.title || r.role || r.name} · ${r.model || r.agent}`]); if (value === s[key] || r.name === s[key]) selected = value; }
        settingField(controls, key, label, 'select', { 'aria-label': label, value: selected ?? choices[0]?.[0] ?? '' }, select => opts.api('/api/audit/settings', { [key]: select.value }), choices);
      }
      settingField(controls, 'dailyCap', 'Daily audit runs ', 'input', { type: 'number', min: '0', max: '200', value: s.dailyCap, 'aria-label': 'Daily audit run cap' }, cap => opts.api('/api/audit/settings', { dailyCap: +cap.value }));
      // The last audit lines follow the settings so a glance explains why a hero was flagged.
      controls._log?.remove(); controls._log = null;
      const log = (state.audits || []).slice(-20).reverse();
      if (log.length) { const lines = h('div', { class: 'audit-log' }); for (const a of log) lines.append(h('p', { text: `${a.severity} · ${a.rule} · ${a.status}: ${a.excerpt}` })); controls._log = clamped('audit-log', lines, log.map((a) => a.excerpt).join('\n'), 5); controls.append(controls._log); }
    }
  }
  function siteList() {
    const list = (state.sites || []).filter((s) => s && s.id);
    return list.length ? list : [{ id: 'temple', label: 'The Temple', purpose: '' }, { id: 'library', label: 'The Great Library', purpose: '' }, { id: 'forge', label: 'The Forge', purpose: '' }, { id: 'quarry', label: 'The Quarry', purpose: '' }];
  }
  // Line-art site marks drawn like the rail's icons (C11): constant markup, never data, so innerHTML is safe here.
  const SITE_PATHS = { temple: 'M2 7 9 3l7 4H2ZM3 14h12M2 16h14M4.5 7.5V14M7.5 7.5V14M10.5 7.5V14M13.5 7.5V14', library: 'M5 3h9v10.5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V12h3ZM5 3a2 2 0 0 0-2 2v1h2M7.5 7h4.5M7.5 10h4.5', forge: 'M9 2c1 3 4 4.5 4 8.5a4 4 0 0 1-8 0c0-2 1-3 2-4 0 1.5 1 2.5 2 2.5 0-2.5-1-4 0-7Z', quarry: 'M2.5 6.5C5 3.5 13 3.5 15.5 6.5M9 4.6 5 15.5' };
  function siteGlyph(id) { const span = h('span', { class: 'site-glyph', 'aria-hidden': 'true' }); span.innerHTML = `<svg viewBox="0 0 18 18" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5"><path d="${(Object.hasOwn(SITE_PATHS, id) && SITE_PATHS[id]) || 'M9 6a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z'}"/></svg>`; return span; }
  function groupByProject(list) {
    const m = new Map();
    for (const w of list) { const proj = `${w.project || '(no project)'} @ ${w.host || 'local'}`; if (!m.has(proj)) m.set(proj, []); m.get(proj).push(w); }
    return m;
  }
  function projectGroup(proj, list, isle) {
    const anySealed = list.some((w) => w.sealed);
    const qSwitch = h('button', { class: 'switch switch-sm', type: 'button', role: 'switch', 'aria-checked': isle ? 'true' : 'false', title: isle ? 'Quarantined on the isle — click to bring back' : 'Quarantine this project on the isle' });
    qSwitch.disabled = anySealed || !hasIsle();
    qSwitch.addEventListener('click', () => opts.onQuarantine?.(list[0].project, list[0].host, !isle));
    const milestone = h('button', { class: 'btn btn-ghost btn-xs', type: 'button', text: 'Share a milestone', title: "Grow this project's branch on the shared tree" });
    milestone.disabled = anySealed;
    milestone.addEventListener('click', () => opts.onMilestone?.(list[0].project, list[0].host));
    const pg = h('div', { class: 'project-group' },
      h('div', { class: 'project-title' }, h('span', { text: proj }), h('span', { class: 'project-actions' }, milestone, hasIsle() ? h('label', { class: 'q-label' }, 'quarantine ', qSwitch) : null)));
    for (const w of list) pg.appendChild(workerRow(w));
    return pg;
  }
  // The Needs-you copy of a row gets its own ids and keys (prefix 'need') and leaves the site row's open state alone.
  function workerRow(w, { open = heroOpen.has(w.id), prefix = 'hero' } = {}) {
    const st = w.status === 'waiting' && !w.needsPermission ? 'idle' : String(w.status || 'idle');
    const stale = !!w.stale;
    const offer = h('button', { class: 'btn btn-ghost btn-xs', type: 'button', text: 'Lay an offering…', title: "Snapshot this session's git change as an offering for review" });
    offer.disabled = !!w.sealed;
    offer.addEventListener('click', (e) => { e.stopPropagation(); opts.onOffer?.(w); });
    const row = h('div', { class: `worker-row ${st === 'waiting' && !stale ? 'waiting' : ''} ${stale ? 'stale' : ''} ${w.sealed ? 'sealed' : ''}`, dataset: { workerId: w.id } },
      h('div', { class: `worker-title ${w.sealed ? 'runic' : ''}` }, w.sealed ? h('span', { class: 'lock', text: '🔒 ' }) : null, String(w.title || w.id)),
      stale
        ? h('span', { class: 'pill pill-stale', text: `last seen ${relTime(w.updatedAt) || 'a while ago'}` })
        : h('span', { class: `pill pill-${st}`, text: st === 'waiting' ? 'needs you' : st }),
      h('div', { class: 'worker-sub' },
        h('span', { class: `chip ${agentClass(w.tool)}`, text: String(w.tool || 'tool') }),
        h('span', { class: w.sealed ? 'runic' : '', text: `${w.project || ''} @ ${w.host || 'local'}${w.os ? ` · ${osLabel(w.os)}` : ''}` }),
      ),
      // Terminal is the most used action, so it stays on the row instead of behind More.
      h('div', { class: 'row-quick' },
        opts.canOpenTerminal?.(w) ? h('button', { class: 'btn btn-xs', type: 'button', text: 'Terminal ▸', onClick: () => opts.onTerminal?.(w) }) : null,
        h('button', { class: 'btn btn-ghost btn-xs row-toggle', type: 'button', dataset: { key: `${prefix}:${w.id}` }, 'aria-expanded': String(open), 'aria-controls': `${prefix}-more-${w.id}`, text: open ? 'Less ▴' : 'More ▾' })),
      h('div', { class: 'worker-more', id: `${prefix}-more-${w.id}`, hidden: !open },
        prefix === 'hero' && w.messages?.length ? h('details', { class: 'hero-messages' }, h('summary', { text: `Messages (${w.messages.length})` }), ...w.messages.map(m => h('div', { class: `hero-message ${m.from}` }, h('div', { class: 'dim-note', text: `${m.from === 'keeper' ? 'Keeper' : 'Hero'} · ${relTime(m.ts) || 'just now'}${m.status === 'sending' ? ' · waiting for a reply…' : ''}${m.status === 'failed' ? ` · failed: ${m.note || 'not delivered'}` : ''}` }), m.status === 'sending' ? null : h('div', { class: 'hero-message-text', text: m.text })))) : null,
        h('div', { class: 'worker-actions' },
          deckLink(w) ? h('a', { href: deckLink(w), target: '_blank', rel: 'noopener', text: 'Open in Agent Deck ↗' }) : null,
          offer,
          h('button', { class: 'btn btn-ghost btn-xs', type: 'button', text: 'Tell the tale', disabled: !!w.sealed, onClick: () => opts.onTellTale?.(w.id) }),
          opts.endLabourButton?.(w),
          state.auditSettings && zoneOf(w) === 'village' && !w.private && !w.sealed ? h('button', { class: 'btn btn-ghost btn-xs', text: state.auditSettings.optOut.includes(w.id) ? 'Audit off' : 'Audit on', onClick: () => opts.api('/api/audit/settings', { heroId: w.id, optOut: !state.auditSettings.optOut.includes(w.id) }) }) : null,
        ),
        h('div', { class: 'dim-note' },
          w.sealed ? null : h('span', { class: 'worker-path', text: String(w.path || '') }),
          zoneOf(w) !== 'isle' && !w.sealed ? h('span', {}, `at ${siteList().find(s => s.id === w.site)?.label || w.site || ''}${w.siteReason ? ` · ${w.siteReason}` : ''}`, sitePicker(w)) : null,
        ),
      ),
    );
    const toggle = row.querySelector('.row-toggle');
    toggle.addEventListener('click', (e) => { e.stopPropagation(); const more = row.querySelector('.worker-more'), next = more.hidden; more.hidden = !next; toggle.setAttribute('aria-expanded', String(next)); toggle.textContent = next ? 'Less ▴' : 'More ▾'; if (prefix !== 'hero') return; if (next) heroOpen.add(w.id); else heroOpen.delete(w.id); });
    const counsel = (state.counsel || []).filter((c) => c && c.workerId === w.id);
    if (counsel.length) row.appendChild(counselList(counsel));
    row.addEventListener('click', (e) => { if (!e.target.closest('a, button, select, .counsel')) opts.onFocusWorker?.(w.id); });
    return row;
  }
  function sitePicker(w) {
    const sel = h('select', { class: 'site-picker', 'aria-label': 'Move this hero to another site', title: 'Move to…' });
    sel.appendChild(h('option', { value: '', text: 'Move to…' }));
    sel.appendChild(h('option', { value: 'auto', text: 'Auto' }));
    for (const s of siteList()) if (s.id !== w.site) sel.appendChild(h('option', { value: s.id, text: s.label }));
    sel.addEventListener('click', (e) => e.stopPropagation());
    sel.addEventListener('change', () => { if (sel.value) { opts.onMoveSite?.(w.id, sel.value); sel.value = ''; } });
    return sel;
  }
  function counselList(list) {
    const box = h('div', { class: 'counsel' }, h('div', { class: 'counsel-title', text: `Counsel from the village · ${list.length}` }));
    const sorted = [...list].sort((a, b) => (a.status === 'new' ? -1 : 1) - (b.status === 'new' ? -1 : 1) || (+b.ts || 0) - (+a.ts || 0));
    for (const c of sorted) {
      const status = ['new', 'relayed', 'dismissed', 'failed'].includes(c.status) ? c.status : 'new';
      const item = h('div', { class: `counsel-item status-${status}` },
        h('div', { class: 'counsel-head' }, avatar(c.by, residentByName(c.by)?.color, 'xs'), h('b', { text: String(c.by || '?') }), rankChip(c.by), h('span', { class: `pill pill-counsel counsel-${status}`, text: status }), h('span', { class: 'post-time', text: relTime(c.ts) })),
        h('div', { class: 'counsel-text', text: String(c.text || '') }));
      if (status === 'new') {
        const relay = h('button', { class: 'btn btn-primary btn-xs', type: 'button', text: 'Relay', title: 'Pass this counsel to the hero, fenced as untrusted text' });
        relay.addEventListener('click', () => opts.onCounsel?.(c.id, 'relay'));
        const dismiss = h('button', { class: 'btn btn-ghost btn-xs', type: 'button', text: 'Dismiss' });
        dismiss.addEventListener('click', () => opts.onCounsel?.(c.id, 'dismiss'));
        item.appendChild(h('div', { class: 'card-actions counsel-actions' }, relay, dismiss));
      }
      box.appendChild(item);
    }
    return box;
  }
  function counselCount() { return (state.counsel || []).filter((c) => c && c.status === 'new' && (zoneOf(c) !== 'isle' || !sealed())).length; }
  // Where an offering stands with the Temple, in words (v0.46 governance state when it has one).
  function rulingState(o) {
    const g = o.gov, sha = shortHash(g?.sha || o.headCommit), reviewers = Array.isArray(o.reviewers) ? o.reviewers.length : 0;
    if (!g) return o.status === 'closed' ? ['closed', 'pill-stopped'] : reviewers ? ['under review', 'pill-running'] : ['awaiting first look', 'pill-waiting'];
    if (g.state === 'trivial') return [`accepted (trivial) ${sha}`, 'pill-running'];
    if (g.state === 'accepted') return [`accepted ${sha}`, 'pill-running'];
    if (g.state === 'rejected') return [`rejected ${sha}`, 'pill-error'];
    if (g.state === 'evidence') return ['pending evidence', 'pill-waiting'];
    if (g.state === 'appealed') return ['under appeal', 'pill-waiting'];
    return [reviewers || g.rulings?.length ? 'under review' : 'awaiting first look', reviewers ? 'pill-running' : 'pill-waiting'];
  }
  // Open offerings first, live, each with its ruling state and the findings and omens it produced; closed ones follow
  // as the folded history.
  function renderOfferings() {
    const all = offeringsInZone(), byNew = (a, b) => (+b.createdAt || 0) - (+a.createdAt || 0);
    const live = all.filter((o) => o.status !== 'closed').sort(byNew), list = all.filter((o) => o.status === 'closed').sort(byNew);
    if (live.length) {
      els.workshop.appendChild(h('div', { class: 'temple-section-title' }, h('span', { text: 'Offerings' }), h('span', { class: 'count', text: String(live.length) })));
      const wake = zone === 'village' ? priestWake(state.governance, state.governance?.pending || []) : null; if (wake) els.workshop.appendChild(h('div', { class: 'gov-wake-bar' }, wake));
      for (const o of live) els.workshop.appendChild(offeringCard(o));
    }
    const fold = foldSection('offerings', 'Offerings history', list.length);
    if (!list.length) fold.appendChild(h('div', { class: 'empty', text: all.length ? 'No offerings have been closed yet.' : 'No offerings yet. Lay one from a hero above and the village will review it.' }));
    const shown = offeringsAll ? list : list.slice(0, 3);
    for (const o of shown) fold.appendChild(offeringCard(o));
    if (list.length > shown.length) { const more = h('button', { class: 'btn btn-ghost btn-xs', type: 'button', text: `Show all ${list.length}` }); more.addEventListener('click', () => { offeringsAll = true; renderWorkshop(); }); fold.appendChild(h('div', { class: 'fold-more' }, more)); }
    els.workshop.appendChild(fold);
  }
  function offeringCard(o) {
    const files = Array.isArray(o.files) ? o.files.map(String) : [];
    const reviewers = Array.isArray(o.reviewers) ? o.reviewers.map(String) : [];
    const commanded = o.commanded && typeof o.commanded === 'object' ? Object.entries(o.commanded) : [];
    const open = o.status !== 'closed';
    const card = h('div', { class: `offering ${open ? 'open' : 'closed'}`, dataset: { id: o.id } });
    card.appendChild(h('div', { class: 'offering-head' },
      h('span', { class: 'offering-title', text: String(o.title || o.project || o.id) }),
      h('span', { class: `pill ${open ? 'pill-running' : 'pill-stopped'}`, text: open ? 'open' : 'closed' }),
      (([label, cls]) => h('span', { class: `pill gov-ruling ${cls}`, text: label, title: o.gov?.reasons?.join('; ') || '' }))(rulingState(o))));
    card.appendChild(h('div', { class: 'offering-sub' },
      h('span', { class: `chip ${agentClass(o.tool)}`, text: String(o.tool || 'tool') }),
      o.provider ? providerChip(o.provider) : null,
      h('span', { class: 'chip chip-other', text: String(o.kind || 'working changes') }),
      o.anchored ? h('span', { class: 'chip chip-tree', text: 'anchored', title: 'Findings are anchored to a specific commit/diff' }) : null,
      o.headCommit ? h('span', { class: 'worker-path', text: `@${shortHash(o.headCommit)}`, title: `head ${o.headCommit}${o.diffHash ? ` · diff ${o.diffHash}` : ''}` }) : null,
      h('span', { text: `${o.project || ''} @ ${o.host || 'local'} · ${relTime(o.createdAt)}${Number.isFinite(+o.size) ? ` · ${(+o.size / 1024).toFixed(1)} KB` : ''}${o.truncated ? ' · truncated' : ''}` })));
    if (o.note) card.appendChild(h('div', { class: 'card-quote', text: String(o.note) }));
    if (o.kind === 'scroll') {
      const text = String(o.text ?? o.content ?? o.scroll ?? '');
      card.appendChild(clamped(`${o.id}:scroll`, h('div', { class: 'scroll-text', text: text || '(an empty scroll)' }), text));
    } else if (files.length) {
      const fl = h('div', { class: 'offering-files' }), key = `${o.id}:files`;
      for (const f of files.slice(0, expanded.has(key) ? files.length : 6)) fl.appendChild(h('span', { class: 'worker-path', text: f }));
      if (files.length > 6 && !expanded.has(key)) { const more = h('button', { class: 'btn btn-ghost btn-xs clamp-toggle', type: 'button', text: `+${files.length - 6} more` }); more.addEventListener('click', () => { expanded.add(key); more.replaceWith(...files.slice(6).map((f) => h('span', { class: 'worker-path', text: f }))); }); fl.appendChild(more); }
      const omitted = Array.isArray(o.omittedPaths) ? o.omittedPaths.length : 0;
      if (omitted) fl.appendChild(h('span', { class: 'dim-note', text: `${omitted} path${omitted === 1 ? '' : 's'} omitted`, title: o.omittedPaths.map(String).join('\n') }));
      card.appendChild(fl);
    }
    const people = h('div', { class: 'offering-people' });
    const revRow = h('div', { class: 'people-row' }, h('b', { text: 'Reviewers ' }));
    if (reviewers.length) for (const n of reviewers) revRow.append(...[avatar(n, residentByName(n)?.color, 'xs'), h('span', { class: 'person', text: n }), rankChip(n)].filter(Boolean));
    else revRow.appendChild(h('span', { class: 'dim-note', text: 'none yet' }));
    people.appendChild(revRow);
    if (commanded.length) {
      const cRow = h('div', { class: 'people-row' }, h('b', { text: 'Commanded ' }));
      for (const [n, note] of commanded) cRow.append(avatar(n, residentByName(n)?.color, 'xs'), h('span', { class: 'person', text: note ? `${n}: ${note}` : n }));
      people.appendChild(cRow);
    }
    card.appendChild(people);
    if (open) {
      const cmd = h('button', { class: 'btn btn-xs', type: 'button', text: 'Command…' });
      cmd.addEventListener('click', () => opts.onCommand?.(o));
      const close = h('button', { class: 'btn btn-ghost btn-xs', type: 'button', text: 'Close' });
      close.addEventListener('click', () => opts.onCloseOffering?.(o));
      card.appendChild(h('div', { class: 'card-actions' }, cmd, close));
    }
    if (o.kind === 'audit' && (o.verdicts || []).length) { const vs = h('div', { class: 'offering-verdicts' }); for (const v of o.verdicts) vs.append(h('p', { text: `${v.reviewer}: ${v.verdict} — ${v.summary}` })); card.append(clamped(`${o.id}:verdicts`, vs, o.verdicts.map((v) => v.summary).join('\n'), 4)); }
    const findings = findingsFor(o.id);
    if (findings.length) {
      card.appendChild(h('div', { class: 'findings-title', text: `${findings.length} finding${findings.length === 1 ? '' : 's'}` }));
      for (const f of findings) card.appendChild(findingRow(f));
    }
    return card;
  }
  function findingRow(f) {
    const s = sev(f);
    const status = String(f.status || 'open');
    const row = h('div', { class: `finding sev-${s} ${status === 'refuted' ? 'refuted' : ''}`, dataset: { id: f.id, status } });
    row.appendChild(h('div', { class: 'finding-head' },
      h('span', { class: `pill pill-sev sev-${s}`, text: s }),
      h('span', { class: 'worker-path', text: `${f.file || '?'}${f.line != null ? `:${f.line}` : ''}` }),
      h('span', { class: `pill pill-status status-${status}`, text: statusLabel(status) }),
      f.independent ? h('span', { class: 'chip chip-other', text: 'independent', title: 'Found without seeing the author\u2019s own notes' }) : null,
      h('span', { class: 'finding-by' }, avatar(f.reviewer, residentByName(f.reviewer)?.color, 'xs'), h('span', { text: String(f.reviewer || '?') }), f.provider ? providerChip(f.provider) : null)));
    row.appendChild(h('div', { class: 'finding-claim', text: String(f.claim || '') }));
    if (f.evidence) row.appendChild(clamped(`${f.id}:evidence`, h('pre', { class: 'evidence', text: String(f.evidence) }), f.evidence, 5));
    if (f.missingContext) row.appendChild(h('div', { class: 'finding-row missing' }, h('b', { text: 'needs context ' }), String(f.missingContext)));
    if (f.scenario) row.appendChild(h('div', { class: 'finding-row' }, h('b', { text: 'scenario ' }), String(f.scenario)));
    if (f.fix) row.appendChild(h('div', { class: 'finding-row' }, h('b', { text: 'fix ' }), String(f.fix)));
    for (const sec of Array.isArray(f.seconds) ? f.seconds : []) {
      if (!sec) continue;
      row.appendChild(h('div', { class: 'finding-vote second' }, h('span', { class: 'vote-mark', text: '✓' }), h('b', { text: String(sec.by || '?') }), ' ', sec.provider ? providerChip(sec.provider) : null, sec.note ? h('span', { text: ` ${sec.note}` }) : null));
    }
    for (const d of Array.isArray(f.disputes) ? f.disputes : []) {
      if (!d) continue;
      const kind = ['disagree', 'counterexample', 'needs_context'].includes(d.kind) ? d.kind : 'disagree';
      row.appendChild(h('div', { class: `finding-vote dispute kind-${kind}` }, h('span', { class: 'vote-mark', text: kind === 'needs_context' ? '?' : '✗' }), h('b', { text: String(d.by || '?') }), ' ', d.provider ? providerChip(d.provider) : null, h('span', { class: 'chip chip-other', text: kind.replace('_', ' ') }), d.note ? h('span', { text: ` ${d.note}` }) : null, d.evidence ? h('pre', { class: 'evidence counter', text: String(d.evidence) }) : null));
    }
    if (f.fixCheck) row.appendChild(fixCheckEl(f.fixCheck));
    return row;
  }
  function fixCheckEl(check) {
    const verdict = String(check.verdict || '');
    return h('div', { class: 'fix-check' },
      h('span', { class: `pill ${verdict === 'holds' ? 'pill-running' : verdict === 'partial' ? 'pill-waiting' : 'pill-error'}`, text: verdict.replaceAll('_', ' ') }),
      h('span', { class: 'fix-check-note', text: String(check.note || '') }),
      h('span', { class: 'finding-by', text: `by ${check.by || '?'}` }));
  }
  // The Tablet: omens awaiting judgement, delivery or a fix's confirmation sit on top marked live; the resolved,
  // inscribed record follows, folded, as before.
  function renderTablet() {
    const mine = (state.findings || []).filter((f) => f && f.id && zoneOf(f) === zone && TABLET_STATUSES.includes(f.status)), byNew = (a, b) => (+b.omenAt || +b.verdict?.ts || 0) - (+a.omenAt || +a.verdict?.ts || 0);
    const live = mine.filter(needsJudgement).sort(byNew), list = mine.filter((f) => !needsJudgement(f)).sort(byNew);
    if (live.length) {
      els.workshop.appendChild(h('div', { class: 'temple-section-title' }, h('span', { text: 'Omens in motion' }), h('span', { class: 'count', text: String(live.length) })));
      const box = h('div', { class: 'rune-tablet omens compact tablet-live' });
      for (const f of live) { const e = omenEntry(f); e.classList.add('live'); e.querySelector('.omen-head')?.prepend(h('span', { class: 'pill pill-running', text: 'live' })); box.appendChild(e); }
      els.workshop.appendChild(box);
    }
    const fold = foldSection('tablet', 'The Tablet of Omens', list.length);
    const tablet = h('div', { class: 'rune-tablet omens' });
    tablet.appendChild(h('div', { class: 'rune-tablet-title', text: list.length ? 'Omens read by the High Priest' : 'The tablet is blank' }));
    if (!list.length) tablet.appendChild(h('div', { class: 'rune-tablet-hint', text: 'When a finding gathers a second, it becomes an omen for the High Priest to judge.' }));
    for (const f of list) tablet.appendChild(omenEntry(f));
    fold.appendChild(tablet);
    els.workshop.appendChild(fold);
  }
  function omenEntry(f) {
    const status = String(f.status || 'omen');
    const readable = `${sev(f)} · ${f.file || '?'}${f.line != null ? `:${f.line}` : ''} — ${f.claim || ''}`;
    const e = h('div', { class: `omen-entry status-${status}`, dataset: { id: f.id }, tabindex: 0 });
    e.addEventListener('click', (ev) => { if (!ev.target.closest('button')) e.classList.toggle('translated'); });
    const head = h('div', { class: 'omen-head' },
      h('span', { class: `pill pill-status status-${status}`, text: statusLabel(status) }),
      h('span', { class: 'omen-project', text: String(f.project || '') }),
      h('span', { class: 'omen-by' }, h('span', { text: String(f.reviewer || '') }), f.provider ? providerChip(f.provider) : null));
    e.appendChild(head);
    e.appendChild(h('div', { class: 'omen-body' },
      h('div', { class: 'omen-rune', lang: 'und', text: toRunes(readable) }),
      h('div', { class: 'omen-text', text: readable })));
    if (f.verdict) {
      const v = f.verdict;
      const reasoning = String(v.reasoning || v.instructions || '');
      e.appendChild(clamped(`${f.id}:verdict`, h('div', { class: 'omen-verdict' },
        h('span', { class: `pill ${v.verdict === 'implement' ? 'pill-running' : 'pill-error'}`, text: v.verdict === 'implement' ? 'implement' : 'reject' }),
        ' ', h('b', { text: `${v.by || 'High Priest'}: ` }), reasoning, v.ts ? h('span', { class: 'post-time', text: ` · ${relTime(v.ts)}` }) : null), reasoning, 4));
    } else if (status === 'omen') {
      e.appendChild(h('div', { class: 'omen-verdict dim-note', text: 'Awaiting the High Priest’s judgement.' }));
    }
    if (f.delivery) {
      const d = f.delivery;
      const raw = String(d.state || 'queued');
      const st = raw === 'awaiting approval' ? 'awaiting' : ['queued', 'sending', 'failed', 'landed'].includes(raw) ? raw : 'queued';
      e.appendChild(h('div', { class: 'omen-delivery' },
        h('span', { class: `pill pill-delivery delivery-${st}`, text: st === 'landed' ? 'landed in session' : st === 'failed' ? 'delivery failed' : st === 'awaiting' ? 'awaiting your approval' : raw }),
        d.error ? h('span', { class: 'delivery-error', text: String(d.error) }) : null,
        d.ts ? h('span', { class: 'post-time', text: ` · ${relTime(d.ts)}` }) : null));
    }
    if (f.fixCheck) e.appendChild(fixCheckEl(f.fixCheck));
    // The village judges omens and checks fixes (smith, then High Priest); the human gets no verdict buttons here.
    const next = { decreed: 'Next: the hero fixes it, then the smith checks the fix and the High Priest confirms it.', awaiting_confirmation: 'Next: the smith checks the fix and the High Priest confirms it.' }[status];
    if (next) e.appendChild(h('div', { class: 'omen-verdict dim-note', text: next }));
    return e;
  }

  // ---- The Lamplighter's House: usage, told plainly ----
  const fmtTok = (n) => {
    if (n == null || !Number.isFinite(+n)) return '—';
    const v = +n;
    if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
    if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
    if (v >= 1e4) return `${(v / 1e3).toFixed(1)}k`;
    return String(Math.round(v));
  };
  const fmtCost = (c) => (Number.isFinite(+c) && +c > 0 ? `$${(+c).toFixed(+c < 10 ? 2 : 0)}` : '');
  const fmtDur = (ms) => (Number.isFinite(+ms) && +ms > 0 ? (+ms >= 60000 ? `${Math.round(+ms / 60000)}m` : `${Math.round(+ms / 1000)}s`) : '');
  function untilText(epoch) {
    const t = +epoch;
    if (!Number.isFinite(t) || t <= 0) return '';
    const ms = (t < 1e12 ? t * 1000 : t) - Date.now();
    if (ms <= 0) return 'resets now';
    const m = Math.round(ms / 60000);
    return `resets in ${m >= 1440 ? `${Math.floor(m / 1440)}d ${Math.floor(m % 1440 / 60)}h ${m % 60}m` : m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`}`;
  }
  function renderLamps() {
    const root = els.lamps;
    root.textContent = '';
    const usage = state.usage;
    if (!usage || typeof usage !== 'object') { root.appendChild(h('div', { class: 'empty', text: 'The lamplighter has nothing to report yet.' })); return; }
    const zoneUsage = usage[zone];
    const zoneSealed = zone === 'isle' && (isleLocked() || zoneUsage?.sealed);
    const guidance = ['normal', 'conserve', 'exhausted'].includes(usage.guidance) ? usage.guidance : 'normal';
    root.appendChild(h('div', { class: 'lamps-intro' },
      h('span', { class: `pill pill-guidance guidance-${guidance}`, text: guidance === 'normal' ? 'lamps burning normally' : guidance === 'conserve' ? 'conserve oil' : 'oil exhausted' }),
      h('span', { class: 'dim-note', text: guidance === 'conserve' ? 'An allowance is running low; residents take fewer turns.' : guidance === 'exhausted' ? 'An allowance is used up; residents wait for the reset.' : 'Allowances are account-level figures reported by each provider, not Amygdala’s own meter.' })));

    // amphorae: one per provider with a reported allowance; providers seen in usage but without limits get "not reported"
    const limits = usage.limits && typeof usage.limits === 'object' ? usage.limits : null;
    const provs = Array.isArray(limits?.providers) ? limits.providers.filter((p) => p && p.id) : [];
    const seen = new Set(provs.map((p) => String(p.id).toLowerCase()));
    const byProvider = zoneUsage?.byProvider && typeof zoneUsage.byProvider === 'object' ? zoneUsage.byProvider : {};
    const unreported = Object.keys(byProvider).filter((k) => !seen.has(k.toLowerCase()) && !seen.has(providerAlias(k)));
    root.appendChild(h('div', { class: 'temple-section-title' }, h('span', { text: 'Oil remaining' }), h('span', { class: 'dim-note lamps-note', text: limits?.observedAt ? `account-level · observed ${relTime(limits.observedAt)}` : 'account-level' })));
    const row = h('div', { class: 'amphora-row' });
    for (const p of provs) {
      const wins = Array.isArray(p.windows) ? p.windows.filter((w) => w && w.used_percentage != null && Number.isFinite(+w.used_percentage)) : [];
      const primary = wins.reduce((a, b) => !a || +b.used_percentage > +a.used_percentage ? b : a, null);
      const remaining = primary ? Math.max(0, Math.min(100, 100 - +primary.used_percentage)) : null;
      row.appendChild(amphoraCard(String(p.label || p.id), remaining, wins, !!p.stale));
      row.lastChild.appendChild(h('div', { class: 'amphora-win', text: `Source: ${p.source || limits.source || 'provider report'} · observed ${relTime(p.observedAt || limits.observedAt) || 'unknown'}` }));
    }
    for (const k of unreported) row.appendChild(amphoraCard(k, null, [], false, 'not reported'));
    if (!provs.length && !unreported.length) row.appendChild(h('div', { class: 'dim-note', text: 'No provider has reported an allowance.' }));
    root.appendChild(row);

    if (zoneSealed) {
      const t = h('div'); renderSealedTablet(t); root.appendChild(t.firstChild); return;
    }

    // totals + sparkline
    const today = zoneUsage?.today || {}, all = zoneUsage?.allTime || {};
    const quiet = zone === 'village' && !(+today.turns || 0) && !(+all.turns || 0);
    root.appendChild(h('div', { class: 'temple-section-title' }, h('span', { text: zone === 'isle' ? 'Oil burned on the isle' : 'Oil burned' })));
    const stats = h('div', { class: 'lamp-stats' },
      statTile('today', fmtTok(today.tokens), `${+today.turns || 0} turn${(+today.turns || 0) === 1 ? '' : 's'}`),
      statTile('all time', fmtTok(all.tokens), `${+all.turns || 0} turns · ${+all.measuredTurns || 0} measured${fmtCost(all.cost) ? ` · ${fmtCost(all.cost)}` : ''}`),
      ...(!quiet || zoneUsage?.perArtifact != null ? [statTile('per artifact', zoneUsage?.perArtifact == null ? 'too early' : fmtTok(zoneUsage.perArtifact), 'tokens per exhibit or building')] : []),
      ...(!quiet || zoneUsage?.perConfirmedFix != null ? [statTile('per confirmed fix', zoneUsage?.perConfirmedFix == null ? 'too early' : fmtTok(zoneUsage.perConfirmedFix), 'tokens per decree confirmed fixed')] : []));
    root.appendChild(stats);
    // A quiet village skips its empty breakdowns; the heroes' sessions below are not village turns, so they always show.
    if (quiet) root.appendChild(h('div', { class: 'dim-note', text: 'No village turns yet; breakdowns appear after the first turn.' }));
    else {
    root.appendChild(sparkline(Array.isArray(zoneUsage?.history) ? zoneUsage.history : []));

    // breakdowns
    const byResident = zoneUsage?.byResident && typeof zoneUsage.byResident === 'object' ? Object.entries(zoneUsage.byResident) : [];
    const byKind = zoneUsage?.byKind && typeof zoneUsage.byKind === 'object' ? Object.entries(zoneUsage.byKind) : [];
    const two = h('div', { class: 'lamp-cols' });
    two.appendChild(bars('By resident · today', byResident.map(([n, v]) => ({ label: n, color: residentByName(n)?.color, tokens: +v?.tokens || 0, turns: +v?.turns || 0 }))));
    two.appendChild(bars('By kind · today', byKind.map(([k, v]) => ({ label: { life: 'village life', temple: 'temple reviews', priest: 'the High Priest' }[k] || k, tokens: +v?.tokens || 0, turns: +v?.turns || 0 }))));
    root.appendChild(two);
    if (Object.keys(byProvider).length) {
      root.appendChild(bars('By provider · all time', Object.entries(byProvider).map(([k, v]) => ({ label: k, tokens: +v?.tokens || 0, turns: +v?.turns || 0, extra: `${+v?.measuredTurns || 0} measured${fmtCost(v?.cost) ? ` · ${fmtCost(v.cost)}` : ''}${Number.isFinite(+v?.today) ? ` · today ${fmtTok(v.today)}` : ''}` }))));
    }

    // weekly cost per turn (v0.54): measured only when nothing else spent that pool across the turn
    const weekly = zoneUsage?.weeklyPerTurn && typeof zoneUsage.weeklyPerTurn === 'object' ? Object.entries(zoneUsage.weeklyPerTurn).filter(([, v]) => v && typeof v === 'object') : [];
    if (weekly.length) {
      root.appendChild(h('div', { class: 'temple-section-title' }, h('span', { text: 'Weekly allowance per turn' }), h('span', { class: 'dim-note lamps-note', text: 'clean turns only' })));
      for (const [name, v] of weekly) {
        const n = +v.samples || 0, pct = Number.isFinite(+v.perTurnPct) && v.perTurnPct != null ? +v.perTurnPct : null;
        root.appendChild(h('div', { class: `turn-row ${n < 3 ? 'unmeasured' : ''}`, title: 'The rise in the weekly allowance from a reading just before the turn to one just after, kept only when no hero, other resident or answer run used that provider in between. Providers report whole percentages, so single turns read 0 or 1; the average over many turns is the figure.' },
          avatar(name, residentByName(name)?.color, 'xs'),
          h('span', { class: 'turn-who' }, h('b', { text: name })),
          h('span', { class: 'chip chip-other', text: `${v.window || '?'}${v.model ? ` · ${v.model}` : ''}` }),
          h('span', { class: 'turn-total', text: n < 3 || pct == null ? 'measuring…' : `≈${pct.toFixed(pct < 10 ? 1 : 0)}%` }),
          h('span', { class: 'dim-note turn-meta', text: `${n} sample${n === 1 ? '' : 's'}${+v.discarded ? ` · ${+v.discarded} set aside` : ''}${n < 3 ? ' · needs 3' : ' of weekly per turn'}` })));
      }
    }

    // recent turns
    const recent = Array.isArray(zoneUsage?.recent) ? zoneUsage.recent.filter(Boolean).slice(-12).reverse() : [];
    root.appendChild(h('div', { class: 'temple-section-title' }, h('span', { text: 'Recent turns' })));
    if (!recent.length) root.appendChild(h('div', { class: 'dim-note', text: 'No turns yet today.' }));
    for (const r of recent) {
      const measured = r.status === 'reported' && r.total != null;
      root.appendChild(h('div', { class: `turn-row ${measured ? '' : 'unmeasured'}` },
        avatar(r.resident, residentByName(r.resident)?.color, 'xs'),
        h('span', { class: 'turn-who' }, h('b', { text: String(r.resident || '?') }), h('span', { class: 'dim-note', text: ` · ${r.kind || 'life'}${r.web ? ' · web search' : ''}` })),
        h('span', { class: 'chip chip-other', text: `${r.provider || '?'}${r.model ? ` · ${r.model}` : ''}` }),
        h('span', { class: 'turn-total', text: measured ? fmtTok(r.total) : 'unavailable' }),
        h('span', { class: 'dim-note turn-meta', text: `${fmtDur(r.durationMs)}${r.outcome && r.outcome !== 'ok' ? ` · ${r.outcome}` : ''} · ${relTime(r.endedAt)}` })));
    }
    }

    // sessions (the heroes' own usage is not measured here)
    const sessions = usage.sessions && typeof usage.sessions === 'object' ? usage.sessions : null;
    root.appendChild(h('div', { class: 'temple-section-title' }, h('span', { text: 'The heroes’ sessions' })));
    root.appendChild(h('div', { class: 'sessions-note' },
      h('span', { class: `pill ${sessions?.status === 'measured' ? 'pill-running' : 'pill-stale'}`, text: String(sessions?.status || 'unmeasured') }),
      h('span', { text: sessions?.note ? ` ${sessions.note}` : ' The heroes\u2019 real sessions are not metered by Amygdala.' })));
  }
  function providerAlias(k) { return { anthropic: 'claude', openai: 'codex', google: 'antigravity', xai: 'grok' }[String(k).toLowerCase()] || String(k).toLowerCase(); }
  function amphoraCard(label, remaining, windows, stale, note) {
    const card = h('div', { class: `amphora-card ${remaining == null ? 'unknown' : ''} ${stale ? 'stale' : ''}` });
    const fill = remaining == null ? 0 : remaining / 100;
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 40 56'); svg.setAttribute('class', 'amphora-svg'); svg.setAttribute('aria-hidden', 'true');
    const H = 36, y0 = 14, level = y0 + H * (1 - fill);
    const node = (tag, attrs, parent = svg) => {
      const el = document.createElementNS(svgNS, tag);
      for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
      parent.appendChild(el); return el;
    };
    const outline = 'M12,8 h16 l2,4 l-1,20 q-1,12 -9,12 q-8,0 -9,-12 l-1,-20 z';
    const clipId = `amph-${label.replace(/[^a-z0-9]/gi, '')}`;
    const defs = node('defs', {});
    node('path', { d: outline }, node('clipPath', { id: clipId }, defs));
    node('path', { d: outline, fill: '#E8D9B5', stroke: '#8A6A4A', 'stroke-width': 1 });
    node('rect', { x: 8, y: level.toFixed(1), width: 24, height: (y0 + H - level + 2).toFixed(1), fill: remaining == null ? '#CFC7B5' : remaining < 20 ? '#A66A46' : '#D9A441', 'clip-path': `url(#${clipId})` });
    node('rect', { x: 11, y: 5, width: 18, height: 3, fill: '#8A6A4A' });
    node('path', { d: 'M9,12 q-5,6 0,12 M31,12 q5,6 0,12 M14,46 h12', fill: 'none', stroke: '#8A6A4A', 'stroke-width': 1.6 });
    card.appendChild(svg);
    card.appendChild(h('div', { class: 'amphora-label', text: label }));
    card.appendChild(h('div', { class: 'amphora-pct', text: remaining == null ? (note || 'not reported') : `${Math.round(remaining)}% left` }));
    for (const w of windows) card.appendChild(h('div', { class: 'amphora-win', text: w.rolledOver ? `${w.label || w.kind || 'window'}: reset · waiting for a fresh reading` : `${w.label || w.kind || 'window'}: ${Math.round(+w.used_percentage)}% used${w.stale || stale ? ' · stale' : ''}${untilText(w.resets_at) ? ` · ${untilText(w.resets_at)}` : ''}` }));
    if (stale) card.appendChild(h('div', { class: 'amphora-win stale-note', text: 'reading may be stale' }));
    return card;
  }
  function statTile(label, value, sub) {
    return h('div', { class: 'stat-tile' }, h('div', { class: 'stat-value', text: value }), h('div', { class: 'stat-label', text: label }), sub ? h('div', { class: 'stat-sub', text: sub }) : null);
  }
  function sparkline(history) {
    const days = history.filter((d) => d && d.day).slice(-14);
    const box = h('div', { class: 'spark' });
    if (!days.length) { box.appendChild(h('div', { class: 'dim-note', text: 'No history yet.' })); return box; }
    const max = Math.max(1, ...days.map((d) => +d.tokens || 0));
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${days.length * 16} 44`); svg.setAttribute('class', 'spark-svg'); svg.setAttribute('preserveAspectRatio', 'none');
    days.forEach((d, i) => {
      const v = (+d.tokens || 0) / max;
      const r = document.createElementNS(svgNS, 'rect');
      r.setAttribute('x', i * 16 + 3); r.setAttribute('y', (40 - v * 36).toFixed(1)); r.setAttribute('width', 10); r.setAttribute('height', (v * 36 + 1).toFixed(1)); r.setAttribute('rx', 1.5);
      r.setAttribute('class', i === days.length - 1 ? 'spark-bar today' : 'spark-bar');
      const t = document.createElementNS(svgNS, 'title'); t.textContent = `${d.day}: ${fmtTok(d.tokens)} tokens · ${+d.turns || 0} turns`; r.appendChild(t);
      svg.appendChild(r);
    });
    box.appendChild(h('div', { class: 'spark-title', text: `Last ${days.length} days · peak ${fmtTok(max)}` }));
    box.appendChild(svg);
    box.appendChild(h('div', { class: 'spark-axis' }, h('span', { text: days[0].day }), h('span', { text: days[days.length - 1].day })));
    return box;
  }
  function bars(title, rows) {
    const box = h('div', { class: 'bars' }, h('div', { class: 'bars-title', text: title }));
    const max = Math.max(1, ...rows.map((r) => r.tokens));
    if (!rows.length) box.appendChild(h('div', { class: 'dim-note', text: 'nothing yet' }));
    for (const r of rows.sort((a, b) => b.tokens - a.tokens)) {
      const fill = h('span', { class: 'bar-fill' });
      fill.style.width = `${Math.round((r.tokens / max) * 100)}%`;
      if (r.color) fill.style.background = safeCssColor(r.color, 'var(--ink-dim)');
      box.appendChild(h('div', { class: 'bar-row' },
        h('span', { class: 'bar-label', text: r.label }),
        h('span', { class: 'bar-track' }, fill),
        h('span', { class: 'bar-val', text: `${fmtTok(r.tokens)} · ${r.turns} turn${r.turns === 1 ? '' : 's'}${r.extra ? ` · ${r.extra}` : ''}` })));
    }
    return box;
  }

  // ---- counts & update ----
  function update(s) {
    state = s || {};
    residentColors = new Map((state.residents || []).filter((r) => r && r.name).map((r) => [r.name, r.color]));
    if (!hasIsle() && zone === 'isle') setZone('village');
    renderZoneSwitches();
    renderBoard(false);
    renderProjectsStrip();
    renderExhibits();
    renderTales();
    renderResidents();
    renderOrders();
    renderGate();
    renderWorkshop();
    renderLamps();
    const workers = state.workers || [];
    els.badgeWait.hidden = !workers.some((w) => w && w.status === 'waiting' && w.needsPermission && !w.stale);
    const omens = omenCount();
    const ob = document.getElementById('badge-omen');
    if (ob) { ob.hidden = !omens; ob.textContent = String(omens); }
    opts.onOmenCount?.(omens);
    const cc = counselCount();
    const cb = document.getElementById('badge-counsel');
    if (cb) { cb.hidden = !cc; cb.textContent = String(cc); }
    opts.onNeedsCount?.(villageNeedsCount());
  }
  function refreshTimes() {
    for (const t of els.posts.querySelectorAll('.post-time')) t.textContent = relTime(+t.dataset.ts);
  }

  function openOrder(id) { selectTab('orders'); const card = [...document.querySelectorAll('.order-card')].find(c => JSON.parse(c.dataset.orderIds || '[]').includes(id)); if (card) { for (let parent = card.parentElement; parent && parent !== document.body; parent = parent.parentElement) if (parent.tagName === 'DETAILS') parent.open = true; card.querySelector('details').open = true; card.scrollIntoView({ block: 'nearest' }); } }
  function orderTo(name) {
    selectTab('orders'); renderOrders();
    const root = document.getElementById('orders'); if (!root?._to) return;
    const checks = root._to._checks || [], eligible = checks.some(c => c.value === name && c.value !== 'all');
    for (const c of checks) c.checked = eligible && c.value === name;
    if (eligible) root._form.querySelector('[aria-label="Headline"]')?.focus();
  }
  function showResident(name) { selectTab('residents'); residentOpen.add(name); const row = residentRows.get(name); if (!row) return; applyResidentOpen(row); row.scrollIntoView?.({ block: 'nearest' }); row._toggle.focus(); row.classList.add('flash'); setTimeout(() => row.classList.remove('flash'), 1200); }
  return { openOrder, orderTo, showResident, update, selectTab, setChannel, setZone, refreshTimes, get activeTab() { return activeTab; }, get channel() { return channel; }, get zone() { return zone; } };
}

// ---------- WebAudio melody ----------
let audioCtx = null;
function noteMidi(n) {
  const m = /^([A-Ga-g])([#b]?)(\d)$/.exec(String(n).trim());
  if (!m) return null;
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1].toUpperCase()];
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  const oct = +m[3];
  if (oct < 1 || oct > 8) return null;
  return (oct + 1) * 12 + base + acc;
}
function playMelody(notes, tempo, onStep, onDone) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
  } catch (_) { onDone?.(); return { stop() {} }; }
  const ctx = audioCtx;
  if (ctx.state === 'suspended') ctx.resume();
  const beat = 60 / tempo;
  const master = ctx.createGain();
  master.gain.value = 0.5;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 2400;
  master.connect(filter).connect(ctx.destination);
  const t0 = ctx.currentTime + 0.05;
  const timers = [];
  notes.forEach((n, i) => {
    const t = t0 + i * beat;
    const midi = noteMidi(n);
    timers.push(setTimeout(() => onStep?.(i), Math.max(0, (t - ctx.currentTime) * 1000)));
    if (midi == null) return;
    const freq = 440 * Math.pow(2, (midi - 69) / 12);
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = freq * 2;
    const g = ctx.createGain();
    const g2 = ctx.createGain();
    const dur = beat * 0.95;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.12, t + dur * 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g2.gain.setValueAtTime(0.0001, t);
    g2.gain.exponentialRampToValueAtTime(0.06, t + 0.01);
    g2.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.5);
    osc.connect(g).connect(master);
    osc2.connect(g2).connect(master);
    osc.start(t); osc.stop(t + dur + 0.05);
    osc2.start(t); osc2.stop(t + dur + 0.05);
  });
  const total = (t0 - ctx.currentTime + notes.length * beat) * 1000 + 100;
  const doneTimer = setTimeout(() => { onDone?.(); }, total);
  return {
    stop() {
      timers.forEach(clearTimeout);
      clearTimeout(doneTimer);
      master.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.03);
      setTimeout(() => master.disconnect(), 200);
      onDone?.();
    },
  };
}

// A terminal view owns all of its network and xterm resources.
export function mountHeroTerminal(root, worker, { token, mock, onClose }) {
  const url = deckLink(worker);
  const status = worker.status === 'waiting' && !worker.needsPermission ? 'idle' : String(worker.status || 'idle');
  root.textContent = '';
  const body = h('div', { class: 'terminal-body' });
  const hint = h('div', { class: 'terminal-hint dim-note', text: `Live terminal — what you type goes to the hero. To select text to copy, hold ${/Mac/.test(navigator.platform) ? 'Option' : 'Shift'} while dragging.` });
  const connection = h('div', { class: 'terminal-connection terminal-status dim-note', role: 'status', hidden: true });
  const setConnection = text => { connection.textContent = text; connection.hidden = !text; };
  const note = h('div', { class: 'terminal-status dim-note', hidden: true });
  // A failed close must not look like a detached terminal, or be cleared by image-paste status timers.
  const endError = h('div', { class: 'terminal-end-error terminal-status terminal-status-error', role: 'alert', hidden: true });
  const endButton = h('button', { class: 'btn btn-xs', type: 'button', text: 'End session', onClick: async () => {
    if (endButton.disabled) return;
    endButton.disabled = true; endError.hidden = true;
    try {
      if (!mock) {
        const response = await fetch(`/api/term/${encodeURIComponent(worker.id)}/close`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Amygdala-Token': token }, body: '{}' });
        if (!response.ok) throw new Error(`Could not end session (HTTP ${response.status}). Try again.`);
      }
      onClose();
    } catch (error) { endError.textContent = error?.message || 'Could not end session. Try again.'; endError.hidden = false; }
    finally { endButton.disabled = false; }
  } });
  root.append(h('div', { class: 'terminal-header' },
    h('h2', { text: `Terminal — ${worker.title || worker.id}` }),
    h('span', { class: `pill pill-${worker.stale ? 'stale' : status}`, text: worker.stale ? 'last seen a while ago' : status === 'waiting' ? 'needs your permission' : status }),
    url ? h('a', { class: 'btn btn-xs', href: url, target: '_blank', rel: 'noopener', text: 'Open in Agent Deck ↗' }) : null,
    h('button', { class: 'btn btn-xs', type: 'button', text: 'Detach', onClick: onClose }),
    endButton), hint, connection, note, endError, body);
  if (mock) {
    body.append(h('div', { class: 'terminal-placeholder', text: `Mock terminal for ${worker.title || worker.id} — the live session appears here.` }));
    return () => { root.textContent = ''; };
  }
  if (worker.os === 'windows' && !worker.node) {
    const launch = command => fetch(`/api/term/${encodeURIComponent(worker.id)}/input`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Amygdala-Token': token }, body: JSON.stringify({ d: btoa(command + '\r') }) });
    hint.append(' ', h('button', { class: 'btn btn-xs', text: 'Claude resume', onClick: () => launch('claude --resume') }), ' ', h('button', { class: 'btn btn-xs', text: 'Codex resume', onClick: () => launch('codex resume') }));
  }
  const mount = h('div', { class: 'terminal-mount' });
  body.append(mount);
  const term = new window.Terminal({
    // CLIs that capture the mouse swallow plain drags; on a Mac only Option-drag can then select (Shift elsewhere).
    cursorBlink: true, fontSize: 13, macOptionClickForcesSelection: true,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
    theme: { background: '#171c21', foreground: '#e6dfd1', cursor: '#e7a26b', selectionBackground: '#46515d' },
  });
  const fit = new window.FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(mount);
  const base = `/api/term/${encodeURIComponent(worker.id)}`;
  const controller = new AbortController();
  let disposed = false, ended = false;
  let frame;
  term.attachCustomKeyEventHandler(event => terminalKeys(term, event));
  const transport = terminalInput({
    send: (action, data) => fetch(`${base}/${action}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Amygdala-Token': token },
      body: JSON.stringify(data), signal: controller.signal,
    }),
    error: error => { if (!disposed && !ended) setConnection(error.message); },
  });
  // Pasted or dropped images go to the hero's machine; capture runs before xterm's own paste handler.
  let noteTimer;
  const images = terminalImages({
    term,
    upload: data => fetch(`${base}/image`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Amygdala-Token': token }, body: JSON.stringify(data), signal: controller.signal }),
    status: (text, error) => { if (disposed) return; clearTimeout(noteTimer); note.textContent = text; note.hidden = !text; note.classList.toggle('terminal-status-error', !!error); if (error) noteTimer = setTimeout(() => { note.hidden = true; }, 8000); },
  });
  for (const kind of ['paste', 'drop', 'dragover']) mount.addEventListener(kind, images[kind], true);
  const resize = () => {
    if (disposed || ended || !mount.clientWidth || !mount.clientHeight) return;
    fit.fit();
    transport.resize(term.cols, term.rows);
  };
  const observer = new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(resize);
  });
  observer.observe(mount);
  // A server or node restart can refuse the stream for a few seconds, and EventSource never retries a refusal: keep
  // reopening it, and redraw from the fresh attach instead of appending it to the old screen.
  let source, opened = false, retry, delay = 1000;
  const connect = () => {
    source = new EventSource(`${base}/stream?token=${encodeURIComponent(token)}`);
    source.onopen = () => {
      if (opened) term.reset(); opened = true; delay = 1000;
      transport.connect();
      setConnection('');
      resize();
    };
    source.addEventListener('o', event => {
      if (!disposed && !ended) term.write(Uint8Array.from(atob(event.data), ch => ch.charCodeAt(0)));
    });
    source.addEventListener('exit', () => {
      ended = true; source.close();
      transport.dispose();
      setConnection('session ended');
      term.options.disableStdin = true;
      term.write('\r\n\x1b[90msession ended\x1b[0m\r\n');
    });
    source.onerror = () => {
      if (disposed || ended) return;
      setConnection('Terminal connection lost — reconnecting…');
      if (source.readyState === EventSource.CLOSED) { clearTimeout(retry); retry = setTimeout(connect, delay); delay = Math.min(delay * 2, 15000); }
    };
  };
  connect();
  const dataListener = term.onData(data => { if (!disposed && !ended) transport.data(data); });
  frame = requestAnimationFrame(() => { resize(); term.focus(); });
  return () => {
    disposed = true;
    transport.dispose(); images.dispose(); clearTimeout(noteTimer); cancelAnimationFrame(frame);
    clearTimeout(retry); source.close(); controller.abort(); observer.disconnect();
    dataListener.dispose(); term.dispose(); root.textContent = '';
  };
}

// The Steward's House (v0.49): read-only, for the human only, every line from the snapshot (stewardHouse is derived on
// the server from the Temple ledger, approvals, receipts and the running commit; it keeps no records of its own). A
// dispatch is not proof of arrival: orders and commissions keep sent, started and confirmed or answered apart.
export function stewardPane(s, { onHero } = {}) {
  const sh = s.stewardHouse, out = h('div', { class: 'steward-pane' }), short = (x) => (x ? String(x).slice(0, 7) : '—');
  const sec = (title, ...kids) => out.append(h('div', { class: 'card-section-title', text: title }), ...kids.filter(Boolean));
  const row = (...kids) => h('div', { class: 'sh-row' }, ...kids), chip = (cls, text) => h('span', { class: `chip ${cls}`, text });
  const cite = (c) => (c ? `${c.kind} #${c.seq}${c.by ? ` by ${c.by}` : ''}` : '');
  const stone = { ok: 'The stone burns gold: what runs is what the Temple approved.', drift: 'The stone holds an ember: what runs and what was approved differ.', unknown: 'The stone is unlit: nothing deployed is known yet.' }[sh.stone] || '';
  out.append(h('div', { class: `sh-stone sh-${sh.stone}` }, h('span', { class: 'sh-flame', 'aria-hidden': 'true' }), h('div', {}, h('b', { text: stone }), h('div', { class: 'worker-path', text: `running commit ${sh.version ? short(sh.version) : 'unknown'}` }), ...(sh.why || []).map((w) => h('div', { class: 'sh-why', text: w })))));
  // a. deploy state per project
  sec(`Deploy state · ${sh.projects.length}`, sh.projects.length ? null : h('div', { class: 'dim-note', text: 'No project has an approval or a receipt yet.' }));
  for (const p of sh.projects) {
    const st = { matches: ['yes', 'deployed = approved'], differs: ['no', 'deployed ≠ approved'], undeployed: ['warn', 'approved, never deployed'], unapproved: ['no', 'deployed, nothing approved'] }[p.state] || ['', p.state];
    out.append(row(h('span', { class: 'worker-path sh-key', text: p.key }), chip(st[0], st[1]), p.running ? chip('', 'running here') : null,
      h('div', { class: 'sh-detail', text: `approved ${short(p.approved?.sha)}${p.approved ? (p.approved.baseline ? ' · baseline set by you' : ` · offering ${p.approved.offeringId}`) : ''}${p.approved?.cites ? ` · ${cite(p.approved.cites)}` : ''}` }),
      h('div', { class: 'sh-detail', text: `deployed ${short(p.deployed?.sha)}${p.deployed ? ` · receipt ${p.deployed.receiptId} · ${relTime(p.deployed.at)}` : ''}` })));
  }
  // b. receipts, each with what authorised it
  sec(`Deploy receipts · ${sh.receipts.length}`, sh.receipts.length ? null : h('div', { class: 'dim-note', text: 'No deploys recorded.' }));
  for (const r of sh.receipts) out.append(row(h('span', { class: 'worker-path', text: `${r.id} · ${short(r.sha)} ` }), r.reverted ? chip('warn', 'reverted') : null, !r.cites ? chip('no', 'no citation') : !r.standing ? chip('no', 'approval withdrawn') : chip('yes', cite(r.cites)),
    h('div', { class: 'sh-detail', text: `${r.key} · offering ${r.offeringId} · by ${r.actor} · ${relTime(r.ts)}${r.note ? ` · ${r.note}` : ''}` })));
  // c. overrides, trivial-rule skips and appeals
  sec(`Overrides, skips and appeals · ${sh.notes.length}`, sh.notes.length ? null : h('div', { class: 'dim-note', text: 'None in the ledger.' }));
  for (const e of sh.notes) out.append(row(chip(e.kind === 'override' ? 'warn' : '', `#${e.seq} ${e.kind}${e.what ? ` (${e.what})` : ''}`), h('span', { class: 'sh-detail', text: ` by ${e.actor}${e.verdict ? ` · ${e.verdict}` : ''}${e.final ? ' · final' : ''} · ${short(e.sha)} · ${relTime(e.ts)}` }), e.reason ? h('div', { class: 'sh-detail dim-note', text: e.reason }) : null));
  // d. nodes and the Steward's own session
  const nodes = s.nodes || [], st = sh.steward || {};
  sec(`Nodes · ${nodes.filter((n) => n.online).length} of ${nodes.length} online`, nodes.length ? null : h('div', { class: 'dim-note', text: 'No node passes.' }));
  for (const n of nodes) out.append(row(chip(n.online ? 'yes' : 'no', n.online ? 'online' : 'offline'), h('span', { text: ` ${n.name}` }), h('span', { class: 'sh-detail', text: ` · ${n.os || 'unknown os'} · ${n.deckAvailable ? 'agent-deck' : 'no agent-deck'} · last report ${n.lastReport ? relTime(n.lastReport) : 'never'}` })));
  out.append(row(h('b', { text: 'The Steward’s session ' }), !st.set ? chip('warn', 'not named') : !st.onMap ? chip('no', 'not on the map') : chip(st.reachable ? 'yes' : 'no', st.reachable ? 'reachable' : 'unreachable'), st.down ? chip('no', 'down') : null,
    st.onMap ? h('div', { class: 'sh-detail' }, h('span', { class: 'here-chip', onClick: () => onHero?.(st.workerId) }, `${String(st.title || '').slice(0, 32)} · ${st.stale ? 'last seen a while ago' : st.status}`)) : null));
  // e. orders and commissions in flight: sent → started → answered or confirmed
  const steps = (n, fail) => h('span', { class: `sh-steps${fail ? ' failed' : ''}`, title: ['sent', 'started', 'confirmed'].slice(0, n).join(' → ') }, ...[0, 1, 2].map((i) => h('i', { class: i < n ? 'on' : '' })));
  const hero = (to) => (s.workers || []).find((w) => w.id === to && w.zone === 'village');
  const village = (to) => (s.residents || []).some((r) => r.name === to && r.zone === 'village') || !!hero(to);
  const orders = (s.orders || []).filter((o) => village(o.to) && (['queued', 'working'].includes(o.status) || Date.now() - (o.answeredAt || o.createdAt) < 86400000)).slice(-12).reverse();
  const coms = sh.commissions || [];
  sec(`Orders and commissions · ${orders.length + coms.length}`, orders.length + coms.length ? null : h('div', { class: 'dim-note', text: 'Nothing in flight today.' }));
  for (const o of orders) {
    const n = { queued: 1, working: 2, answered: 3 }[o.status] || 1, word = { queued: 'sent', working: 'started', answered: hero(o.to) ? 'delivered' : 'answered', failed: 'failed', cancelled: 'cancelled' }[o.status] || o.status;
    out.append(row(steps(n, ['failed', 'cancelled'].includes(o.status)), h('span', { class: 'sh-word', text: word }), h('span', { text: ` ${o.headline || ''}` }), h('div', { class: 'sh-detail', text: `order to ${hero(o.to)?.title || o.to} · from ${o.from} · ${relTime(o.answeredAt || o.createdAt)}${o.error ? ` · ${o.error}` : ''}` })));
  }
  for (const c of coms) out.append(row(steps({ sent: 1, started: 2, confirmed: 3 }[c.state] || 1, c.state === 'failed'), h('span', { class: 'sh-word', text: c.state === 'started' ? 'launched, not yet seen' : c.state }), h('span', { text: ` ${c.title || `a ${c.tool} hero for the ${c.site}`}` }), h('div', { class: 'sh-detail', text: `commission on ${c.machine} · ${relTime(c.at)}` })));
  // f. the human's digest
  const digest = s.governance?.digest || [];
  sec(`Your digest · ${digest.length}`, digest.length ? null : h('div', { class: 'dim-note', text: 'Nothing for your reading.' }));
  for (const d of digest) out.append(row(d.escalation ? chip('no', 'only you') : null, h('span', { class: 'worker-path', text: `${d.project || ''} ${short(d.sha)} ` }), h('span', { text: String(d.text || '') })));
  out.append(h('div', { class: 'dim-note sh-foot', text: 'Read-only. The Temple ledger is the record, and work is still offered at the Temple.' }));
  return out;
}
