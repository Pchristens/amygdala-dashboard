// A browser at the gate gets a fixed "you're through" page; MCP clients (no text/html) keep the old answers.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const src = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const rule = src.split('\n').find(l => l.includes('res.end(GATE_PAGE)'));
assert(rule, 'the gate serves GATE_PAGE');
assert.match(rule, /req\.method === 'GET'/); assert.match(rule, /text\\\/html/); assert.match(rule, /p === '\/' \|\| p === '\/visit\/mcp'/);
assert(src.indexOf('res.end(GATE_PAGE)') < src.indexOf("if (!p.startsWith('/visit/')) { gateLog(req, p, 404)"), 'checked before the 404');
const page = src.match(/const GATE_PAGE = '([^\n]*)';/)[1];
assert(!page.includes('${') && !/token|hfv_|isle/i.test(page), 'a fixed page with no village data');
console.log('gate page: browsers see a plain page, MCP clients unchanged');
