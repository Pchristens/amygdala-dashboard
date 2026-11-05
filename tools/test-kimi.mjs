// Kimi Code residents (v0.94): each run gets a throwaway home with only the human's login linked in; the agent file is
// the tool allowlist (village tools, web only when the run may search); cleanup removes the link and never the login.
// Fake homes and a stubbed terminal only; no CLI or model calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { prepareKimi, cleanupKimi, kimiArgs, kimiAnswer, kimiTools, agentFile, kimiPaths } from '../lib/kimi.js';
import { parseKimiUsage, probeKimiConpty } from '../lib/fleet.js';
import { AGENTS, WEB_AGENTS, aliasesOf } from '../lib/conductor.js';
import { guidanceCommand } from '../lib/guidance.js';
import { providerOfModel, providerOfTool } from '../lib/temple.js';
import { POOL } from '../lib/usage.js';
import { modelTier } from '../lib/triage.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'amygdala-kimi-'));
const home = path.join(root, 'home'), real = path.join(home, '.kimi-code');
const saved = process.env.HOME;
try {
  // Not signed in: refuse, before anything is made.
  assert.throws(() => prepareKimi(path.join(root, 'none'), { home }), /not signed in/);
  fs.mkdirSync(path.join(real, 'credentials'), { recursive: true });
  fs.writeFileSync(path.join(real, 'credentials', 'kimi-code-env-x.json'), '{"t":1}');
  fs.writeFileSync(path.join(real, 'config.toml'), 'default_model = "x"\n');
  fs.writeFileSync(path.join(real, 'mcp.json'), '{"mcpServers":{"human":{"url":"http://human"}}}');
  fs.writeFileSync(path.join(real, 'AGENTS.md'), 'human instructions');

  // A turn's home: the login linked, the config copied, the human's MCP servers and instructions left behind.
  const dir = path.join(root, 'turn'), url = 'http://127.0.0.1:1/mcp/t/tok';
  const k = prepareKimi(dir, { url, tools: kimiTools({ mcp: true, web: true }), home });
  assert.deepEqual(k, kimiPaths(dir));
  assert.deepEqual(k.env, { KIMI_CODE_HOME: k.home, HOME: k.home, USERPROFILE: k.home });
  assert(fs.lstatSync(path.join(k.home, 'credentials')).isSymbolicLink());
  assert.equal(fs.readFileSync(path.join(k.home, 'config.toml'), 'utf8'), 'default_model = "x"\n');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(k.home, 'mcp.json'), 'utf8')), { mcpServers: { amygdala: { url } } });
  assert(!fs.existsSync(path.join(k.home, 'AGENTS.md')));
  const agent = fs.readFileSync(k.agent, 'utf8');
  assert.match(agent, /^tools: \["mcp__amygdala__\*","WebSearch"\]$/m); assert.match(agent, /^subagents: \[\]$/m);

  // Cleanup removes only the link: the login survives the run folder's removal.
  cleanupKimi(dir); assert(!fs.existsSync(path.join(k.home, 'credentials')));
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(fs.readFileSync(path.join(real, 'credentials', 'kimi-code-env-x.json'), 'utf8'), '{"t":1}');
  cleanupKimi(dir); // a second cleanup is harmless
  // A real folder in the link's place is never removed.
  const odd = path.join(root, 'odd'); fs.mkdirSync(path.join(odd, '.kimi-home', 'credentials'), { recursive: true }); fs.writeFileSync(path.join(odd, '.kimi-home', 'credentials', 'f'), 'x');
  cleanupKimi(odd); assert(fs.existsSync(path.join(odd, '.kimi-home', 'credentials', 'f')));

  // No tools means a list naming none (a missing or ["*"] list would mean every tool).
  assert.match(agentFile([]), /^tools: \["NoTools"\]$/m);
  assert.deepEqual(kimiTools(), []); assert.deepEqual(kimiTools({ mcp: true }), ['mcp__amygdala__*']);

  // Arguments: the managed alias and the agent file; an unknown model is refused rather than silently falling back.
  assert.deepEqual(kimiArgs('hi', { model: 'k3.1-pro', agent: '/a.md' }), ['-p', 'hi', '--output-format', 'stream-json', '-m', 'kimi-code/k3.1-pro', '--agent-file', '/a.md']);
  assert.throws(() => kimiArgs('hi', { model: 'k9', agent: '/a.md' }), /Unknown Kimi model/);
  assert.equal(kimiAnswer('{"role":"assistant","content":"first"}\n{"role":"tool","content":"x"}\nnoise\n{"role":"assistant","content":"","tool_calls":[]}\n{"role":"assistant","content":"last"}\n'), 'last');
  assert.equal(kimiAnswer('{"role":"meta"}'), undefined);

  // Resident turns: web search only when the turn may search (the human's direct question), same as Claude and Codex.
  process.env.HOME = home;
  assert(WEB_AGENTS.has('kimi'));
  for (const web of [false, true]) {
    const cwd = path.join(root, `run-${web}`); fs.mkdirSync(cwd);
    const b = AGENTS.kimi({ name: 'Kallias', agent: 'kimi', model: 'k3.1-pro', web, persona: 'p' }, url, cwd, [], { view: '' });
    assert.equal(b.env.KIMI_CODE_HOME, path.join(cwd, '.kimi-home')); assert(b.args.includes('kimi-code/k3.1-pro'));
    b.setup();
    const tools = fs.readFileSync(b.args[b.args.indexOf('--agent-file') + 1], 'utf8').match(/^tools: (.*)$/m)[1];
    assert.deepEqual(JSON.parse(tools), web ? ['mcp__amygdala__*', 'WebSearch'] : ['mcp__amygdala__*']);
    b.teardown(); assert(!fs.existsSync(path.join(cwd, '.kimi-home', 'credentials')));
  }
  // Prompt mode refuses --auto (it never asks for approval anyway).
  assert(!kimiArgs('hi', { model: 'k3', agent: '/a.md' }).some(a => ['--auto', '--yolo', '--plan'].includes(a)));
  // fi43821: an unknown model doesn't throw while the turn is built (outside run's try), only in setup (inside it).
  const bad = AGENTS.kimi({ name: 'X', agent: 'kimi', model: 'k9', persona: 'p' }, url, path.join(root, 'bad'), [], { view: '' });
  assert.throws(() => bad.setup(), /Unknown Kimi model/); assert(!fs.existsSync(path.join(root, 'bad', '.kimi-home')));
  assert(aliasesOf({ name: 'Kallias', agent: 'kimi', model: 'k3.1-pro' }).includes('kimi'));

  // Petition answers: no village tools; research may search and fetch, a plain answer gets no tools at all.
  for (const depth of ['quick', 'research']) {
    const cwd = path.join(root, `guide-${depth}`); fs.mkdirSync(cwd);
    const c = guidanceCommand({ name: 'Doris', agent: 'kimi', model: 'k3-256k', persona: 'p' }, { depth, visitor: 'v', question: 'q' }, cwd);
    const kh = path.join(cwd, '.kimi-home');
    assert.equal(c.env.KIMI_CODE_HOME, kh);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(kh, 'mcp.json'), 'utf8')), { mcpServers: {} });
    const tools = JSON.parse(fs.readFileSync(path.join(kh, 'resident.md'), 'utf8').match(/^tools: (.*)$/m)[1]);
    assert.deepEqual(tools, depth === 'research' ? ['WebSearch', 'FetchURL'] : ['NoTools']);
    cleanupKimi(cwd);
  }
  process.env.HOME = saved;

  // The Moonshot pool: models, tool and CLI all map to it.
  assert.equal(providerOfModel('k3.1-pro'), 'moonshot'); assert.equal(providerOfModel('kimi-for-coding'), 'moonshot'); assert.equal(providerOfModel('k3-256k'), 'moonshot');
  assert.equal(providerOfTool('kimi'), 'moonshot'); assert.equal(POOL.kimi, 'moonshot');
  // Triage tiers: K3.1 Pro beside Opus and Astra, K3 beside Sonnet and Sol, K2.8 beside Haiku and Flash.
  assert.deepEqual(['k3.1-pro', 'k3.1-pro-highspeed', 'k3', 'k3-256k', 'kimi-for-coding'].map(modelTier), ['deep', 'deep', 'considered', 'considered', 'quick']);

  // The /usage plan box.
  const now = Date.UTC(2026, 10, 5);
  const u = parseKimiUsage('\x1b[1m Plan usage\x1b[0m\n 5h limit       ████░░░░  18% used  resets in 3h 46m\n Monthly limit  ░░░░░░░░  1% used   resets in 30d 2h 58m\n                kimi 0% · code 1%\n', now);
  assert.equal(u.id, 'kimi');
  assert.deepEqual(u.windows.map(w => [w.kind, w.used_percentage, w.resets_at]), [['five_hour', 18, (now + 226 * 60000) / 1000], ['monthly', 1, (now + ((30 * 24 + 2) * 60 + 58) * 60000) / 1000]]);
  assert.equal(parseKimiUsage('5h limit 999% used'), null); assert.equal(parseKimiUsage('Trust this folder?'), null);

  // Windows probe: accepts the trust prompt, then reads /usage.
  const fake = () => { const c = new EventEmitter(); c.stdin = new PassThrough(); c.stdout = new PassThrough(); c.kills = 0; c.kill = () => { c.kills++; c.emit('close'); }; return c; };
  const ch = fake(), sent = []; ch.stdin.on('data', d => sent.push(Buffer.from(JSON.parse(String(d)).d, 'base64').toString()));
  const out = t => ch.stdout.write(JSON.stringify({ t: 'o', d: Buffer.from(t).toString('base64') }) + '\n');
  let step = 0;
  const r = await probeKimiConpty(root, {}, async () => ch, async () => { step++; if (step === 1) out('Trust this folder?\n'); if (step === 4) out('5h limit ██ 40% used resets in 1h\n'); await new Promise(res => setImmediate(res)); }, 'kimi');
  assert.equal(r.windows[0].used_percentage, 40); assert.equal(sent[0], '\r'); assert(sent.includes('/usage')); assert(ch.kills);
  console.log('kimi ok');
} finally { process.env.HOME = saved; fs.rmSync(root, { recursive: true, force: true }); }
