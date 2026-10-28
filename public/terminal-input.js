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
