import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
export function parseOrder(args) {
  const to = args[0], out = { to, wait: false, json: false };
  if (!to || to.startsWith('--')) throw new Error('Usage: amygdala order <Resident> --brief-file FILE [--headline TEXT] [--wait] [--json]');
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === '--wait' || a === '--json') out[a.slice(2)] = true;
    else if (['--brief-file', '--headline'].includes(a) && args[i + 1] && !args[i + 1].startsWith('--')) out[a === '--brief-file' ? 'file' : 'headline'] = args[++i];
    else throw new Error(`Unknown or incomplete argument: ${a}`);
  }
  if (!out.file) throw new Error('--brief-file is required.'); return out;
}
async function main() {
  const a = parseOrder(process.argv.slice(2)), brief = fs.readFileSync(a.file, 'utf8'), base = `http://127.0.0.1:${process.env.AMYGDALA_PORT || 8790}`;
  const page = await (await fetch(base)).text(), token = page.match(/<meta name="hf-token" content="([^"]+)">/)?.[1];
  if (!token) throw new Error('Amygdala did not return a page token.');
  const request = async (path, body) => { const r = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'X-Amygdala-Token': token, 'Content-Type': 'application/json' }, ...(body && { body: JSON.stringify(body) }) }); const o = await r.json(); if (!r.ok || o.ok === false) throw new Error(o.error || 'Order request failed.'); return o; };
  let o = await request('/api/orders', { to: a.to, headline: a.headline, brief, from: 'steward' });
  while (a.wait && ['queued', 'working'].includes(o.status)) o = await request(`/api/orders/${encodeURIComponent(o.id)}/wait?timeout=600`);
  console.log(a.json ? JSON.stringify({ id: o.id, status: o.status, chat: o.chat, report: o.report, data: o.data, error: o.error }) : a.wait ? o.report || o.error || o.status : `${o.id}: ${o.status}`);
  if (['failed', 'cancelled'].includes(o.status)) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(e.message); process.exitCode = 1; });
