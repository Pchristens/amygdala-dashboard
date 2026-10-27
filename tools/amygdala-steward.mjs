import http from 'node:http';
import { pathToFileURL } from 'node:url';
function request(url, options) {
  return new Promise((resolve, reject) => { const req = http.get(url, options, res => { let text = ''; res.setEncoding('utf8'); res.on('data', c => { text += c; }); res.on('error', reject); res.on('end', () => resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, json: () => JSON.parse(text) })); }); req.on('error', reject); });
}
export async function stewardWait({ base = `http://127.0.0.1:${process.env.AMYGDALA_PORT || 8790}`, json = false, timeout = 3000, poll = request } = {}) {
  const page = await (await fetch(base)).text(), token = page.match(/<meta name="hf-token" content="([^"]+)">/)?.[1];
  if (!token) throw new Error('Amygdala did not return a page token.');
  const res = await poll(`${base}/api/steward/wait?timeout=${timeout}`, { headers: { 'X-Amygdala-Token': token } });
  if (res.status === 204) return 2;
  const bell = await res.json(); if (!res.ok) throw new Error(bell.error || 'Steward wait failed.');
  console.log(json ? JSON.stringify(bell) : `${bell.text}${bell.kind === 'reset_window' ? '\n' + JSON.stringify({ windowKey: bell.windowKey, budget: bell.budget, candidates: bell.candidates, pick: bell.pick }) : ''}`); return 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.slice(2).some(a => a !== '--json')) { console.error('Usage: amygdala steward-wait [--json]'); process.exitCode = 1; }
  else stewardWait({ json: process.argv.includes('--json') }).then(code => { process.exitCode = code; }).catch(e => { console.error(e.message); process.exitCode = 1; });
}
