import { pathToFileURL } from 'node:url';
export async function main(args = process.argv.slice(2), deps = {}) {
  const base = deps.base || `http://127.0.0.1:${process.env.AMYGDALA_PORT || 8790}`, fetcher = deps.fetch || fetch, sleep = deps.sleep || (ms => new Promise(r => setTimeout(r, ms)));
  if (args.length < 2) throw new Error('Usage: amygdala tell <hero title|workerId> <message…>');
  const page = await (await fetcher(base)).text(), token = page.match(/<meta name="hf-token" content="([^"]+)">/)?.[1]; if (!token) throw new Error('Amygdala did not return a page token.');
  const request = async (path, body) => { const r = await fetcher(base + path, { method: body ? 'POST' : 'GET', headers: { 'X-Amygdala-Token': token, 'Content-Type': 'application/json' }, ...(body && { body: JSON.stringify(body) }) }); const o = await r.json(); if (!r.ok || o.ok === false) throw new Error(o.error || 'Request failed.'); return o; };
  const state = await request('/api/state'), name = args[0], heroes = [...(state.workers || []), ...(state.hall || [])].filter(w => w.zone !== 'isle' && !w.private && !w.isleTagged && !w.quarantined && !w.sealed && (w.id === name || w.title === name));
  if (heroes.length !== 1) { if (heroes.length > 1) console.error(heroes.map(w => `${w.title || '(untitled)'} — ${w.id}`).join('\n')); throw new Error(heroes.length ? 'Hero title is ambiguous.' : 'No village hero matches that title or id.'); }
  const hero = heroes[0], sent = await request('/api/heroes/message', { workerId: hero.id, message: args.slice(1).join(' ') });
  const until = Date.now() + 15 * 60000;
  while (Date.now() < until) { const latest = await request('/api/state'), current = [...(latest.workers || []), ...(latest.hall || [])].find(w => w.id === hero.id), entry = current?.messages?.find(e => e.id === sent.id); if (entry && entry.status !== 'sending') { if (entry.status === 'failed') throw new Error(`Message failed: ${entry.note || 'not delivered'}.`); const reply = current.messages.findLast(e => e.from === 'hero'); console.log(reply?.text || 'The hero replied.'); return; } await sleep(10000); }
  throw new Error('Timed out waiting for the hero reply.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(e.message); process.exitCode = 1; });
