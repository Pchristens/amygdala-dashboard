// Transcript content and paths stay in memory; callers must gate access by village privacy rules.
import fs from 'node:fs';
const cache = new Map();
export const isleTagged = w => w.group === 'isle' || /^(?:\/Users\/[^/]+|\/home\/[^/]+|\/root|\/mnt\/[a-z]\/Users\/[^/]+|[A-Za-z]:\\Users\\[^\\]+)[\\/]Isle(?:[\\/]|$)/i.test(w.path || '');
export function forgetSignals() { cache.clear(); }
const sites = ['library', 'forge', 'quarry', 'temple'];
const patterns = {
  library: /research|investigat|explor|plan|design|analy|why|explain|study|spike|think|compare|docs?\b|report|write up|\?/i,
  forge: /\b(add|implement|build|fix|make|support)\b/i,
  quarry: /refactor|migrat|clean|upgrade|rename|bump|port\b|dedupe|remove|delete|reorgan|lint|format|consolidate|split|extract|move|deprecat|vendor|monorepo/i,
  temple: /review|audit|PR\s*#|pull request|code-review/i,
};
export function classifyHero({ title = '', group = '', project = '', taskText = '', activity = {} } = {}) {
  const tag = `${group} ${title}`.match(/\[(library|forge|quarry|temple)\]|#(library|forge|quarry|temple)\b/i);
  if (tag) return { site: (tag[1] || tag[2]).toLowerCase(), confidence: 1, reason: 'explicit site tag' };
  const a = new Proxy(activity, { get: (o, k) => Number(o[k]) || 0 });
  const task = Object.fromEntries(sites.map(s => [s, patterns[s].test(String(taskText)) ? 1 : 0]));
  const hints = Object.fromEntries(sites.map(s => [s, patterns[s].test(`${title} ${group} ${project}`) ? 1 : 0]));
  const act = {
    library: a.sourceEdits ? 0 : Math.min(1, (a.reads + a.searches + a.web + a.docEdits * 2) / 3),
    forge: Math.min(1, (a.sourceEdits * 2 + a.tests) / 3),
    quarry: a.distinctFiles >= 8 || a.deletes || a.renames || a.formatters || a.manifestEdits >= 2 ? 1 : a.manifestEdits ? 0.5 : 0,
    temple: a.prReview ? 1 : !a.edits ? Math.min(1, a.gitDiff / 3) : 0,
  };
  // Strong bulk-work and review evidence distinguishes them from ordinary editing/reading.
  if (act.quarry === 1) act.forge *= 0.3;
  if (act.temple === 1) act.library *= 0.3;
  const score = s => task[s] * 0.45 + act[s] * 0.45 + hints[s] * 0.1;
  const ranked = [...sites].sort((x, y) => score(y) - score(x));
  const site = score(ranked[0]) ? ranked[0] : 'forge';
  let reason = 'no task signals';
  if (act[site]) reason = site === 'quarry' ? `${a.distinctFiles} files moved or edited` : site === 'temple' ? (a.prReview ? 'reviewing a pull request' : 'comparing changes, no edits') : site === 'forge' ? (a.sourceEdits ? `editing ${a.sourceEdits} source files` : 'running tests or builds') : (a.docEdits ? 'reading or writing documentation' : 'reading and searching, no edits');
  else if (task[site]) reason = { library: 'task reads as research', forge: 'task reads as implementation', quarry: 'task reads as maintenance', temple: 'task reads as review' }[site];
  else if (hints[site]) reason = 'session category hint';
  const best = score(site), margin = best - score(ranked.find(s => s !== site));
  return { site, confidence: best ? Math.min(1, best + margin * 0.4) : 0, reason };
}

function promptText(content) {
  const text = typeof content === 'string' ? content : Array.isArray(content) ? content.filter(b => b.type === 'text' || b.type === 'input_text').map(b => b.text || '').join('\n') : '';
  return text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, '').replace(/<(command-name|command-message|command-args|local-command-stdout)>[\s\S]*?<\/\1>/gi, '').trim();
}
export function extractSignals(transcriptPath, tool) {
  if (!transcriptPath || !['claude', 'codex'].includes(tool)) return {};
  try {
    const st = fs.statSync(transcriptPath), key = `${st.size}:${st.mtimeMs}:${tool}`;
    if (cache.get(transcriptPath)?.key === key) return cache.get(transcriptPath).value;
    const fd = fs.openSync(transcriptPath, 'r'), buf = Buffer.alloc(Math.min(st.size, 2 << 20));
    try { fs.readSync(fd, buf, 0, buf.length, st.size - buf.length); } finally { fs.closeSync(fd); }
    const calls = [], prompts = [];
    // Preserve the original task even when it has fallen outside the activity tail.
    if (st.size > buf.length) {
      const head = Buffer.alloc(Math.min(st.size, 65536)), firstFd = fs.openSync(transcriptPath, 'r');
      try { fs.readSync(firstFd, head, 0, head.length, 0); } finally { fs.closeSync(firstFd); }
      for (const line of head.toString('utf8').split('\n')) {
        let d; try { d = JSON.parse(line); } catch { continue; }
        const m = d.message || d.payload || d;
        if (d.type === 'user' || m.role === 'user') { const t = promptText(m.content); if (t) { prompts.push(t.slice(0, 600)); break; } }
      }
    }
    for (const line of buf.toString('utf8').split('\n')) {
      let d; try { d = JSON.parse(line); } catch { continue; }
      const m = d.message || d.payload || d;
      if ((d.type === 'user' || m.role === 'user') && !m.content?.some?.(b => b.type === 'tool_result')) { const t = promptText(m.content); if (t) prompts.push(t.slice(0, 600)); }
      if (tool === 'claude') {
        for (const b of Array.isArray(m.content) ? m.content : []) if (b.type === 'tool_use') calls.push({ name: b.name, input: b.input || {} });
      } else if (['function_call', 'custom_tool_call'].includes(m.type)) {
        let input = m.arguments ?? m.input ?? {}; if (typeof input === 'string') { try { input = JSON.parse(input); } catch { input = { patch: input }; } }
        calls.push({ name: m.name, input });
      }
    }
    const activity = Object.fromEntries('edits sourceEdits docEdits distinctFiles deletes renames manifestEdits formatters reads searches web tests prReview gitDiff'.split(' ').map(k => [k, 0]));
    const files = new Set();
    const edit = file => {
      activity.edits++; if (file) files.add(file);
      activity[/\.(md|mdx|rst|txt|adoc)$/i.test(file || '') ? 'docEdits' : 'sourceEdits']++;
      if (/(^|\/)(package\.json|.*lock.*|Cargo\.toml|go\.mod|go\.sum|requirements[^/]*|pyproject\.toml)$/i.test(file || '')) activity.manifestEdits++;
    };
    for (const { name = '', input } of calls.slice(-80)) {
      if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(name)) edit(input.file_path || input.notebook_path);
      if (/Read/i.test(name)) activity.reads++;
      if (/Grep|Glob/i.test(name)) activity.searches++;
      if (/WebSearch|WebFetch/i.test(name)) activity.web++;
      const command = String(input.command || input.cmd || '');
      if (/\b(rg|grep|find)\b/.test(command)) activity.searches++;
      if (/\b(cat|ls)\b|git\s+(log|show)\b/.test(command)) activity.reads++;
      if (/\b(test|pytest|jest|vitest|build)\b/.test(command)) activity.tests++;
      if (/gh\s+pr\s+(view|diff|checks)\b/.test(command)) activity.prReview++;
      if (/git\s+diff\b/.test(command)) activity.gitDiff++;
      if (/git\s+mv\b/.test(command)) activity.renames++;
      if (/(?:git\s+)?\brm\s/.test(command)) activity.deletes++;
      if (/prettier\b.*--write|eslint\b.*--fix|\bblack\b|\bgofmt\b|cargo\s+fmt/.test(command)) activity.formatters++;
      const patch = String(input.patch || input.input || (name.includes('apply_patch') ? input : '') || command);
      for (const match of patch.matchAll(/^\*\*\* (Add File|Update File|Delete File|Move to): (.+)$/gm)) {
        edit(match[2]); if (match[1] === 'Delete File') activity.deletes++; if (match[1] === 'Move to') activity.renames++;
      }
    }
    activity.distinctFiles = files.size;
    const value = { taskText: [prompts[0], prompts.length > 1 ? prompts.at(-1) : ''].filter(Boolean).join('\n'), activity };
    if (cache.size >= 100) cache.delete(cache.keys().next().value);
    cache.set(transcriptPath, { key, value }); return value;
  } catch { return {}; }
}
