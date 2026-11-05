// Phone sign-in (v0.92): the human's phone reaches the dashboard through the Tailscale gate. The human makes a one-time
// link (ten minutes); opening it on the phone trades the code for a 30-day session cookie. Only hashes are kept.
import crypto from 'node:crypto';

export const PHONE_COOKIE = 'amy_phone';
const CODE_TTL = 10 * 60000, SESSION_TTL = 30 * 86400000, MAX_SESSIONS = 5;
const hash = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const secret = () => crypto.randomBytes(32).toString('base64url');

export class Phones {
  constructor(world) { this.w = world; world.s.phone ??= { codes: [], sessions: [] }; }
  get s() { return this.w.s.phone; }
  prune(now = Date.now()) {
    const n = this.s.codes.length + this.s.sessions.length;
    this.s.codes = this.s.codes.filter(c => c.expiresAt > now); this.s.sessions = this.s.sessions.filter(x => x.expiresAt > now);
    if (this.s.codes.length + this.s.sessions.length !== n) this.w.changed();
  }
  // The page marks the human's own clicks; the Steward and other callers can't let a phone in.
  issue(actor, now = Date.now()) {
    if (actor !== 'human') throw new Error('Only the human can let a phone in.');
    if (!this.w.gateUrl) throw new Error('The Tailscale gate is not open.');
    this.prune(now);
    const code = secret();
    this.s.codes = [...this.s.codes, { hash: hash(code), expiresAt: now + CODE_TTL }].slice(-3); this.w.changed();
    return { url: `${this.w.gateUrl}/phone#${code}`, expiresAt: now + CODE_TTL };
  }
  login(code, now = Date.now()) {
    this.prune(now);
    const h = typeof code === 'string' && /^[\w-]{20,100}$/.test(code) && hash(code), c = h && this.s.codes.find(c => c.hash === h);
    if (!c) throw new Error('That link has expired or was already used. Make a new one on the dashboard.');
    this.s.codes = this.s.codes.filter(x => x !== c);
    const sid = secret();
    this.s.sessions = [...this.s.sessions, { id: this.w.id('ph'), hash: hash(sid), createdAt: now, lastSeenAt: now, expiresAt: now + SESSION_TTL }].slice(-MAX_SESSIONS);
    this.w.changed();
    return { sid, maxAge: SESSION_TTL / 1000 };
  }
  auth(req, now = Date.now()) {
    const m = String(req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${PHONE_COOKIE}=([\\w-]{20,100})(?:;|$)`));
    const x = m && this.s.sessions.find(x => x.hash === hash(m[1]) && x.expiresAt > now);
    if (!x) return null;
    if (now - x.lastSeenAt > 60000) { x.lastSeenAt = now; this.w.changed(); }
    return x;
  }
  signOut(actor) {
    if (actor !== 'human') throw new Error('Only the human can sign phones out.');
    this.s.codes = []; this.s.sessions = []; this.w.changed();
    return { phone: this.view() };
  }
  view(now = Date.now()) { return { sessions: this.s.sessions.filter(x => x.expiresAt > now).map(({ id, createdAt, lastSeenAt, expiresAt }) => ({ id, createdAt, lastSeenAt, expiresAt })) }; }
}
