// The rune seal: everything Hearthfield knows about The Far Isle is encrypted with a key derived from the human's
// passphrase (scrypt → AES-256-GCM). While sealed the plaintext is not in memory at all — only ciphertext, which the
// front end draws as runes. Unsealed, saves still write the isle portion encrypted. Auto-locks after idle minutes.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const KDF = { N: 1 << 15, r: 8, p: 1, maxmem: 64 << 20 };
const ARRAYS = ['posts', 'exhibits', 'objects', 'feed', 'commitments', 'built', 'offerings', 'findings', 'usage', 'usageDaily', 'counsel', 'tablet', 'tales'];
const RESIDENT_PRIVATE = ['placeId', 'mood', 'doing', 'notes', 'seen'];
// Linear A (U+10600–10736): a real Aegean script that is still undeciphered — fitting for a sealed isle.
const RUNES = Array.from({ length: 0x137 }, (_, i) => String.fromCodePoint(0x10600 + i));
const isle = x => (x?.zone ?? 'village') === 'isle';
const num = id => parseInt(String(id).replace(/^\D+/, ''), 10) || 0;

export function toRunes(bytes, len) {
  let out = '';
  const glyphs = [];
  for (let i = 0; glyphs.length < len && i + 1 < bytes.length; i += 2) {
    const v = (bytes[i] << 8) | bytes[i + 1];
    glyphs.push(v % 7 === 0 && glyphs.length && glyphs.at(-1) !== ' ' ? ' ' : RUNES[v % RUNES.length]);
  }
  return glyphs.join('');
}

export class Seal {
  constructor(world, dataDir, { autoLockMinutes = 5 } = {}) {
    this.w = world; this.file = path.join(dataDir, 'seal.json');
    this.meta = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : null;
    this.key = null; this.lastTouch = 0; this.autoLockMs = autoLockMinutes * 60000;
    // Already sealed on disk → start locked (the world loaded only the public part). Not yet set up → isle is plain.
    this.timer = setInterval(() => { if (this.key && Date.now() - this.lastTouch > this.autoLockMs && this.w.zoneOf(this.w.activeTurn?.resident) !== 'isle') this.lock('auto'); }, 15000);
    this.timer.unref?.();
  }
  get enabled() { return !!this.meta; }
  get locked() { return this.enabled && !this.key; }

  derive(pass, salt) { return crypto.scryptSync(String(pass).normalize('NFKC'), Buffer.from(salt, 'base64'), 32, KDF); }
  encrypt(obj, key = this.key) {
    const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
  }
  decrypt(b64, key = this.key) {
    const buf = Buffer.from(b64, 'base64'), d = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8'));
  }
  hashProject(key) { return crypto.createHash('sha256').update(this.meta.salt + '|' + key).digest('hex').slice(0, 24); }
  touch() { if (this.key) this.lastTouch = Date.now(); }

  // Split a state object into the public part and the isle part, without mutating it.
  split(s) {
    const pub = { ...s }, priv = { residents: {} };
    for (const k of ARRAYS) { pub[k] = (s[k] || []).filter(x => !isle(x)); priv[k] = (s[k] || []).filter(isle); }
    pub.residents = {};
    priv.memories = {};
    for (let [name, r] of Object.entries(s.residents)) {
      // A village resident's remembered isle life is isle data too.
      if (r.memory?.isle) { priv.memories[name] = r.memory.isle; r = { ...r, memory: { ...r.memory } }; delete r.memory.isle; }
      if (r.zone !== 'isle') { pub.residents[name] = r; continue; }
      const open = { ...r }, hidden = {};
      for (const f of RESIDENT_PRIVATE) { hidden[f] = r[f]; delete open[f]; }
      Object.assign(open, { placeId: 'tide-hall', mood: 'sealed', doing: '', notes: [], seen: r.seen });
      pub.residents[name] = open; priv.residents[name] = hidden;
    }
    pub.trees = { ...s.trees }; priv.tree = s.trees?.isle; delete pub.trees.isle;
    priv.quarantine = s.quarantine || [];
    pub.quarantine = [];
    pub.quarantineHashes = (s.quarantine || []).map(k => this.hashProject(k));
    delete pub.sealed;
    return { pub, priv };
  }

  // What gets written to world.json.
  serialize(s) {
    if (!this.enabled) return s;
    if (!this.key) return s; // locked: memory already holds only the public part + s.sealed
    const { pub, priv } = this.split(s);
    return { ...pub, sealed: this.encrypt(priv) };
  }

  setup(pass) {
    if (this.enabled) throw new Error('The isle is already sealed. Unlock it instead.');
    if (String(pass).length < 8) throw new Error('Use a passphrase of at least 8 characters.');
    const salt = crypto.randomBytes(16).toString('base64');
    const key = this.derive(pass, salt);
    this.meta = { v: 1, salt, kdf: { N: KDF.N, r: KDF.r, p: KDF.p }, check: this.encrypt({ ok: 'hearthfield' }, key) };
    fs.writeFileSync(this.file, JSON.stringify(this.meta), { mode: 0o600 });
    this.key = key; this.touch();
    this.w.temple.migrateSnapshots();
    this.w.addFeed(null, 'The Far Isle was sealed in runes.', 'isle');
    this.lock('setup');
  }

  unlock(pass) {
    if (!this.enabled) throw new Error('The isle has no seal yet.');
    if (this.key) { this.touch(); return; }
    const key = this.derive(pass, this.meta.salt);
    try { this.decrypt(this.meta.check, key); } catch { throw new Error('That passphrase does not break the seal.'); }
    const s = this.w.s;
    const priv = s.sealed ? this.decrypt(s.sealed, key) : { residents: {} };
    for (const k of ARRAYS) s[k] = [...(s[k] || []), ...(priv[k] || [])].sort((a, b) => k === 'built' ? 0 : num(a.id) - num(b.id));
    for (const [name, hidden] of Object.entries(priv.residents || {})) if (s.residents[name]) Object.assign(s.residents[name], hidden);
    for (const [name, mem] of Object.entries(priv.memories || {})) if (s.residents[name]) (s.residents[name].memory ??= {}).isle = mem;
    s.trees ??= {}; if (priv.tree) s.trees.isle = priv.tree;
    s.quarantine = priv.quarantine || [];
    delete s.sealed; delete s.quarantineHashes;
    this.key = key; this.touch();
    this.w.trees.ensure();
    this.w.refreshWorkers();
    this.w.changed();
  }

  lock(reason = 'manual') {
    if (!this.key) return;
    // Stop isle activity first: revoke and kill an isle turn so nothing can write after the seal closes.
    for (const fn of this.w.lockHooks ?? []) fn(reason);
    const s = this.w.s;
    const { pub, priv } = this.split(s);
    const sealed = this.encrypt(priv);
    for (const k of Object.keys(s)) delete s[k];
    Object.assign(s, pub, { sealed });
    this.key = null;
    this.w.refreshWorkers();
    this.w.save();
    this.w.changed();
  }

  // Front-end view of the seal (never any plaintext while locked).
  view() {
    if (!this.enabled) return { enabled: false, locked: false };
    const out = { enabled: true, locked: this.locked, autoLockMinutes: this.autoLockMs / 60000 };
    if (this.key) out.locksAt = this.lastTouch + this.autoLockMs;
    if (this.locked && this.w.s.sealed) {
      const bytes = Buffer.from(this.w.s.sealed, 'base64');
      out.runes = Array.from({ length: Math.min(24, Math.ceil(bytes.length / 48)) }, (_, i) => toRunes(bytes.subarray(i * 48), 22 + (bytes[i] % 30)));
    }
    return out;
  }
}
