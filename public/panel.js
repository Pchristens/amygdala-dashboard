import { terminalInput, terminalKeys, terminalImages } from './terminal-input.js';
const osLabel = os => ({ macos: 'macOS', windows: 'Windows', linux: 'Linux' }[os] || '');
// Side panel: Board / Exhibits / Residents / Workshop tabs, with a Village / Isle zone switch.
import { h, agentClass, relTime, avatar, capitalize, commitmentEl, safeCssColor, runeTablet, toRunes } from './util.js';
import { zoneOf } from './svg-util.js';

const CHANNELS = ['commons', 'projects', 'discoveries', 'play'];
const AGENT_DECK_URL = 'http://127.0.0.1:8420';
const DAY = 24 * 3600 * 1000;

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
    tabs: Array.from(document.querySelectorAll('.tab')),
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
  let notifyPetitions = false, titleTimer = null;
  const baseTitle = document.title;
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { clearInterval(titleTimer); titleTimer = null; document.title = baseTitle; } });
  function petitionDecision(p, deny = false) {
    const dialog = h('dialog', { class: 'dialog pass-dialog' });
    const select = h('select', { class: 'input', 'aria-label': 'Answerer' });
    const order = [p.triage?.suggest, ...(p.triage?.alternates || [])];
    const residents = [...(p.answerers || [])].sort((a, b) => {
      const rank = name => order.includes(name) ? order.indexOf(name) : 999;
      return rank(a.name) - rank(b.name);
    });
    for (const r of residents) select.append(h('option', { value: r.name, text: `${r.name} · ${r.tier} · ${r.usage == null ? 'usage unknown' : `${r.usage}%`}` }));
    select.append(h('option', { value: 'self', text: 'Answer myself' }));
    select.value = residents.some(r => r.name === p.triage?.suggest) ? p.triage.suggest : residents[0]?.name || 'self';
    const answer = h('textarea', { class: 'input', rows: 8, maxlength: 20000, 'aria-label': 'Your answer' });
    const note = h('textarea', { class: 'input', rows: 2, maxlength: 2000, placeholder: 'Optional note', 'aria-label': 'Optional note' });
    const error = h('div', { class: 'dialog-error', role: 'alert' });
    select.hidden = deny;
    const update = () => { answer.hidden = deny || select.value !== 'self'; }; select.addEventListener('change', update); update();
    const decide = async action => {
      const result = await opts.api(`/api/petitions/${encodeURIComponent(p.id)}/${action}`, { answerer: select.value, answer: answer.value, note: note.value });
      if (result?.ok === false) error.textContent = result.error; else dialog.close();
    };
    dialog.append(h('h2', { text: `Guidance for ${p.visitor}` }), h('p', { class: 'petition-text', text: p.question }), select, answer, note, error,
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
    root.append(h('h2', { text: `Petitions${pending.length ? ` (${pending.length})` : ''}` }));
    root.append(h('button', { class: 'btn btn-xs', text: notifyPetitions ? 'Notifications on · turn off' : 'Notify me', onClick: async () => {
      if (notifyPetitions) notifyPetitions = false;
      else if (window.Notification) notifyPetitions = (await Notification.requestPermission()) === 'granted';
      renderOrders();
    renderGate();
    } }));
    if (!petitions.length) root.append(h('p', { class: 'dim-note', text: 'No petitions yet. Visitors can ask privately for guidance; each request needs your decision.' }));
    const live = ['pending', 'allowed', 'answering', 'commissioning', 'commissioned'];
    const active = petitions.filter(p => live.includes(p.status));
    const history = petitions.filter(p => !live.includes(p.status)).slice(-20).reverse();
    for (const p of [...active, ...history]) {
      const card = h('div', { class: 'gate-pass' }, h('b', { text: p.visitor }), h('div', { text: p.about || 'Guidance' }),
        h('div', { class: 'dim-note', text: `${new Date(p.askedAt).toLocaleString()} · ${p.status}` }), h('p', { class: 'petition-text', text: p.question }));
      if (p.status === 'pending') {
        card.append(h('p', { class: 'dim-note' }, h('small', {}, h('i', { text: p.triage?.greeting || `${harbourName()} is reading your question` }))));
        if (p.triage) card.append(h('span', { class: 'chip', text: p.triage.tier }), h('p', { class: 'dim-note', text: `${p.triage.by || harbourName()} suggests ${p.triage.suggest || 'Answer myself'} — ${p.triage.reason}` }));
      }
      if (p.answer) card.append(h('b', { text: p.answerer || 'Answer' }), h('p', { class: 'petition-text', text: p.answer }));
      if (p.note) card.append(h('p', { class: 'petition-text dim-note', text: p.note }));
      if (p.heroTitle && p.status !== 'pending') petitionHero(card, p);
      if (p.status === 'pending') card.append(h('button', { class: 'btn btn-xs', text: 'Allow…', onClick: () => petitionDecision(p) }), ' ', h('button', { class: 'btn btn-xs', text: 'Deny…', onClick: () => petitionDecision(p, true) }), ' ', h('button', { class: 'btn btn-xs', text: 'Make it a hero…', title: 'Commission a hero for this request; it can talk with the visitor', onClick: () => opts.onPetitionHero?.(p) }));
      root.append(card);
    }
  }
  function renderGate() {
    const root = $('gate'); root.textContent = '';
    renderPetitions(root);
    root.append(h('h2', { text: 'Visitors' }));
    const date = (ts) => ts ? new Date(ts).toLocaleString() : 'never';
    for (const [kind, key, title] of [['visitors', 'visitorPasses', 'Visitor'], ['heroes', 'heroPasses', 'Hero'], ['nodes', 'nodes', 'Node']]) {
      root.append(h('div', { class: 'temple-section-title', text: `${title} passes` }), h('button', { class: 'btn btn-xs', type: 'button', text: `Issue a ${title.toLowerCase()} pass…`, onClick: () => issuePass(kind) }));
      const list = state[key] || [];
      if (!list.length) root.append(h('p', { class: 'dim-note', text: 'No passes issued.' }));
      for (const pass of list) {
        const revoke = h('button', { class: 'btn btn-xs', type: 'button', text: 'Revoke', disabled: !!pass.revoked });
        revoke.addEventListener('click', async () => { revoke.disabled = true; const result = await opts.api(`/api/${kind}/revoke`, { id: pass.id }); if (result?.ok === false) revoke.disabled = false; });
        root.append(h('div', { class: 'gate-pass' }, h('b', { text: String(pass.name || 'Unnamed') }), ' ',
          kind === 'nodes' ? h('button', { class: 'btn btn-xs', text: pass.notify === false ? 'Notifications off' : 'Notifications on', onClick: () => opts.api('/api/nodes/notify', { id: pass.id, on: pass.notify === false }) }) : null,
          kind === 'heroes' ? h('span', { class: 'chip', text: pass.zone || 'village' }) : null,
          h('div', { text: String(pass.label || '') }), h('div', { class: 'dim-note', text: `${pass.revoked ? 'Revoked · ' : ''}expires ${date(pass.expiresAt)}${kind === 'visitors' ? ` · last seen ${date(pass.lastSeen)}` : ''}` }), revoke));
      }
    }
  }
  let exhibitView = 'art';
  $('exhibit-tabs').addEventListener('click', (e) => {
    const button = e.target.closest('[data-view]'); if (!button) return;
    exhibitView = button.dataset.view;
    for (const b of $('exhibit-tabs').children) b.setAttribute('aria-selected', String(b === button));
    els.exhibits.hidden = exhibitView !== 'art'; $('tales').hidden = exhibitView !== 'tales'; renderTales();
  });
  function renderTales() {
    const root = $('tales'); root.textContent = '';
    if (isleLocked()) { renderSealedTablet(root); return; }
    if (state.taleSettings) {
      const controls = h('div', { class: 'panel-settings' }, h('b', { text: 'Epic labours - any threshold earns a tale' })), error = h('span', { role: 'status' });
      for (const [key, label, max] of [['minHours', 'Hours worked', 48], ['minFixed', 'Findings fixed', 1000], ['minCommits', 'Commits', 1000]]) {
        const input = h('input', { type: 'number', min: '0', max: String(max), step: key === 'minHours' ? '0.1' : '1', value: state.taleSettings[key], 'aria-label': label });
        input.addEventListener('change', async () => { try { const result = await opts.api('/api/tales/settings', { [key]: input.value === '' ? null : +input.value }); error.textContent = result?.error || ''; } catch (e) { error.textContent = e.message; } });
        controls.append(h('label', {}, label, input));
      }
      controls.append(error); root.append(controls);
    }
    const list = (state.tales || []).filter((t) => zoneOf(t) === zone).slice().reverse();
    if (!list.length) root.append(h('div', { class: 'empty', text: 'No labours recorded yet.' }));
    for (const t of list) root.append(h('article', { class: 'tale-scroll' },
      h('h2', { text: t.tale?.title || (t.owed === false ? 'Labour recorded' : 'The tale is yet to be told') }),
      h('div', { class: 'dim-note', text: `Bard: ${t.bard || (t.owed === false ? 'no tale owed' : 'awaiting a bard')} · ${t.hero || 'Hero'} · ${t.project || '—'} · ${t.site || '—'}` }),
      h('div', { text: `${Math.round((+t.workedMs || 0) / 60000)} minutes worked` }),
      h('div', { class: 'tale-commits' }, (t.commits || []).map((c) => h('span', { class: 'chip', text: String(c) }))),
      h('div', { class: 'dim-note', text: t.stat || 'No committed diffstat recorded.' }),
      h('div', { text: `Omens answered: ${(t.fixed || []).join(' · ') || 'none recorded'}` }),
      t.uncommitted ? h('div', { class: 'dim-note', text: 'Uncommitted changes remain.' }) : null,
      t.words ? h('blockquote', { text: String(t.words) }) : null,
      h('div', { class: 'tale-text', text: t.tale?.text || (t.owed === false ? 'The labour stands as facts.' : 'The tale is yet to be told.') })));
  }

  let ordersKey = '';
  function renderOrders() {
    const root = document.getElementById('orders'); if (!root || !state.orders) return;
    if (!root._form) {
      const to = h('select', { 'aria-label': 'Residents', multiple: true, size: 5 }), headline = h('input', { placeholder: 'Headline (optional)', maxLength: 180, 'aria-label': 'Headline' }), brief = h('textarea', { placeholder: 'Private brief', maxLength: 12000, required: true, 'aria-label': 'Private brief' });
      const submit = h('button', { class: 'btn btn-primary', type: 'submit', text: 'Give an order' }), error = h('div', { class: 'dim-note' });
      const form = h('form', { class: 'order-form' }, h('h3', { text: 'Give an order' }), h('label', { text: 'Recipients (select several or Whole village)' }), to, headline, brief, submit, error);
      form.addEventListener('submit', async e => { e.preventDefault(); submit.disabled = true; const result = await opts.api('/api/orders', { to: [...to.selectedOptions].some(o => o.value === 'all') ? 'all' : [...to.selectedOptions].map(o => o.value), headline: headline.value, brief: brief.value }); submit.disabled = false; error.textContent = result?.error || ''; if (result?.id) { brief.value = ''; headline.value = ''; } });
      root._form = form; root._to = to; root._list = h('div'); root.append(form, root._list);
    }
    const residents = (state.residents || []).filter(r => r.zone === 'village' && r.enabled && !r.hibernate);
    const key = residents.map(r => r.name).join('|'); if (root._key !== key) { const selected = root._to.value; root._to.textContent = ''; root._to.append(h('option', { value: 'all', text: 'Whole village' })); for (const r of residents) root._to.append(h('option', { value: r.name, text: r.name })); if (residents.some(r => r.name === selected)) root._to.value = selected; root._key = key; }
    const next = JSON.stringify(state.orders); if (ordersKey === next) return; ordersKey = next; root._list.textContent = '';
    const groups = new Map(); for (const o of state.orders) { const key = o.group || o.id; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(o); }
    for (const members of [...groups.values()].reverse()) {
      const o = members[0];
      const card = h('article', { class: 'order-card' }, h('div', { class: 'dim-note', text: members.map(m => `${m.to} · ${m.status}`).join(' | ') }), h('h3', { text: o.headline }), h('p', { text: o.chat || o.error || '' }));
      if (o.group) { const chips = h('div', { class: 'card-row' }); for (const m of members) chips.append(h('span', { class: 'badge', text: `${m.to}: ${m.status}` })); card.append(chips); }
      const details = h('details', {}, h('summary', { text: 'Brief and report' })), content = h('div'); details.append(content);
      details.addEventListener('toggle', async () => { if (!details.open) return; const full = await opts.api(o.group ? `/api/orders/group/${encodeURIComponent(o.group)}` : `/api/orders/${encodeURIComponent(o.id)}`, null, 'GET'); content.textContent = ''; if (!full?.id) { content.textContent = full?.error || 'Could not load order.'; return; } for (const member of full.members || [full]) { if (full.members) content.append(h('h3', { text: member.to })); for (const [label, value] of [['Brief', member.brief], ['Chat', member.chat], ['Report', member.report], ['Data', member.data ? JSON.stringify(member.data, null, 2) : '']]) if (value) content.append(h('h4', { text: label }), h('pre', { text: value })); } });
      card.dataset.orderIds = JSON.stringify(members.map(m => m.id));
      card.append(details); for (const m of members) if (['queued', 'working'].includes(m.status)) card.append(h('button', { class: 'btn btn-xs', text: `Cancel ${m.to}`, onClick: () => opts.api(`/api/orders/${encodeURIComponent(m.id)}/cancel`, {}) })); root._list.append(card);
    }
  }

  // ---- tabs ----
  for (const t of els.tabs) t.addEventListener('click', () => selectTab(t.dataset.tab));
  function selectTab(name) {
    if (!els.bodies.some((b) => b.dataset.tab === name)) return;
    activeTab = name;
    for (const t of els.tabs) t.setAttribute('aria-selected', t.dataset.tab === name ? 'true' : 'false');
    for (const b of els.bodies) b.hidden = b.dataset.tab !== name;
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
    if (!list.length && !els.residents.querySelector('.empty')) els.residents.appendChild(h('div', { class: 'empty', text: 'No residents yet.' }));
  }
  function makeResidentRow(r) {
    const row = h('div', { class: 'resident-row', dataset: { name: r.name } });
    row._avatar = avatar(r.name, r.color);
    row._name = h('div', { class: 'resident-name' }, h('span', { class: 'nm', text: r.name }));
    row._dot = h('span', { class: 'turn-dot', title: 'taking a turn' });
    row._chips = h('div', { class: 'resident-chips' });
    row._meta = h('div', { class: 'resident-meta' });
    row._persona = h('div', { class: 'resident-persona' });
    row._commits = h('div', { class: 'resident-commits' });
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
    const mid = h('div', {}, row._name, row._identity, row._chips, row._meta, row._persona, row._commits);
    const ctl = h('div', { class: 'resident-ctl' }, row._switch, row._wake, row._hibernate);
    row.append(row._avatar, mid, ctl);
    return row;
  }
  function updateResidentRow(row, r, active) {
    row.classList.toggle('off', r.enabled === false);
    row.classList.toggle('sealed', r.mood === 'sealed');
    row._avatar.style.background = safeCssColor(r.color);
    const isActive = active.has(r.name);
    if (isActive && !row._dot.isConnected) row._name.appendChild(row._dot);
    if (!isActive && row._dot.isConnected) row._dot.remove();
    const chipKey = `${r.agent}|${r.model}|${zoneOf(r)}|${r.rank}`;
    if (row._chipKey !== chipKey) {
      row._chipKey = chipKey;
      row._chips.textContent = '';
      row._chips.append(...[
        h('span', { class: `chip ${agentClass(r.agent)}`, text: String(r.agent || 'agent') }),
        h('span', { class: `chip model ${agentClass(r.agent)}`, text: String(r.model || '') }),
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
    row._persona.textContent = String(r.persona || '');
    const mine = commitmentsFor(r.name).filter((c) => c.status === 'active' || c.status === 'done');
    const ckey = mine.map((c) => `${c.id}:${c.status}:${c.updatedAt}:${c.nextAction}:${c.blockedOn}`).join('|');
    if (row._ckey !== ckey) {
      row._ckey = ckey;
      row._commits.textContent = '';
      for (const c of mine) row._commits.appendChild(commitmentEl(c, { compact: true }));
    }
    row._switch.setAttribute('aria-checked', r.enabled === false ? 'false' : 'true');
    row._wake.disabled = isActive || r.mood === 'sealed';
    row._identity.replaceChildren(residentIdentity(r, state));
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
  function renderWorkshop() {
    els.workshop.textContent = '';
    if (isleLocked()) {
      const t = h('div');
      renderSealedTablet(t);
      els.workshop.appendChild(t.firstChild);
      renderGods();
      return;
    }
    renderNeedsYou();
    renderGods();
    renderOfferings();
    renderTablet();
    renderHall();
    renderSettings();
  }
  const foldOpen = { offerings: false, tablet: false, hall: false, settings: false };
  const needOpen = new Set(), expanded = new Set();
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
  const waitingHero = (w) => zone === 'village' && w.status === 'waiting' && !w.stale;
  function needsJudgement(f) { return isOmenPending(f) || f.status === 'awaiting_confirmation'; }
  function renderNeedsYou() {
    const heroes = heroesInZone().filter(waitingHero);
    const omens = (state.findings || []).filter((f) => f && f.id && zoneOf(f) === zone && needsJudgement(f))
      .sort((a, b) => (+b.omenAt || +b.verdict?.ts || 0) - (+a.omenAt || +a.verdict?.ts || 0));
    const offerings = offeringsInZone().filter((o) => o.status !== 'closed').sort((a, b) => (+b.createdAt || 0) - (+a.createdAt || 0));
    const n = heroes.length + omens.length + offerings.length;
    if (!n) return;
    els.workshop.appendChild(h('div', { class: 'temple-section-title needs-title' }, h('span', { text: 'Needs you' }), h('span', { class: 'count count-need', text: String(n) })));
    const strip = h('div', { class: 'needs-you' });
    for (const w of heroes) {
      const counsel = (state.counsel || []).filter((c) => c && c.workerId === w.id && c.status === 'new').length;
      strip.appendChild(needItem(`w:${w.id}`, 'hero', [h('span', { class: 'pill pill-waiting', text: 'needs you' }), h('span', { class: 'need-name', text: String(w.title || w.id) }),
        h('span', { class: `chip ${agentClass(w.tool)}`, text: String(w.tool || 'tool') }), counsel ? h('span', { class: 'chip chip-other', text: `${counsel} counsel` }) : null,
        h('span', { class: 'need-sub', text: `${w.project || ''} · at ${siteList().find((s) => s.id === w.site)?.label || w.site || '?'}` })], () => workerRow(w)));
    }
    for (const f of omens) {
      const d = f.delivery?.state;
      strip.appendChild(needItem(`f:${f.id}`, 'omen', [h('span', { class: `pill pill-status status-${f.status}`, text: statusLabel(f.status) }), h('span', { class: `pill pill-sev sev-${sev(f)}`, text: sev(f) }),
        h('span', { class: 'need-name', text: String(f.claim || '') }), h('span', { class: 'worker-path', text: `${f.project || ''} · ${f.file || '?'}${f.line != null ? `:${f.line}` : ''}` }),
        d && d !== 'landed' ? h('span', { class: `pill pill-delivery delivery-${d === 'awaiting approval' ? 'awaiting' : d}`, text: d === 'awaiting approval' ? 'awaiting your approval' : d === 'failed' ? 'delivery failed' : d }) : null],
      () => h('div', { class: 'rune-tablet omens compact' }, omenEntry(f))));
    }
    for (const o of offerings) {
      const findings = findingsFor(o.id).length, who = Array.isArray(o.reviewers) ? o.reviewers.length : 0;
      strip.appendChild(needItem(`o:${o.id}`, 'offering', [h('span', { class: 'pill pill-running', text: 'open' }), h('span', { class: 'need-name', text: String(o.title || o.project || o.id) }),
        h('span', { class: `chip ${agentClass(o.tool)}`, text: String(o.tool || 'tool') }), h('span', { class: 'chip chip-other', text: String(o.kind || 'working changes') }),
        h('span', { class: 'need-sub', text: `${findings} finding${findings === 1 ? '' : 's'} · ${who ? `${who} reviewer${who === 1 ? '' : 's'}` : 'no reviewers yet'} · ${relTime(o.createdAt)}` })], () => offeringCard(o)));
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
    const order = { running: 0, error: 1, idle: 2, stopped: 3 };
    const sortW = (list) => list.sort((a, b) => (a.stale ? 9 : order[a.status] ?? 8) - (b.stale ? 9 : order[b.status] ?? 8));
    const rest = inZone.filter((w) => !waitingHero(w));   // waiting heroes sit in the Needs-you strip
    if (!inZone.length) els.workshop.appendChild(h('div', { class: 'empty', text: zone === 'isle' ? 'No sessions are quarantined on the isle.' : 'Every session is on the isle right now.' }));
    if (zone === 'village') {
      // group by site
      const sites = siteList();
      const bySite = new Map(sites.map((s) => [s.id, []]));
      for (const w of rest) { const k = bySite.has(w.site) ? w.site : sites[0]?.id; if (!bySite.has(k)) bySite.set(k, []); bySite.get(k).push(w); }
      for (const [siteId, list] of bySite) {
        const s = sites.find((x) => x.id === siteId) || { label: siteId || 'Unplaced', purpose: '' };
        const group = h('div', { class: 'host-group site-group' },
          h('div', { class: 'host-title' }, h('span', { class: 'site-glyph', text: siteGlyph(siteId) }), h('span', { text: s.label }), h('span', { class: 'site-purpose', text: s.purpose || '' })));
        if (!list.length) group.appendChild(h('div', { class: 'dim-note site-empty', text: 'nobody here' }));
        for (const [proj, plist] of groupByProject(sortW(list))) group.appendChild(projectGroup(proj, plist, false));
        els.workshop.appendChild(group);
      }
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
  // Steward and Watchtower controls, with the audit log: every control as before, folded under Settings & logs.
  function renderSettings() {
    if (zone !== 'village' || !(state.steward || state.auditSettings)) return;
    const fold = foldSection('settings', 'Settings & logs');
    if (state.steward) {
      // Not 'card': that class is the absolutely positioned map popover and floats over the page.
      const controls = h('div', { class: 'panel-settings' }, h('b', { text: 'Steward · reset windows' }));
      for (const [key, label] of [['enabled', 'Use spare allowance before reset'], ['festivalEnabled', 'Festival fallback']]) {
        const input = h('input', { type: 'checkbox', checked: state.steward[key] }); input.addEventListener('change', () => opts.api('/api/steward/settings', { [key]: input.checked })); controls.append(h('label', {}, input, label));
      }
      for (const [key, label] of [['idleHours', 'Human idle hours'], ['sevenDayHours', 'Weekly hours left'], ['sevenDaySpare', 'Weekly spare %'], ['fiveHourHours', 'Five-hour hours left'], ['fiveHourSpare', 'Five-hour spare %']]) {
        const input = h('input', { type: 'number', min: '0', max: key.endsWith('Spare') ? '90' : '168', step: '0.5', value: state.steward[key], 'aria-label': label }); input.addEventListener('change', () => opts.api('/api/steward/settings', { [key]: +input.value })); controls.append(h('label', {}, label, input));
      }
      fold.append(controls);
    }
    if (state.auditSettings) {
      const s = state.auditSettings, controls = h('div', { class: 'panel-settings' }, h('b', { text: 'Watchtower' }));
      const enabled = h('input', { type: 'checkbox', checked: s.enabled }); enabled.addEventListener('change', () => opts.api('/api/audit/settings', { enabled: enabled.checked }));
      controls.append(h('label', {}, enabled, ' Audit autonomous heroes'));
      for (const [key, label] of [['tier1', 'First reviewer'], ['tier2', 'Escalation reviewer']]) {
        // Reviewers are picked by role (shown as title · model); a resident with a shared role is picked by name.
        const select = h('select', { 'aria-label': label }), list = state.residents || [];
        for (const r of list) { const value = r.role && list.filter(x => x.role === r.role).length === 1 ? r.role : r.name; select.append(h('option', { value, text: `${r.title || r.role || r.name} · ${r.model || r.agent}`, selected: value === s[key] || r.name === s[key] })); } select.addEventListener('change', () => opts.api('/api/audit/settings', { [key]: select.value })); controls.append(h('label', {}, label, select));
      }
      const cap = h('input', { type: 'number', min: '0', max: '200', value: s.dailyCap, 'aria-label': 'Daily audit run cap' }); cap.addEventListener('change', () => opts.api('/api/audit/settings', { dailyCap: +cap.value })); controls.append(h('label', {}, 'Daily audit runs ', cap));
      // The last audit lines follow the settings so a glance explains why a hero was flagged.
      const log = (state.audits || []).slice(-20).reverse();
      if (log.length) { const lines = h('div', { class: 'audit-log' }); for (const a of log) lines.append(h('p', { text: `${a.severity} · ${a.rule} · ${a.status}: ${a.excerpt}` })); controls.append(clamped('audit-log', lines, log.map((a) => a.excerpt).join('\n'), 5)); }
      fold.append(controls);
    }
    els.workshop.append(fold);
  }
  function siteList() {
    const list = (state.sites || []).filter((s) => s && s.id);
    return list.length ? list : [{ id: 'temple', label: 'The Temple', purpose: '' }, { id: 'library', label: 'The Great Library', purpose: '' }, { id: 'forge', label: 'The Forge', purpose: '' }, { id: 'quarry', label: 'The Quarry', purpose: '' }];
  }
  function siteGlyph(id) { return { temple: '⛩', library: '📜', forge: '🔥', quarry: '⛏' }[id] || '◦'; }
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
    const milestone = h('button', { class: 'btn btn-ghost btn-xs', type: 'button', text: 'Share a milestone 🌸', title: "Grow this project's branch on the shared tree" });
    milestone.disabled = anySealed;
    milestone.addEventListener('click', () => opts.onMilestone?.(list[0].project, list[0].host));
    const pg = h('div', { class: 'project-group' },
      h('div', { class: 'project-title' }, h('span', { text: proj }), h('span', { class: 'project-actions' }, milestone, hasIsle() ? h('label', { class: 'q-label' }, 'quarantine ', qSwitch) : null)));
    for (const w of list) pg.appendChild(workerRow(w));
    return pg;
  }
  function workerRow(w) {
    const st = String(w.status || 'idle');
    const stale = !!w.stale;
    const offer = h('button', { class: 'btn btn-ghost btn-xs', type: 'button', text: 'Lay an offering…', title: "Snapshot this session's git change as an offering for review" });
    offer.disabled = !!w.sealed;
    offer.addEventListener('click', (e) => { e.stopPropagation(); opts.onOffer?.(w); });
    const row = h('div', { class: `worker-row ${st === 'waiting' && !stale ? 'waiting' : ''} ${stale ? 'stale' : ''} ${w.sealed ? 'sealed' : ''}` },
      h('div', { class: `worker-title ${w.sealed ? 'runic' : ''}` }, w.sealed ? h('span', { class: 'lock', text: '🔒 ' }) : null, String(w.title || w.id)),
      stale
        ? h('span', { class: 'pill pill-stale', text: `last seen ${relTime(w.updatedAt) || 'a while ago'}` })
        : h('span', { class: `pill pill-${st}`, text: st === 'waiting' ? 'needs you' : st }),
      h('div', { class: 'worker-sub' },
        h('span', { class: `chip ${agentClass(w.tool)}`, text: String(w.tool || 'tool') }),
        h('span', { class: w.sealed ? 'runic' : '', text: `${w.project || ''} @ ${w.host || 'local'}${w.os ? ` · ${osLabel(w.os)}` : ''}` }),
        w.sealed ? null : h('span', { class: 'worker-path', text: String(w.path || '') }),
        h('a', { href: AGENT_DECK_URL, target: '_blank', rel: 'noopener', text: 'Open in Agent Deck ↗' }),
        opts.canOpenTerminal?.(w) ? h('button', { class: 'btn btn-ghost btn-xs', type: 'button', text: 'Terminal ▸', onClick: () => opts.onTerminal?.(w) }) : null,
        offer,
        state.auditSettings && zoneOf(w) === 'village' && !w.private && !w.sealed ? h('button', { class: 'btn btn-ghost btn-xs', text: state.auditSettings.optOut.includes(w.id) ? 'Audit off' : 'Audit on', onClick: () => opts.api('/api/audit/settings', { heroId: w.id, optOut: !state.auditSettings.optOut.includes(w.id) }) }) : null,
        opts.endLabourButton?.(w),
        h('button', { class: 'btn btn-ghost btn-xs', type: 'button', text: 'Tell the tale', disabled: !!w.sealed, onClick: () => opts.onTellTale?.(w.id) }),
        zoneOf(w) !== 'isle' && !w.sealed ? h('span', { text: `at ${siteList().find(s => s.id === w.site)?.label || w.site} · ${w.siteReason || ''}` }) : null,
        zoneOf(w) !== 'isle' && !w.sealed ? sitePicker(w) : null,
      ),
    );
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
  // Closed offerings, folded: open ones sit in the Needs-you strip.
  function renderOfferings() {
    const all = offeringsInZone(), list = all.filter((o) => o.status === 'closed').sort((a, b) => (+b.createdAt || 0) - (+a.createdAt || 0));
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
      h('span', { class: `pill ${open ? 'pill-running' : 'pill-stopped'}`, text: open ? 'open' : 'closed' })));
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
  // The resolved Tablet, folded: omens still awaiting judgement or delivery sit in the Needs-you strip.
  function renderTablet() {
    const list = (state.findings || []).filter((f) => f && f.id && zoneOf(f) === zone && TABLET_STATUSES.includes(f.status) && !needsJudgement(f))
      .sort((a, b) => (+b.omenAt || +b.verdict?.ts || 0) - (+a.omenAt || +a.verdict?.ts || 0));
    const mode = state.decreeMode === 'approve' || state.world?.decreeMode === 'approve' ? 'approve' : 'auto';
    const modeSw = h('span', { class: 'decree-mode', title: 'auto: the High Priest\u2019s decrees are delivered to the session at once · approve: you confirm each decree first' },
      h('span', { class: 'decree-mode-label', text: 'decrees' }),
      h('button', { class: `zone-opt ${mode === 'auto' ? '' : ''}`, type: 'button', text: 'auto', 'aria-selected': mode === 'auto' ? 'true' : 'false', onClick: () => opts.onDecreeMode?.('auto') }),
      h('button', { class: 'zone-opt', type: 'button', text: 'approve', 'aria-selected': mode === 'approve' ? 'true' : 'false', onClick: () => opts.onDecreeMode?.('approve') }));
    const fold = foldSection('tablet', 'The Tablet of Omens', list.length);
    fold.appendChild(h('div', { class: 'tablet-mode' }, modeSw));
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
    const acts = h('div', { class: 'card-actions omen-actions' });
    if (status === 'decreed' || status === 'awaiting_confirmation') {
      const b = h('button', { class: 'btn btn-primary btn-xs', type: 'button', text: 'Confirm fixed 🌸', title: 'Confirms the decree was carried out; this grows the shared tree' });
      b.addEventListener('click', () => opts.onFindingStatus?.(f.id, 'fixed'));
      acts.appendChild(b);
    } else if (status !== 'fixed') {
      const b = h('button', { class: 'btn btn-primary btn-xs', type: 'button', text: 'Decree' });
      b.addEventListener('click', () => opts.onFindingStatus?.(f.id, 'decreed'));
      acts.appendChild(b);
    }
    if (status !== 'rejected' && status !== 'fixed') {
      const b = h('button', { class: 'btn btn-ghost btn-xs', type: 'button', text: 'Set aside' });
      b.addEventListener('click', () => opts.onFindingStatus?.(f.id, 'rejected'));
      acts.appendChild(b);
    }
    e.appendChild(acts);
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
    return `resets in ${m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`}`;
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
    root.appendChild(h('div', { class: 'temple-section-title' }, h('span', { text: zone === 'isle' ? 'Oil burned on the isle' : 'Oil burned' })));
    const stats = h('div', { class: 'lamp-stats' },
      statTile('today', fmtTok(today.tokens), `${+today.turns || 0} turn${(+today.turns || 0) === 1 ? '' : 's'}`),
      statTile('all time', fmtTok(all.tokens), `${+all.turns || 0} turns · ${+all.measuredTurns || 0} measured${fmtCost(all.cost) ? ` · ${fmtCost(all.cost)}` : ''}`),
      statTile('per artifact', zoneUsage?.perArtifact == null ? 'too early' : fmtTok(zoneUsage.perArtifact), 'tokens per exhibit or building'),
      statTile('per confirmed fix', zoneUsage?.perConfirmedFix == null ? 'too early' : fmtTok(zoneUsage.perConfirmedFix), 'tokens per decree confirmed fixed'));
    root.appendChild(stats);
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
    for (const w of windows) card.appendChild(h('div', { class: 'amphora-win', text: `${w.label || w.kind || 'window'}: ${Math.round(+w.used_percentage)}% used${w.stale || stale ? ' · stale' : ''}${untilText(w.resets_at) ? ` · ${untilText(w.resets_at)}` : ''}` }));
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
    const posts = state.posts || [], workers = state.workers || [];
    document.getElementById('count-board').textContent = String(posts.length);
    document.getElementById('count-exhibits').textContent = String((state.exhibits || []).length);
    document.getElementById('count-residents').textContent = String((state.residents || []).length);
    document.getElementById('count-workshop').textContent = String(workers.length);
    els.badgeWait.hidden = !workers.some((w) => w && w.status === 'waiting' && !w.stale);
    const omens = omenCount();
    const ob = document.getElementById('badge-omen');
    if (ob) { ob.hidden = !omens; ob.textContent = String(omens); }
    opts.onOmenCount?.(omens);
    const cc = counselCount();
    const cb = document.getElementById('badge-counsel');
    if (cb) { cb.hidden = !cc; cb.textContent = String(cc); }
    opts.onCounselCount?.(cc);
    const lc = document.getElementById('count-lamps');
    if (lc) lc.textContent = state.usage?.village?.today ? fmtTok(state.usage.village.today.tokens) : '—';
  }
  function refreshTimes() {
    for (const t of els.posts.querySelectorAll('.post-time')) t.textContent = relTime(+t.dataset.ts);
  }

  function openOrder(id) { selectTab('orders'); const card = [...document.querySelectorAll('.order-card')].find(c => JSON.parse(c.dataset.orderIds || '[]').includes(id)); if (card) { card.querySelector('details').open = true; card.scrollIntoView({ block: 'nearest' }); } }
  return { openOrder, update, selectTab, setChannel, setZone, refreshTimes, get activeTab() { return activeTab; }, get channel() { return channel; }, get zone() { return zone; } };
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
  const url = `http://127.0.0.1:8420/s/${encodeURIComponent(worker.id.slice(6))}`;
  const status = String(worker.status || 'idle');
  root.textContent = '';
  const body = h('div', { class: 'terminal-body' });
  const hint = h('div', { class: 'terminal-hint dim-note', text: `Live terminal — what you type goes to the hero. To select text to copy, hold ${/Mac/.test(navigator.platform) ? 'Option' : 'Shift'} while dragging.` });
  const note = h('div', { class: 'terminal-status dim-note', hidden: true });
  root.append(h('div', { class: 'terminal-header' },
    h('h2', { text: `Terminal — ${worker.title || worker.id}` }),
    h('span', { class: `pill pill-${worker.stale ? 'stale' : status}`, text: worker.stale ? 'last seen a while ago' : status === 'waiting' ? 'waiting for you' : status }),
    h('a', { class: 'btn btn-xs', href: url, target: '_blank', rel: 'noopener', text: 'Open in Agent Deck ↗' }),
    h('button', { class: 'btn btn-xs', type: 'button', text: 'Detach', onClick: onClose }),
    h('button', { class: 'btn btn-xs', type: 'button', text: 'End session', onClick: async () => { if (!mock) await fetch(`/api/term/${encodeURIComponent(worker.id)}/close`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Amygdala-Token': token }, body: '{}' }); onClose(); } })), hint, note, body);
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
    error: error => { if (!disposed && !ended) hint.textContent = error.message; },
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
  const source = new EventSource(`${base}/stream?token=${encodeURIComponent(token)}`);
  source.onopen = () => {
    transport.connect();
    hint.textContent = 'Live terminal — what you type goes to the hero.';
    resize();
  };
  source.addEventListener('o', event => {
    if (!disposed && !ended) term.write(Uint8Array.from(atob(event.data), ch => ch.charCodeAt(0)));
  });
  source.addEventListener('exit', () => {
    ended = true; source.close();
    transport.dispose();
    hint.textContent = 'session ended';
    term.options.disableStdin = true;
    term.write('\r\n\x1b[90msession ended\x1b[0m\r\n');
  });
  source.onerror = () => { if (!disposed && !ended) hint.textContent = 'Terminal connection lost — reconnecting…'; };
  const dataListener = term.onData(data => { if (!disposed && !ended) transport.data(data); });
  frame = requestAnimationFrame(() => { resize(); term.focus(); });
  return () => {
    disposed = true;
    transport.dispose(); images.dispose(); clearTimeout(noteTimer); cancelAnimationFrame(frame);
    source.close(); controller.abort(); observer.disconnect();
    dataListener.dispose(); term.dispose(); root.textContent = '';
  };
}
