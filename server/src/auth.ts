import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from './db.js';

const COOKIE = 'gz_session';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60 * 1000;

/** Single-user password login with a server-side session and a lockout after repeated wrong passwords. */
export class Auth {
  private failures = 0;
  private lockedUntil = 0;

  constructor(
    private readonly db: Db,
    private readonly passwordHash: string,
    private readonly secureCookie: boolean,
  ) {
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  }

  async login(password: string, reply: FastifyReply): Promise<{ ok: true } | { ok: false; error: string }> {
    if (Date.now() < this.lockedUntil) {
      return { ok: false, error: 'Too many wrong passwords. Try again in 15 minutes.' };
    }
    const match = typeof password === 'string' && (await bcrypt.compare(password, this.passwordHash));
    if (!match) {
      if (++this.failures >= MAX_FAILURES) {
        this.failures = 0;
        this.lockedUntil = Date.now() + LOCK_MS;
      }
      return { ok: false, error: 'Wrong password' };
    }
    this.failures = 0;
    const token = crypto.randomBytes(32).toString('base64url');
    this.db.prepare('INSERT INTO sessions (token, expires_at) VALUES (?, ?)').run(token, Date.now() + SESSION_MS);
    reply.setCookie(COOKIE, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
      secure: this.secureCookie,
      maxAge: SESSION_MS / 1000,
    });
    return { ok: true };
  }

  logout(req: FastifyRequest, reply: FastifyReply): void {
    const token = req.cookies[COOKIE];
    if (token) this.db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    reply.clearCookie(COOKIE, { path: '/' });
  }

  isLoggedIn(req: FastifyRequest): boolean {
    const token = req.cookies[COOKIE];
    if (!token) return false;
    const row = this.db.prepare('SELECT expires_at FROM sessions WHERE token = ?').get(token) as
      | { expires_at: number }
      | undefined;
    return row != null && row.expires_at > Date.now();
  }
}
