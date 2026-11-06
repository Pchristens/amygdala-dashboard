// One request in flight; retain bytes until the server explicitly accepts them.
export function terminalInput({ send, error, schedule = setTimeout, cancel = clearTimeout }) {
  let pending = new Uint8Array(), dimensions, ready = false, stopped = false, failed = false, busy = false, timer;
  const wake = (delay = 0) => { if (!stopped && !timer) timer = schedule(() => { timer = null; drain(); }, delay); };
  async function drain() {
    if (!ready || stopped || busy) return;
    const bytes = pending.slice(0, 16384), size = dimensions;
    if (!bytes.length && !size) return;
    busy = true;
    try {
      const response = await send(bytes.length ? 'input' : 'resize', bytes.length ? { d: btoa(String.fromCharCode(...bytes)) } : size);
      if (response.status === 429) { wake(25); return; }
      if (!response.ok) throw new Error((await response.json()).error || 'Terminal request failed.');
      if (bytes.length) pending = pending.slice(bytes.length);
      else if (dimensions === size) dimensions = null;
    } catch (e) { ready = false; failed = true; error(e); }
    finally { busy = false; if (ready && !timer) wake(); }
  }
  return {
    data(data) { const bytes = new TextEncoder().encode(data), next = new Uint8Array(pending.length + bytes.length); next.set(pending); next.set(bytes, pending.length); pending = next; wake(10); },
    resize(cols, rows) { dimensions = { cols, rows }; wake(); },
    connect() { if (!failed) { ready = true; wake(); } },
    dispose() { stopped = true; cancel(timer); pending = new Uint8Array(); },
  };
}
export function terminalKeys(term, event, copy = () => document.execCommand('copy')) {
  const key = event.key.toLowerCase(), plain = !event.altKey;
  if (plain && ((key === 'v' && (event.ctrlKey || event.metaKey)) || (key === 'insert' && event.shiftKey))) return false;
  // Leave selection copying to the browser's native copy event, including its fallback.
  if (plain && key === 'c' && (event.ctrlKey || event.metaKey) && term.hasSelection()) {
    if (event.shiftKey && event.type === 'keydown') { event.preventDefault(); copy(); }
    return false;
  }
  return true;
}
// Images: the hero's CLI reads its own machine's clipboard, so a pasted or dropped image is uploaded there and its path pasted.
export const PASTE_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
export const PASTE_IMAGE_MAX = 8 << 20;
export function pastedImages(data) {
  if (!data) return { images: [], other: 0 };
  // Text alongside an image (a copied web page, a spreadsheet cell) keeps the normal text paste.
  if ([...(data.types || [])].includes('text/plain') && data.getData?.('text/plain')) return { images: [], other: 0 };
  let files = [...(data.files || [])];
  if (!files.length) files = [...(data.items || [])].filter(i => i.kind === 'file').map(i => i.getAsFile()).filter(Boolean);
  const images = files.filter(f => PASTE_IMAGE_TYPES.includes(f.type));
  return { images, other: files.length - images.length };
}
export async function fileBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer()); let s = '';
  for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(s);
}
export function terminalImages({ term, upload, status, read = fileBase64 }) {
  let queue = Promise.resolve(), stopped = false;
  async function send(file) {
    if (stopped) return;
    if (file.size > PASTE_IMAGE_MAX) { status('Image too large (8 MiB at most).', true); return; }
    status('Uploading image…');
    try {
      const response = await upload({ type: file.type, d: await read(file) }), body = await response.json().catch(() => ({}));
      if (!response.ok || !body.ok || typeof body.path !== 'string') throw new Error(body.error || 'Image upload failed.');
      if (stopped) return;
      // A bracketed paste of the path: Claude Code attaches an image file when its path is pasted.
      term.paste(/\s/.test(body.path) ? `"${body.path}"` : body.path);
      status('');
    } catch (e) { if (!stopped) status(e.name === 'AbortError' ? '' : e.message || 'Image upload failed.', true); }
  }
  const handle = event => {
    const { images, other } = pastedImages(event.clipboardData || event.dataTransfer);
    if (!images.length && !(other && event.type === 'drop')) return false;
    event.preventDefault(); event.stopImmediatePropagation?.();
    if (!images.length) { status('Only PNG, JPEG, GIF or WebP images can be pasted.', true); return true; }
    for (const file of images) queue = queue.then(() => send(file));
    return true;
  };
  return {
    paste: handle, drop: handle,
    dragover: event => { if ([...(event.dataTransfer?.types || [])].includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } },
    dispose() { stopped = true; },
  };
}
// Touch scrolling: the hero's history lives in tmux (the page only sees redraws), and xterm turns no swipe into a wheel.
// A swipe sends the same SGR wheel reports a desktop wheel does, so tmux scrolls (entering copy mode, leaving it again at
// the bottom). Typing first scrolls back down, so keys reach the hero rather than copy mode.
export const SWIPE_STEP = 40; // px per wheel report; tmux scrolls five lines for each
// A fast swipe goes further (up to 4x), and a flick keeps going after the finger lifts, slowing like a native scroll:
// each report waits on the phone's round trip, so one-for-one tracking alone made long histories a crawl.
const FLING_MIN = 0.4, FLING_STOP = 0.05, FRICTION = 0.94, FRAME = 16, STILL_MS = 80;
export const swipeGain = v => 1 + Math.min(3, Math.max(0, Math.abs(v) - 0.3) * 2.5);
export function terminalSwipe({ send, size, now = () => performance.now(), schedule = setTimeout, cancel = clearTimeout }) {
  let y = null, t = 0, v = 0, moved = 0, swiping = false, up = 0, fling = null;
  const wheel = (dir, n) => { const { cols, rows } = size(), at = `${Math.max(1, cols >> 1)};${Math.max(1, rows >> 1)}`; send(`\x1b[<${dir ? 64 : 65};${at}M`.repeat(n)); };
  // Finger travel (px, down positive) into wheel reports; false once scrolling down has reached the bottom.
  const travel = dy => {
    moved += dy * swipeGain(v);
    const n = Math.trunc(moved / SWIPE_STEP); if (!n) return true;
    moved -= n * SWIPE_STEP;
    if (n > 0) { up += n; wheel(true, n); return true; }
    const d = Math.min(-n, up); up -= d; if (d) wheel(false, d); return up > 0;
  };
  const stop = () => { if (fling) { cancel(fling); fling = null; } };
  const glide = () => { fling = null; v *= FRICTION; if (Math.abs(v) < FLING_STOP || !travel(v * FRAME)) { moved = 0; return; } fling = schedule(glide, FRAME); };
  return {
    start(event) { stop(); if (event.touches?.length !== 1) { y = null; return; } y = event.touches[0].clientY; t = now(); v = 0; moved = 0; swiping = false; },
    move(event) {
      if (y == null || event.touches?.length !== 1) return;
      const cur = event.touches[0].clientY, at = now(), dy = cur - y, dt = Math.max(1, at - t);
      y = cur; t = at; v = 0.7 * (dy / dt) + 0.3 * v;
      if (!swiping) { moved += dy; if (Math.abs(moved) < 8) return; swiping = true; const first = moved; moved = 0; event.preventDefault(); event.stopPropagation(); travel(first); return; }
      event.preventDefault(); event.stopPropagation(); travel(dy);
    },
    end(event) {
      if (swiping) { event.preventDefault(); event.stopPropagation(); if (now() - t < STILL_MS && Math.abs(v) >= FLING_MIN) fling = schedule(glide, FRAME); }
      y = null; swiping = false;
    },
    // A cancelled touch (the browser took it over) ends the swipe without a glide (fi43987).
    cancel() { y = null; swiping = false; },
    // Before keys: stop any fling and go back to the bottom (a wheel-down past it is dropped by tmux), two spare steps.
    typed() { stop(); if (up) { wheel(false, up + 2); up = 0; } },
    dispose: stop,
    get scrolled() { return up; },
  };
}
