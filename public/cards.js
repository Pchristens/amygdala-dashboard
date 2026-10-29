import { h, avatar, agentClass, capitalize, relTime, safeCssColor } from './util.js';
import { residentIdentity } from './panel.js';
import { zoneOf } from './svg-util.js';

let cardId = 0;
const line = (text, max = 100) => { const chars = Array.from(String(text || '').replace(/\s+/g, ' ').trim()); return chars.length > max ? chars.slice(0, max - 1).join('') + '…' : chars.join(''); };
const text = (node, value) => { if (node.textContent !== value) node.textContent = value; };

// Mount once, then update the keyed fields. Actions read the latest resident rather than their creation snapshot.
export function residentCard(resident, snapshot, actions = {}, { embedded = false } = {}) {
  let r = resident, state = snapshot || {}, currentActions = actions, opener = null, opened = false;
  const name = h('div', { class: 'card-name', id: `resident-card-name-${++cardId}` }), portrait = avatar(r.name, r.color);
  const identity = h('div'), model = h('span', { class: 'chip model' });
  const status = h('div', { class: 'card-row resident-card-status', 'data-field': 'status' });
  const doing = h('div', { class: 'card-row', 'data-field': 'doing' });
  const objective = h('b'), next = h('div'), more = h('span', { class: 'dim-note' });
  const commitment = h('div', { class: 'card-row resident-card-work', 'data-field': 'commitment' }, objective, next, more);
  const post = h('div', { class: 'card-row resident-card-post', 'data-field': 'last-post' });
  const weekly = h('div', { class: 'card-row dim-note', 'data-field': 'weekly' });
  const root = h('div', { class: 'resident-card', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': name.getAttribute('id'), tabindex: '-1' },
    h('div', { class: 'card-head' }, portrait, h('div', {}, name, identity, h('div', { class: 'card-sub' }, model))), status, doing, commitment, post, weekly);
  const action = (label, fn) => {
    const button = h('button', { class: 'btn btn-xs', type: 'button', text: label });
    button.addEventListener('click', () => { if (!button.disabled) fn(); });
    return button;
  };
  const navigate = callback => { const name = r.name; root.close({ restoreFocus: false }); callback?.(name); };
  const details = action('Details', () => navigate(currentActions.onDetails));
  const wake = action('Wake now', () => currentActions.onWake?.(r.name));
  const order = action('Order…', () => navigate(currentActions.onOrder));
  const follow = action('Follow', () => { currentActions.onFollow?.(r.name, !currentActions.isFollowing?.(r.name)); updateFollow(); });
  const close = h('button', { class: 'btn btn-ghost btn-xs card-close', type: 'button', text: '✕', 'aria-label': 'Close resident card' });
  close.addEventListener('click', event => { event.stopPropagation(); root.close(); });
  const actionRow = h('div', { class: 'card-actions' }, details, wake, order, follow);
  root.append(actionRow); if (!embedded) root.append(close);
  function updateFollow() {
    const following = !!currentActions.isFollowing?.(r.name);
    text(follow, following ? 'Unfollow' : 'Follow'); follow.setAttribute('aria-pressed', String(following));
  }
  root.open = (returnFocus = document.activeElement) => {
    if (!opened) opener = root.contains(returnFocus) ? null : returnFocus;
    opened = true; root.hidden = false; root.focus();
    return root;
  };
  root.close = ({ restoreFocus = true } = {}) => {
    if (!opened) return;
    // Mark closed before calling out: the page's generic close handler may call us back.
    opened = false; root.hidden = true;
    const target = opener; opener = null;
    currentActions.onClose?.();
    if (restoreFocus && target?.isConnected) target.focus();
  };
  root.update = (resident, snapshot, actions = currentActions) => {
    r = resident; state = snapshot || {}; currentActions = actions;
    const sealed = r.mood === 'sealed' || !!r.sealed || (zoneOf(r) === 'isle' && state.seal?.enabled && state.seal.locked);
    const active = (state.world?.activeTurns || [state.world?.activeTurn].filter(Boolean)).some(t => t?.resident === r.name);
    text(name, String(r.name || 'Resident')); text(portrait, String(r.name || '?').slice(0, 1).toUpperCase()); portrait.style.background = safeCssColor(r.color);
    // Keep the shared title/starwatch identity; former names belong in the expanded Residents detail.
    const identityKey = JSON.stringify([r.title, r.role, r.role === 'starwatcher' ? state.starwatch : null]);
    if (identity._key !== identityKey) { identity._key = identityKey; identity.replaceChildren(residentIdentity({ title: r.title, role: r.role }, state)); }
    model.className = `chip model ${agentClass(r.agent)}`;
    text(model, `${r.model || 'model unknown'}${r.onBackup ? ' · ⇄ backup' : ''}`);
    model.title = r.onBackup ? `Backup for ${r.primaryModel || 'primary model'}` : '';
    const parallel = Array.isArray(r.parallel) ? r.parallel.length : 0;
    text(status, active ? `in a turn now${parallel ? ` · +${parallel} orders` : ''}`
      : r.hibernating ? `hibernating${r.hibernateReason ? ` · ${r.hibernateReason}` : ''}`
        : r.enabled === false ? 'not in turns'
          : r.lastTurnAt ? `idle · last turn ${relTime(r.lastTurnAt)}` : 'idle · no turns yet');
    text(doing, sealed ? 'beyond the seal' : `${capitalize(r.mood || '—')} · ${r.doing || 'idle'}`);
    const mine = sealed ? [] : (state.commitments || []).filter(c => c && c.ownerId === r.name && c.status === 'active' && zoneOf(c) === zoneOf(r));
    commitment.hidden = !mine.length;
    text(objective, mine[0] ? String(mine[0].objective || '(untitled project)') : '');
    text(next, mine[0]?.nextAction ? `next: ${mine[0].nextAction}` : ''); next.hidden = !mine[0]?.nextAction;
    text(more, mine.length > 1 ? `+${mine.length - 1} more` : ''); more.hidden = mine.length < 2;
    const lastPost = sealed ? null : [...(state.posts || [])].reverse().find(p => p && p.author === r.name && zoneOf(p) === zoneOf(r));
    post.hidden = !lastPost;
    text(post, lastPost ? `Last post: ${line(lastPost.text)}${lastPost.ts ? ` · ${relTime(lastPost.ts)}` : ''}` : '');
    const usage = r.zone === 'village' && !sealed ? state.usage?.village?.weeklyPerTurn?.[r.name] : null;
    const measured = usage?.perTurnPct != null && Number.isFinite(+usage.perTurnPct) && +usage.samples >= 3;
    weekly.hidden = !measured;
    text(weekly, measured ? `${+usage.perTurnPct}% weekly allowance per turn` : '');
    details.hidden = !currentActions.onDetails; wake.hidden = !currentActions.onWake; order.hidden = !currentActions.onOrder; follow.hidden = !currentActions.onFollow;
    actionRow.hidden = [details, wake, order, follow].every(button => button.hidden);
    wake.disabled = active || sealed;
    updateFollow();
    return root;
  };
  return root.update(r, state);
}
