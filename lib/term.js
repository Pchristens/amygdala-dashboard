import { bin, buildPath } from './bin.js';
import { execFile, spawn } from './bin.js';
import { promisify } from 'node:util';
import { createInterface } from 'node:readline';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(os.homedir(), '.local/bin');

export class TermHub {
  constructor(world) {
    this.world = world;
    this.bridges = new Map();
    this.pending = new Map();
    this.watch = setInterval(() => {
      for (const [id, bridge] of this.bridges) {
        try { this.allowed(id); } catch { bridge.close(); }
      }
    }, 1000);
    this.watch.unref();
  }

  closeIsle() {
    for (const [id, bridge] of this.bridges) {
      if (this.world.workers.find(w => w.id === id)?.zone === 'isle') bridge.close();
    }
  }

  allowed(id) {
    if (process.platform === 'win32') throw new Error('The in-page terminal is unavailable on Windows (requires python3 and tmux).');
    const worker = this.world.workers.find(w => w.id === id);
    if (!worker || !id.startsWith('local:') || worker.host !== 'local') throw new Error('Terminal is available only for local heroes.');
    if (worker.zone === 'isle' && this.world.seal.locked) throw new Error('The isle is sealed. Unlock it first.');
    return worker;
  }

  async open(id) {
    this.allowed(id);
    if (this.bridges.has(id)) return this.bridges.get(id);
    if (!this.pending.has(id)) {
      const opening = this.start(id).finally(() => this.pending.delete(id));
      this.pending.set(id, opening);
    }
    return this.pending.get(id);
  }

  async start(id) {
    const env = { ...process.env, PATH: buildPath({ unix: [] }) };
    const { stdout } = await exec(bin('agent-deck'), ['list', '--json'], { env, timeout: 15000, maxBuffer: 8 << 20 });
    this.allowed(id);
    const list = JSON.parse(stdout);
    const session = (Array.isArray(list) ? list : list.sessions || []).find(s => s.id === id.slice(6));
    if (!session?.tmux_session || typeof session.tmux_session !== 'string') throw new Error('No tmux session found for this hero.');
    const child = spawn('python3', ['-I', path.join(ROOT, 'tools/ptybridge.py'), bin('tmux'), 'attach-session', '-t', session.tmux_session], { env, stdio: ['pipe', 'pipe', 'ignore'] });
    const viewers = new Set();
    let replay = Buffer.alloc(0), timer, closed = false;
    const send = (res, event, data) => {
      if (res.destroyed || res.writableLength > (1 << 20)) { res.destroy(); return; }
      res.write(`event: ${event}\ndata: ${data}\n\n`);
    };
    const bridge = {
      close: () => {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        this.bridges.delete(id);
        child.stdin.end();
        child.kill();
        for (const res of viewers) { send(res, 'exit', 'session ended'); res.end(); }
        viewers.clear();
      },
      subscribe: res => {
        if (closed) { send(res, 'exit', 'session ended'); res.end(); return; }
        clearTimeout(timer);
        viewers.add(res);
        if (replay.length) send(res, 'o', replay.toString('base64'));
        res.on('close', () => {
          viewers.delete(res);
          if (!viewers.size && !closed) idle();
        });
      },
      write: msg => {
        this.allowed(id);
        if (closed || !child.stdin.writable) throw new Error('Terminal session ended.');
        if (child.stdin.writableLength > (1 << 20)) throw new Error('Terminal input is busy.');
        child.stdin.write(JSON.stringify(msg) + '\n');
      },
    };
    const idle = () => { clearTimeout(timer); timer = setTimeout(bridge.close, 30000); timer.unref(); };
    this.bridges.set(id, bridge);
    idle();
    child.stdin.on('error', bridge.close);
    child.on('error', bridge.close);
    child.on('close', bridge.close);
    const lines = createInterface({ input: child.stdout });
    lines.on('line', line => {
      if (closed) return;
      try { this.allowed(id); } catch { bridge.close(); return; }
      try {
        const msg = JSON.parse(line);
        if (msg.t !== 'o') return;
        const data = Buffer.from(msg.d, 'base64');
        replay = Buffer.concat([replay, data]).subarray(-65536);
        for (const res of viewers) send(res, 'o', msg.d);
      } catch { bridge.close(); }
    });
    return bridge;
  }

  input(id, d) {
    if (typeof d !== 'string' || d.length > 131072 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(d)) throw new Error('Invalid terminal input.');
    this.active(id).write({ t: 'i', d });
  }

  resize(id, cols, rows) {
    if (![cols, rows].every(n => Number.isInteger(n) && n >= 1 && n <= 1000)) throw new Error('Invalid terminal dimensions.');
    this.active(id).write({ t: 'r', c: cols, r: rows });
  }

  active(id) {
    this.allowed(id);
    const bridge = this.bridges.get(id);
    if (!bridge) throw new Error('Terminal is not connected.');
    return bridge;
  }
}
