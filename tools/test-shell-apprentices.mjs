import assert from 'node:assert/strict';
import { agentCli, parseRows, parseTree, shellAgents, ShellScanner, mergeAgents } from '../lib/shell-apprentices.js';
import { apprenticeResident } from '../lib/hero-apprentices.js';
import { validateReport } from '../lib/nodes.js';
const SECRET = 'SECRET-PROMPT-hunter2';
// Model flags in every form; a missing or unusable model falls back to the tool name; helpers are not runs.
for (const [args, want] of [
  [`claude -p ${SECRET} --model claude-sonnet-5-5`, { tool: 'claude', model: 'claude-sonnet-5-5' }],
  [`/home/u/.local/bin/claude --model=opus -p ${SECRET}`, { tool: 'claude', model: 'opus' }],
  [`codex exec -m gpt-6.1-sol ${SECRET}`, { tool: 'codex', model: 'gpt-6.1-sol' }],
  [`codex exec -c model="gpt-6-luna" ${SECRET}`, { tool: 'codex', model: 'gpt-6-luna' }],
  [`node /usr/lib/node_modules/@openai/codex/bin/codex.js exec ${SECRET}`, { tool: 'codex', model: 'codex' }],
  [`node --no-warnings /opt/lib/node_modules/@anthropic-ai/claude-code/cli.js -p ${SECRET}`, { tool: 'claude', model: 'claude' }],
  [`/home/u/.local/share/claude/versions/9.1.0 -p ${SECRET}`, { tool: 'claude', model: 'claude' }],
  [`agy -p ${SECRET} --model gemini-4-argon-medium`, { tool: 'agy', model: 'gemini-4-argon-medium' }],
  [`grok -p ${SECRET} -m grok-5`, { tool: 'grok', model: 'grok-5' }],
  [`node /usr/bin/gemini -m gemini-3.8-flash-medium ${SECRET}`, { tool: 'gemini', model: 'gemini-3.8-flash-medium' }],
  [`gemini.exe --model ${'x'.repeat(200)}`, { tool: 'gemini', model: 'gemini' }],
  [`claude -p --model`, { tool: 'claude', model: 'claude' }],
]) assert.deepEqual(agentCli(args), want, args);
for (const args of ['codex mcp-server', 'claude mcp serve', 'claude --version', 'codex app-server', `vim ${SECRET}`, `node server.js ${SECRET}`, `bash -c claude -p ${SECRET}`, 'npx -y some-mcp', '']) assert.equal(agentCli(args), null, args);
assert.deepEqual(Object.keys(agentCli(`claude -p ${SECRET}`)).sort(), ['model', 'tool']);
// Linux procps and macOS ps print the same lstart; padding differs.
const linux = ` 100     1 Wed Oct 28 09:00:00 2026 tmux new-session\n 200   100 Wed Oct 28 09:00:01 2026 -bash\n 300   200 Wed Oct 28 09:00:02 2026 claude --model opus\n 400   300 Wed Oct 28 09:01:00 2026 /bin/bash -c codex exec -m gpt-6.1-sol ${SECRET}\n 500   400 Wed Oct 28 09:01:01 2026 node /usr/lib/node_modules/@openai/codex/bin/codex.js exec -m gpt-6.1-sol ${SECRET}\n 501   500 Wed Oct 28 09:01:01 2026 /usr/lib/node_modules/@openai/codex/vendor/codex/codex exec -m gpt-6.1-sol ${SECRET}\n 600   300 Wed Oct 28 09:02:00 2026 claude -p ${SECRET} --model haiku\n 610   600 Wed Oct 28 09:02:01 2026 /bin/sh -c codex exec ${SECRET}\n 611   610 Wed Oct 28 09:02:01 2026 codex exec ${SECRET}\n 700   300 Wed Oct 28 09:03:00 2026 codex mcp-server\n 800   300 Wed Oct 28 09:03:00 2026 rg ${SECRET}\n`;
const mac = `  300   200 Wed Oct  8 09:00:02 2026 claude --model opus\n  400   300 Wed Oct  8 09:01:00 2026 /bin/zsh -c grok -p ${SECRET} -m grok-5\n  401   400 Wed Oct  8 09:01:00 2026 grok -p ${SECRET} -m grok-5\n`;
assert.deepEqual(parseRows(mac).map(r => [r.pid, r.ppid, r.start, r.cli]), [[300, 200, 'Wed Oct 8 09:00:02 2026', { tool: 'claude', model: 'opus', wrapped: false }], [400, 300, 'Wed Oct 8 09:01:00 2026', null], [401, 400, 'Wed Oct 8 09:01:00 2026', { tool: 'grok', model: 'grok-5', wrapped: false }]]);
// A node-launched codex hero hands over to its native binary: that child is still the hero.
const wrapped = ' 1 0 Wed Oct 28 09:00:00 2026 node /lib/node_modules/@openai/codex/bin/codex.js\n 2 1 Wed Oct 28 09:00:00 2026 /lib/node_modules/@openai/codex/vendor/codex\n 3 2 Wed Oct 28 09:00:00 2026 bash -lc claude -p x --model haiku\n 4 3 Wed Oct 28 09:00:00 2026 claude -p x --model haiku\n';
assert.deepEqual(shellAgents(parseRows(wrapped), [1], 'fixture').map(a => a.agentType), ['shell:claude']);
assert(!JSON.stringify(parseRows(linux)).includes(SECRET));
assert.deepEqual(parseTree('  1     0\n 10    1\nbad line\n'), [{ pid: 1, ppid: 0 }, { pid: 10, ppid: 1 }]);
// The pane's own claude is the hero; its node→native wrapper and its apprentices' children are not counted again.
const found = shellAgents(parseRows(linux), [200], 'fixture');
assert.deepEqual(found.map(a => [a.model, a.agentType]), [['gpt-6.1-sol', 'shell:codex'], ['haiku', 'shell:claude']]);
assert(found.every(a => /^[a-f0-9]{64}$/.test(a.key) && Object.keys(a).join() === 'key,model,agentType'));
assert.deepEqual(shellAgents(parseRows(linux), [300], 'fixture').map(a => a.model), ['gpt-6.1-sol', 'haiku']); // the pane root itself is the hero
assert.equal(shellAgents(parseRows(linux), [200], 'fixture')[0].key, found[0].key); // stable while running
assert.notEqual(shellAgents(parseRows(linux), [200], 'other')[0].key, found[0].key);
assert.deepEqual(shellAgents(parseRows(mac), [300], 'fixture').map(a => a.model), ['grok-5']);
assert.deepEqual(shellAgents(parseRows(linux), [999], 'fixture'), []);
// At most twelve.
const many = ' 1 0 Wed Oct 28 09:00:00 2026 claude\n' + Array.from({ length: 20 }, (_, i) => ` ${10 + i} 1 Wed Oct 28 09:00:00 2026 codex exec -m gpt-6-luna ${SECRET}`).join('\n');
assert.equal(shellAgents(parseRows(many), [1], 'fixture').length, 12);
assert.equal(mergeAgents([{ key: 'a'.repeat(64), model: 'haiku', agentType: 'Explore' }], shellAgents(parseRows(many), [1], 'fixture')).length, 12);
assert.equal(mergeAgents([{ key: 'a' }], undefined).length, 1);
// The scanner: one tree listing, one tmux call per allowed hero, argv only for processes under allowed panes.
const hero = { id: 'h', sessionId: 'h', host: 'local', zone: 'village', tool: 'claude' }, isle = { ...hero, id: 'i', sessionId: 'i' };
const table = linux + ` 900     1 Wed Oct 28 09:00:00 2026 tmux\n 910   900 Wed Oct 28 09:00:00 2026 claude\n 920   910 Wed Oct 28 09:00:00 2026 codex exec -m gpt-6-luna ISLE-${SECRET}\n 950     1 Wed Oct 28 09:00:00 2026 codex exec UNRELATED-${SECRET}\n`;
let calls = [];
const run = async (file, args) => {
  calls.push([file, ...args]);
  if (file === 'tmux') return { '=work': '200\n', '=isle': '910\n', '=wor': '910\n' }[args[3]] ?? '';
  if (args.includes('pid=,ppid=')) return table.split('\n').filter(Boolean).map(l => l.trim().split(/\s+/).slice(0, 2).join(' ')).join('\n');
  return table; // a ps that ignored -p must still not let anything else through
};
const scanner = new ShellScanner(run, 'fixture', 'linux');
const heroes = [{ w: hero, tmux: 'work' }, { w: { ...isle, zone: 'isle' }, tmux: 'isle' }, { w: { ...isle, quarantined: true }, tmux: 'isle' }, { w: { ...isle, isleTagged: true }, tmux: 'isle' }, { w: { ...isle, private: true }, tmux: 'isle' }, { w: { ...isle, sealed: true }, tmux: 'isle' }, { w: { ...isle, host: 'remote' }, tmux: 'isle' }, { w: { ...isle }, tmux: 'isle' }];
const out = await scanner.scan(heroes, ['h'], 1000);
assert.deepEqual([...out.keys()], ['h']); assert.deepEqual(out.get('h').map(a => a.model), ['gpt-6.1-sol', 'haiku']);
assert.equal(calls.filter(c => c[0] === 'ps').length, 2); assert.deepEqual(calls.filter(c => c[0] === 'tmux'), [['tmux', 'list-panes', '-s', '-t', '=work', '-F', '#{pane_pid}']]);
const asked = calls.find(c => c.includes('-p')).at(-1).split(',').map(Number);
assert(!asked.includes(910) && !asked.includes(920) && !asked.includes(950) && !asked.includes(100) && asked.includes(200));
assert(!JSON.stringify([...out]).includes(SECRET));
const body = { hostname: 'fixture', os: 'linux', deckAvailable: true, sessions: [], results: [], apprentices: [{ heroId: 'h', subagents: out.get('h') }] };
assert.equal(validateReport(body), body); assert(!JSON.stringify(body).includes(SECRET));
calls = []; assert.equal((await scanner.scan(heroes, ['h'], 5000)).get('h').length, 2); assert.equal(calls.length, 0); // cached for 15 s
calls = []; assert.equal((await scanner.scan(heroes, [], 6000)).size, 0); assert.equal(calls.length, 0); // nothing allowed: no ps at all
assert.equal((await scanner.scan([{ w: hero, tmux: 'work' }], ['h'], 7000)).size, 0); // the cache went with the allowance
for (const tmux of ['-t', 'a:b', 'a.b', '', undefined, 'x\ny']) { calls = []; assert.equal((await new ShellScanner(run, 'fixture', 'linux').scan([{ w: hero, tmux }], ['h'], 0)).size, 0); assert.equal(calls.length, 0); }
// Missing ps or tmux, and Windows, give nothing.
assert.equal((await new ShellScanner(async () => { throw new Error('ENOENT'); }, 'fixture', 'linux').scan([{ w: hero, tmux: 'work' }], ['h'], 0)).size, 0);
assert.deepEqual((await new ShellScanner(async (f, a) => { if (f === 'tmux') throw new Error('no server'); return run(f, a); }, 'fixture', 'linux').scan([{ w: hero, tmux: 'work' }], ['h'], 0)).size, 0);
calls = []; assert.equal((await new ShellScanner(run, 'fixture', 'win32').scan([{ w: hero, tmux: 'work' }], ['h'], 0)).size, 0); assert.equal(calls.length, 0);
// A process whose parent changed between the two ps calls (pid reuse) is dropped.
const reused = await new ShellScanner(async (f, a) => f === 'tmux' ? '1\n' : a.includes('pid=,ppid=') ? '1 0\n2 1\n' : ' 1 0 Wed Oct 28 09:00:00 2026 claude\n 2 99 Wed Oct 28 09:00:00 2026 codex exec\n', 'fixture', 'linux').scan([{ w: hero, tmux: 'work' }], ['h'], 0);
assert.deepEqual(reused.get('h'), []);
// Bare tool names map to a villager of that kind: the hero's own model when it is the same kind, else the first of that agent.
const roster = [{ name: 'Iris', agent: 'claude', model: 'claude-fable-5-1', zone: 'village' }, { name: 'Wren', agent: 'claude', model: 'claude-sonnet-5-5', zone: 'village' }, { name: 'Atlas', agent: 'codex', model: 'gpt-6-astra', zone: 'village' }, { name: 'Lyra', agent: 'antigravity', model: 'gemini-4-argon-medium', zone: 'village' }, { name: 'Moss', agent: 'grok', zone: 'village' }];
for (const [model, heroModel, name] of [['claude', 'claude-sonnet-5-5', 'Wren'], ['claude', 'gpt-6-astra', 'Iris'], ['codex', 'claude-sonnet-5-5', 'Atlas'], ['agy', '', 'Lyra'], ['gemini', '', 'Lyra'], ['grok', 'opus', 'Moss'], ['gpt-6-astra', 'sonnet', 'Atlas'], ['haiku', 'sonnet', 'Wren']]) assert.equal(apprenticeResident(model, heroModel, roster), name, model);
console.log('shell apprentices ok');
