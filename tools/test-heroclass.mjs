import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { classifyHero, extractSignals } from '../lib/heroclass.js';
import { Sites } from '../lib/sites.js';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heroclass-'));
try {
  for (const tool of ['claude', 'codex']) for (const [site, prompt, name, input] of [
    ['library', 'Investigate and explain the architecture', 'Read', { file_path: 'src/a.js' }],
    ['forge', 'Implement a feature', 'Edit', { file_path: 'src/a.js' }],
    ['quarry', 'Refactor and migrate the modules', 'Edit', { file_path: 'package.json' }],
    ['temple', 'Review pull request #42', 'Bash', { command: 'gh pr diff 42' }],
  ]) {
    const p = path.join(dir, `${tool}-${site}`);
    let rows;
    if (tool === 'claude') rows = [{ type: 'user', message: { role: 'user', content: prompt } }, { type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } }];
    else {
      const patch = site === 'forge' ? '*** Update File: src/a.js' : '*** Update File: package.json';
      rows = [{ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: prompt }] } }, { type: 'response_item', payload: { type: 'function_call', name: ['forge', 'quarry'].includes(site) ? 'apply_patch' : 'exec_command', arguments: JSON.stringify(['forge', 'quarry'].includes(site) ? { patch } : { cmd: site === 'temple' ? 'gh pr diff 42' : 'cat src/a.js' }) } }];
    }
    fs.writeFileSync(p, rows.map(r => JSON.stringify(r)).join('\n'));
    const signals = extractSignals(p, tool);
    assert.equal(classifyHero({ title: 'engine_sim', ...signals }).site, site);
    assert.deepEqual(extractSignals(p, tool), signals);
  }
  assert.equal(classifyHero({ title: '[temple] build', taskText: 'implement' }).site, 'temple');
  assert.equal(classifyHero({ group: '#library' }).confidence, 1);
  const world = { s: {}, refreshWorkers() {}, changed() {}, addFeed() {} };
  const sites = new Sites(world);
  const worker = { id: 'test', title: 'engine_sim', status: 'running' };
  assert.equal(sites.siteFor(worker), 'forge');
  worker.title = 'research'; worker.status = 'idle';
  assert.equal(sites.siteFor(worker), 'forge');
  worker.status = 'running';
  assert.equal(sites.siteFor(worker), 'library');
  sites.assign(worker.id, 'quarry'); assert.equal(sites.siteFor(worker), 'quarry');
  sites.assign(worker.id, 'auto'); assert.equal(world.s.siteOf[worker.id], undefined);
  for (const flag of [{ zone: 'isle' }, { quarantined: true }, { isleTagged: true }, { sealed: true }, { group: 'isle' }, { path: '/Users/test/Isle/secret' }]) {
    const privateWorker = { ...worker, ...flag, get transcriptPath() { throw new Error('private transcript accessed'); } };
    sites.siteFor(privateWorker);
    assert.equal(world.s.autoSite[worker.id], undefined);
  }
  assert.deepEqual(extractSignals('/not/read', 'unknown'), {});
  console.log('heroclass: Claude/Codex four sites, explicit tags, cache, hysteresis, overrides and privacy passed');
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
