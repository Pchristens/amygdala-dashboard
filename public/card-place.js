export function placeCard({ above, below, size, bounds, obstacles = [], gap = 14, margin = 6 }) {
  const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const w = number(size?.w, 0) || 260, h = number(size?.h, 0) || 200;
  const rect = { left: number(bounds?.left), top: number(bounds?.top), right: number(bounds?.right), bottom: number(bounds?.bottom) };
  for (const obstacle of obstacles) {
    const o = { left: number(obstacle?.left), top: number(obstacle?.top), right: number(obstacle?.right), bottom: number(obstacle?.bottom) };
    if (o.left <= rect.left + 1 && o.right > rect.left) rect.left = Math.max(rect.left, o.right);
    else if (o.right >= rect.right - 1 && o.left < rect.right) rect.right = Math.min(rect.right, o.left);
    else if (o.top <= rect.top + 1 && o.bottom > rect.top) rect.top = Math.max(rect.top, o.bottom);
    else if (o.bottom >= rect.bottom - 1 && o.top < rect.bottom) rect.bottom = Math.min(rect.bottom, o.top);
  }
  const usable = { left: rect.left + margin, top: rect.top + margin, right: rect.right - margin, bottom: rect.bottom - margin };
  const a = { x: number(above?.x), y: number(above?.y) }, b = { x: number(below?.x, a.x), y: number(below?.y, a.y) };
  const inBounds = p => p.x >= usable.left && p.x <= usable.right && p.y >= usable.top && p.y <= usable.bottom;
  const x = p => {
    const lo = usable.left + w / 2, hi = usable.right - w / 2;
    return lo <= hi ? Math.max(lo, Math.min(hi, p.x)) : (usable.left + usable.right) / 2;
  };
  const fitsAbove = p => p.y - gap - h >= usable.top;
  const fitsBelow = p => p.y + gap + h <= usable.bottom;
  const docked = !inBounds(a);
  let isBelow = false, anchor = a;
  if (!docked && !fitsAbove(a) && fitsBelow(b)) { isBelow = true; anchor = b; }
  else if (!docked && !fitsAbove(a) && !fitsBelow(b)) {
    isBelow = usable.bottom - (b.y + gap + h) > (a.y - gap - h) - usable.top;
    anchor = isBelow ? b : a;
  }
  let top = anchor.y;
  if (docked) {
    if (a.y < usable.top || a.y > usable.bottom) isBelow = false;
    top = isBelow ? Math.max(usable.top, Math.min(usable.bottom - gap - h, anchor.y)) : Math.max(usable.top + gap + h, Math.min(usable.bottom, anchor.y));
  } else if (!fitsAbove(a) && !fitsBelow(b)) {
    top = isBelow ? Math.max(usable.top, Math.min(usable.bottom - gap - h, anchor.y)) : Math.max(usable.top + gap + h, Math.min(usable.bottom, anchor.y));
  }
  return { left: x(anchor), top, below: isBelow, docked };
}
