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
