// Pure, in-place lifecycle: arrival gates the final fade; no allocations on the tick.
const PROPS = new Map([['library', 'scroll'], ['forge', 'hammer'], ['quarry', 'basket'], ['temple', 'amphora']]);
export const apprenticeProp = site => PROPS.get(site) || 'scroll';
export function apprenticeCap(parallel) { const orders = [...new Map((Array.isArray(parallel) ? parallel : []).filter(o => o && typeof o.orderId === 'string' && o.orderId).map(o => [o.orderId, o])).values()]; return { orders: orders.slice(0, 3), badge: Math.max(0, orders.length - 3) }; }
export function apprenticeFade(s, dt, present, arrived) {
  if (present) { s.phase = s.alpha < 1 ? 'in' : 'work'; s.alpha = Math.min(1, s.alpha + dt / 700); }
  else if (!arrived) s.phase = 'return';
  else { s.phase = 'out'; s.alpha = Math.max(0, s.alpha - dt / 700); if (!s.alpha) s.phase = 'done'; }
  return s.phase;
}
export function apprenticesAllowed(state, params) { return params.get('public') !== '1' && !state.visitor && (Array.isArray(state.world?.activeTurns) || Array.isArray(state.orders) || params.get('mock') === '1'); }

export const heroApprenticeProp = type => ({ explore: 'scroll', plan: 'amphora', 'general-purpose': 'hammer' })[String(type).toLowerCase()] || 'basket';
