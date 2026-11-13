import {randomToken,safeEqual,sha256Base64Url} from './crypto';
import type {Env,SessionRow} from './types';
import {isApplicationAccessAllowed} from './policy';
export const SESSION_IDLE_TTL_MS=7*86400000;
export const SESSION_ABSOLUTE_TTL_MS=7*86400000;
const AUTH_CODE_TTL_MS=120000;
const ACCESS_TOKEN_TTL_MS=3600000;
export const sessionSelectSql=`SELECT s.user_id,s.expires_at,s.created_at,s.session_kind FROM auth_sessions s
 LEFT JOIN user_reauthentication r ON r.user_id=s.user_id
 WHERE s.token_hash=? AND s.expires_at>? AND s.created_at>?
 AND (r.requested_at IS NULL OR s.created_at>r.requested_at)`;
export async function findSessionUser(env: Env, rawToken: string | undefined): Promise<string | null> {
  if (!rawToken) return null;
  const hash = await sha256Base64Url(rawToken);
  const now = Date.now();
  const row = await env.DB.prepare(
    sessionSelectSql
  ).bind(hash, now, now - SESSION_ABSOLUTE_TTL_MS).first<SessionRow & { created_at: number; session_kind:string }>();
  if (!row) return null;
  return row.session_kind==='firebase'?row.user_id:null;
}

export async function createSession(env: Env, userId: string): Promise<{ token: string; maxAgeSeconds: number }> {
  const token = randomToken(32);
  const hash = await sha256Base64Url(token);
  const now = Date.now();
  const expiresAt = now+SESSION_ABSOLUTE_TTL_MS;
  await env.DB.prepare(
    `INSERT INTO auth_sessions(token_hash, user_id, expires_at, created_at, last_used_at,session_kind) VALUES (?, ?, ?, ?, ?,?)`
  ).bind(hash, userId, expiresAt, now, now,'firebase').run();
  return { token, maxAgeSeconds: Math.floor(SESSION_ABSOLUTE_TTL_MS / 1000) };
}

export async function deleteSession(env: Env, rawToken: string | undefined): Promise<void> {
  if (!rawToken) return;
  const hash = await sha256Base64Url(rawToken);
  await env.DB.prepare(`DELETE FROM auth_sessions WHERE token_hash = ?`).bind(hash).run();
}


export async function createAuthorizationCode(env: Env, userId: string, clientId: string, redirectUri: string, codeChallenge: string, sessionExpiresAt:number|null=null): Promise<string> {
  const code = randomToken(32);
  const codeHash = await sha256Base64Url(code);
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO auth_codes(code_hash, user_id, client_id, redirect_uri, code_challenge, expires_at, used_at, created_at,session_expires_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`
  ).bind(codeHash, userId, clientId, redirectUri, codeChallenge, now + AUTH_CODE_TTL_MS, now,sessionExpiresAt).run();
  return code;
}


export async function exchangeAuthorizationCode(env: Env, args: { code: string; clientId: string; redirectUri: string; codeVerifier: string }): Promise<{ accessToken: string; expiresIn: number }> {
  const codeHash = await sha256Base64Url(args.code);
  const now = Date.now();
  const row = await env.DB.prepare(
    `SELECT user_id, client_id, redirect_uri, code_challenge, expires_at, used_at,session_expires_at FROM auth_codes WHERE code_hash = ?`
  ).bind(codeHash).first<{
    user_id: string; client_id: string; redirect_uri: string; code_challenge: string; expires_at: number; used_at: number | null; session_expires_at:number|null;
  }>();

  if (!row || row.used_at || row.expires_at <= now) throw new Error('INVALID_OR_EXPIRED_CODE');
  if (row.client_id !== args.clientId || row.redirect_uri !== args.redirectUri) throw new Error('CODE_CLIENT_MISMATCH');

  const expected = await sha256Base64Url(args.codeVerifier);
  if (!safeEqual(expected, row.code_challenge)) throw new Error('PKCE_VERIFICATION_FAILED');

  if (!await isApplicationAccessAllowed(env, row.user_id, args.clientId)) throw new Error('ACCESS_DENIED');

  const accessToken = randomToken(32);
  const tokenHash = await sha256Base64Url(accessToken);
  const issuedAt = Date.now();
  const expiresAt = row.session_expires_at ?? issuedAt + ACCESS_TOKEN_TTL_MS;
  if(expiresAt<=issuedAt)throw new Error('SESSION_EXPIRED');
  const [issued] = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO access_tokens(token_hash, user_id, client_id, expires_at, revoked_at, created_at)
       SELECT ?, c.user_id, c.client_id, ?, NULL, ? FROM auth_codes c
       WHERE c.code_hash = ? AND c.used_at IS NULL AND c.expires_at > ?
         AND c.client_id = ? AND c.redirect_uri = ? AND c.code_challenge = ?
         AND NOT EXISTS (SELECT 1 FROM user_reauthentication r WHERE r.user_id = c.user_id AND c.created_at <= r.requested_at)`
    ).bind(tokenHash, expiresAt, issuedAt, codeHash, issuedAt, args.clientId, args.redirectUri, expected),
    env.DB.prepare(
      `UPDATE auth_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL
         AND EXISTS (SELECT 1 FROM access_tokens WHERE token_hash = ?)`
    ).bind(issuedAt, codeHash, tokenHash),
  ]);
  if (issued?.meta.changes !== 1) throw new Error('INVALID_OR_EXPIRED_CODE');
  return { accessToken, expiresIn: Math.floor((expiresAt-issuedAt) / 1000) };
}

export async function authenticateAccessToken(env: Env, rawToken: string, clientId: string): Promise<string | null> {
  return (await inspectAccessToken(env, rawToken, clientId))?.userId ?? null;
}

export async function inspectAccessToken(env: Env, rawToken: string, clientId: string): Promise<{ userId: string; clientId: string; expiresAt: number } | null> {
  const hash = await sha256Base64Url(rawToken);
  const now = Date.now();
  const row = await env.DB.prepare(
    `SELECT t.user_id, t.client_id, t.expires_at, t.revoked_at, t.created_at FROM access_tokens t
      LEFT JOIN user_reauthentication r ON r.user_id = t.user_id
      WHERE t.token_hash = ? AND (r.requested_at IS NULL OR t.created_at > r.requested_at)`
  ).bind(hash).first<{ user_id: string; client_id: string; expires_at: number; revoked_at: number | null; created_at: number }>();
  if (!row || row.revoked_at || row.expires_at <= now || row.client_id !== clientId) return null;
  return { userId: row.user_id, clientId: row.client_id, expiresAt: Number(row.expires_at) };
}

export async function revokeAccessToken(env: Env, rawToken: string): Promise<void> {
  const hash = await sha256Base64Url(rawToken);
  await env.DB.prepare(`UPDATE access_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL`).bind(Date.now(), hash).run();
}

export async function revokeAccessTokensForUser(env: Env, userId: string): Promise<void> {
  await env.DB.prepare(`UPDATE access_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`).bind(Date.now(), userId).run();
}


export async function logAuthEvent(env: Env, eventType: string, userId?: string | null, clientId?: string | null, detail?: unknown): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO auth_events(id, user_id, client_id, event_type, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(`evt_${randomToken(10)}`, userId ?? null, clientId ?? null, eventType, detail === undefined ? null : JSON.stringify(detail), Date.now()).run();
}

export async function cleanupExpiredAuthData(env: Env): Promise<void> {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM oauth_requests WHERE expires_at <= ?`).bind(now),
    env.DB.prepare(`DELETE FROM auth_sessions WHERE expires_at <= ?`).bind(now),
    env.DB.prepare(`DELETE FROM auth_codes WHERE expires_at <= ?`).bind(now),
    env.DB.prepare(`DELETE FROM access_tokens WHERE expires_at <= ? OR revoked_at IS NOT NULL`).bind(now),
  ]);
}
