import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { query, one } from './db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'pipeflow-dev-secret-change-me';
const JWT_TTL_SEC = 60 * 60 * 12; // 12h

// scrypt-based password hashing: salt$hash (hex)
export function hashPassword(plain: string): string {
  const salt = randomBytes(16);
  const buf = scryptSync(plain, salt, 64);
  return `${salt.toString('hex')}$${buf.toString('hex')}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split('$');
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const target = Buffer.from(hashHex, 'hex');
  const got = scryptSync(plain, salt, target.length);
  return got.length === target.length && timingSafeEqual(got, target);
}

// Minimal HS256 JWT (header.payload.sig, base64url, no padding).
function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function b64urlJSON(obj: unknown): string {
  return b64url(JSON.stringify(obj));
}
function sign(input: string): string {
  return b64url(createHmac('sha256', JWT_SECRET).update(input).digest());
}

export interface TokenPayload { sub: string; uid: number; iat: number; exp: number; }

export function signToken(uid: number, username: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64urlJSON({ alg: 'HS256', typ: 'JWT' });
  const payload = b64urlJSON({ sub: username, uid, iat: now, exp: now + JWT_TTL_SEC });
  const sig = sign(`${header}.${payload}`);
  return `${header}.${payload}.${sig}`;
}

export function verifyToken(tok: string): TokenPayload | null {
  const parts = tok.split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  const expected = sign(`${h}.${p}`);
  // constant-time compare on equal-length strings
  if (s.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(s), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(p.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')) as TokenPayload;
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  must_change: boolean;
}

export async function findUserByUsername(username: string): Promise<UserRow | null> {
  return one<UserRow>('SELECT id, username, password_hash, must_change FROM users WHERE username = $1', [username]);
}

export async function findUserById(id: number): Promise<UserRow | null> {
  return one<UserRow>('SELECT id, username, password_hash, must_change FROM users WHERE id = $1', [id]);
}

export async function updatePassword(id: number, newPlain: string): Promise<void> {
  const hash = hashPassword(newPlain);
  await query('UPDATE users SET password_hash = $1, must_change = false, updated_at = now() WHERE id = $2', [hash, id]);
}

// Bootstrap default admin/admin on empty users table. must_change=true → frontend
// will force a password change on first login.
export async function bootstrapDefaultAdmin(): Promise<void> {
  const rows = await query<{ count: string }>('SELECT count(*)::text AS count FROM users');
  if (rows[0] && Number(rows[0].count) > 0) return;
  const hash = hashPassword('admin');
  await query(
    'INSERT INTO users (username, password_hash, must_change) VALUES ($1, $2, true) ON CONFLICT (username) DO NOTHING',
    ['admin', hash]
  );
  console.log('[auth] bootstrapped default user admin/admin (must_change=true)');
}

// Express middleware: require valid Bearer JWT, attach payload to req.user.
export function requireUser(req: Request, res: Response, next: NextFunction) {
  const hdr = req.headers.authorization || '';
  const tok = hdr.startsWith('Bearer ') ? hdr.slice(7) : '';
  const payload = tok ? verifyToken(tok) : null;
  if (!payload) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  (req as any).user = payload;
  next();
}

// Socket.IO handshake auth: token via auth.token or query.token.
export function verifySocketToken(raw: unknown): TokenPayload | null {
  if (typeof raw !== 'string' || !raw) return null;
  return verifyToken(raw);
}

// Touch to keep tsc happy if unused symbols get pruned.
export const _hash = createHash;
