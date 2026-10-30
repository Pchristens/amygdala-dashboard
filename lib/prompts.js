// Pane text stays inside the scan; callers admit only confirmed public village heroes.
import { execFile } from './bin.js';
import { scanAllowed } from './hero-apprentices.js';
const patterns = {
  // Claude Code's question or numbered permission menu.
  claude: /do you want to (?:proceed|make this edit|create|allow)\b|(?:^|\n)\s*[❯>]?\s*1[.)]\s*Yes\b|No, and tell/i,
  // Codex command approval questions and selectable approval menus.
  codex: /would you like to run the following command\b|allow command\s*\?|(?:^|\n)\s*[❯>]?\s*(?:\d+[.)]\s*)?approve\b|(?:approve|allow|run|execute|proceed|permission|confirm)[^\n]*(?:\(y\/n\)|\[y\/n\])/i,
  // Gemini and Antigravity use execution/edit confirmation wording.
  gemini: /allow execution\b|apply this change\s*\?|waiting for user confirmation\b/i,
  antigravity: /allow execution\b|apply this change\s*\?|waiting for user confirmation\b/i,
  // Grok's short selectable Allow/Approve actions.
  grok: /(?:^|\n)\s*[❯>]?\s*(?:\d+[.)]\s*)?(?:allow|approve)(?:\s+(?:execution|command|once|always|this|tool)\b[^\n]*)?\s*[?:]?\s*$/im,
};
export function askingPermission(tool, screen) {
  const tail = String(screen || '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').split(/\r?\n/).filter(s => s.trim()).slice(-25).join('\n');
  return !!patterns[tool === 'agy' ? 'antigravity' : tool]?.test(tail);
}
export const permissionItems = (heroes, confirmed) => heroes.filter(({ w, tmux }) => scanAllowed(w, confirmed) && w.host === 'local' && w.status === 'waiting' && !w.archived && !w.stale && typeof tmux === 'string' && /^[^\0\n:.-][^\0\n:.]{0,199}$/.test(tmux)).map(({ w, tmux }) => ({ id: w.id, tool: w.tool, tmux }));
export const capturePermission = tmux => new Promise((resolve, reject) => execFile('tmux', ['capture-pane', '-p', '-t', tmux, '-S', '-40'], { timeout: 5000, maxBuffer: 1 << 20 }, (err, out) => err ? reject(err) : resolve(out)));
export async function permissionScan(items, capture = capturePermission) {
  const asking = new Set();
  for (const { id, tool, tmux } of items) { try { if (askingPermission(tool, await capture(tmux))) asking.add(id); } catch {} }
  return asking;
}
