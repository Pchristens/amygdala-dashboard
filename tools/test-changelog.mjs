// CHANGELOG.md keeps step with SPEC.md: every `## vX.Y` section of the contract has a plain-language entry, and there is
// always an Unreleased heading for work not yet deployed. A version not yet deployed is covered by naming it in an
// Unreleased line, e.g. "(v0.49)"; the Steward gives it its own heading when it deploys. Pure file reads, no model calls.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = f => { try { return fs.readFileSync(path.join(root, f), 'utf8'); } catch { return null; } };
// Version tokens on level-2 headings only: "## v0.29: …" counts, "### v0.29.1: …" is part of its parent's entry.
const versions = text => new Set(text.split('\n').filter(l => /^##\s/.test(l)).flatMap(l => l.match(/\bv\d+\.\d+(?:\.\d+)?\b/g) || []));

const spec = read('SPEC.md'), log = read('CHANGELOG.md'), problems = [];
if (spec == null) problems.push('SPEC.md is missing.');
if (log == null) problems.push('CHANGELOG.md is missing. Add it at the repository root, newest version first, with an "## Unreleased" heading at the top.');
else {
  if (!/^##\s+Unreleased\s*$/im.test(log)) problems.push('CHANGELOG.md has no "## Unreleased" heading. Add one above the newest version for work that has not been deployed yet.');
  if (spec != null) {
    const unreleased = (log.split(/^##\s+Unreleased\s*$/im)[1] || '').split(/^##\s/m)[0];
    const have = new Set([...versions(log), ...(unreleased.match(/\bv\d+\.\d+(?:\.\d+)?\b/g) || [])]), missing = [...versions(spec)].filter(v => !have.has(v));
    for (const v of missing) {
      const title = spec.split('\n').find(l => /^##\s/.test(l) && new RegExp(`\\b${v.replace(/\./g, '\\.')}\\b`).test(l)).replace(/^##\s+/, '');
      problems.push(`SPEC.md has "## ${title}" but CHANGELOG.md has no "## ${v}" entry. If it isn't deployed yet, add a plain-language line under "## Unreleased" that names it, e.g. "- (${v}) what changed for someone using the village"; the Steward moves it under a "## ${v} — <date>" heading when it deploys.`);
    }
  }
}
if (problems.length) { console.error('changelog: ' + problems.length + ' problem(s)\n- ' + problems.join('\n- ')); process.exit(1); }
console.log('changelog: every SPEC version has an entry, and Unreleased is there');
