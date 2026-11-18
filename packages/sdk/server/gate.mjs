import { loginPage, diagnosticsPage } from './login.mjs';

export const RUNTIME_VERSION = '0.3.1';
export const COOKIE = '__Host-accesskit_connect';
export const AUTHORIZATION_LEASE_MS = 60 * 60 * 1000;
const encoder = new TextEncoder();
const keys = new Map();
const clearCookie = `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
const signedOutCookie = '__Host-accesskit_signed_out';
const cookieAttributes = '; Path=/; HttpOnly; Secure; SameSite=Lax';

function response(body, status, headers = {}) {
  return new Response(body, { status, headers: {
    'Cache-Control': 'private, no-store, max-age=0',
    'Vary': 'Cookie', 'X-Content-Type-Options': 'nosniff',
    'X-Access-Kit-Gate': 'v1', 'X-Access-Kit-Runtime': RUNTIME_VERSION, ...headers,
  } });
}
function denied(request, status, settings) {
  const html = request.method === 'GET' && request.headers.get('Accept')?.includes('text/html') && !request.headers.has('Range');
  const signedOut = hasSignedOutCookie(request);
  return response(html ? loginPage(settings, status, !signedOut && new URL(request.url).pathname !== '/__accesskit/login') : null, status, {
    'Content-Type': html ? 'text/html; charset=utf-8' : 'text/plain',
    'X-Access-Kit-Decision': status === 401 ? 'unauthenticated' : 'denied',
    ...(settings.deploymentId ? { 'X-Access-Kit-Deployment': settings.deploymentId } : {}),
    ...([401, 403].includes(status) ? { 'Set-Cookie': clearCookie } : {}),
  });
}
function hasSignedOutCookie(request) {
  return (request.headers.get('Cookie') || '').split(';').some(value => value.trim() === signedOutCookie + '=1');
}
function isOAuthCallback(request,settings) {
  const url=new URL(request.url),state=url.searchParams.get('state');
  if(url.pathname!==new URL(settings.siteUrl).pathname||!state||(!url.searchParams.has('code')&&!url.searchParams.has('error')))return false;
  const expected='__Host-accesskit_oauth_state='+state;
  return (request.headers.get('Cookie')||'').split(';').some(value=>value.trim()===expected);
}
async function key(secret) {
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('ACCESS_KIT_SESSION_SECRET must contain at least 32 characters');
  if (keys.has(secret)) return keys.get(secret);
  if (keys.size >= 8) keys.delete(keys.keys().next().value);
  const imported = crypto.subtle.digest('SHA-256', encoder.encode(secret))
    .then(bytes => crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']))
    .catch(error => { keys.delete(secret); throw error; });
  keys.set(secret, imported);
  return imported;
}
function encode(bytes) { return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', ''); }
function decode(value) { return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0)); }
async function seal(session, secret, audience) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(audience) }, await key(secret), encoder.encode(JSON.stringify(session)));
  return `${encode(iv)}.${encode(new Uint8Array(encrypted))}`;
}
async function readSession(request, secret, audience) {
  const cookies = (request.headers.get('Cookie') || '').split(';').map(v => v.trim()).filter(v => v.startsWith(`${COOKIE}=`));
  if (cookies.length !== 1 || cookies[0].length > 4096) return null;
  try {
    const parts = cookies[0].slice(COOKIE.length + 1).split('.');
    if (parts.length !== 2) return null;
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(parts[0]), additionalData: encoder.encode(audience) }, await key(secret), decode(parts[1]));
    const session = JSON.parse(new TextDecoder().decode(plain));
    return typeof session.token === 'string' && Number.isFinite(session.expires) && session.expires > Date.now() ? session : null;
  } catch { return null; } // Untrusted or obsolete cookies never grant access.
}
async function verify(token, settings, diagnostic) {
  const verifiedAt = Date.now();
  try {
    const url = new URL('/me', settings.authOrigin);
    url.searchParams.set('client_id', settings.clientId);
    const result = await (settings.fetchAuth || fetch)(url, {
      headers: { ...(diagnostic || {}), Authorization: `Bearer ${token}`, ...(settings.accessPolicy === 'member' ? { 'X-Access-Kit-Require-Member': 'true' } : {}) },
      cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(30000),
    });
    if (result.status !== 200) {
      if (![401,403].includes(result.status)) console.warn('access-kit AUTH unavailable',{status:result.status,host:new URL(settings.authOrigin).host});
      return { status: [401, 403].includes(result.status) ? result.status : 503 };
    }
    const body = await result.json();
    if (body.ok !== true || body.data?.status !== 'active' || typeof body.data.id !== 'string' || !body.data.id || body.data.id.length > 256) return { status: 403 };
    if (body.application_access?.client_id !== settings.clientId || body.application_access?.allowed !== true
      || !['policy', 'manual_grant'].includes(body.application_access.source)) return { status: 403 };
    const manualGrant = body.application_access?.client_id === settings.clientId
      && body.application_access?.allowed === true && body.application_access?.source === 'manual_grant';
    if (settings.accessPolicy === 'member' && body.data?.membership?.is_member !== true && !manualGrant) return { status: 403 };
    if (settings.accessPolicy === 'admin' && body.data.membershipAdmin !== true) return { status: 403 };
    if (!Number.isFinite(body.expires_at) || body.expires_at <= Date.now()) return { status: 401 };
    const leaseUntil = Math.min(body.expires_at, verifiedAt + (settings.authorizationLeaseMs || AUTHORIZATION_LEASE_MS));
    if (leaseUntil <= Date.now()) return { status: 503 };
    return { status: 200, expires: body.expires_at, authorization: {
      clientId: settings.clientId, siteOrigin: new URL(settings.siteUrl).origin,
      authOrigin: settings.authOrigin, accessPolicy: settings.accessPolicy,
      userId: body.data.id, displayName: typeof body.data.display_name==='string'?body.data.display_name.slice(0,128):'', membershipAdmin:body.data.membershipAdmin===true, serviceDeveloper:body.data.serviceDeveloper===true, allowed: true, source: body.application_access.source,
      verifiedAt, leaseUntil,
    } };
  } catch(error) { console.warn('access-kit AUTH request failed',{type:error instanceof Error?error.name:'unknown',message:error instanceof Error?error.message:'unknown'});return { status: 503 }; }
}

// Isolate-local, bounded state. Valid encrypted leases never need remote storage.
const pendingChecks = new Map();
const completedChecks = new Map();
const revokedSessions = new Map();
function sessionId(token, settings) {
  return JSON.stringify([settings.authOrigin, settings.clientId, settings.siteUrl, settings.accessPolicy, token]);
}
function remember(map, id, value) {
  if (!map.has(id) && map.size >= 512) map.delete(map.keys().next().value);
  map.set(id, value);
}
function isRevoked(id) {
  const until = revokedSessions.get(id);
  if (until > Date.now()) return true;
  revokedSessions.delete(id);
  return false;
}
function verifyConcurrent(token, settings, fresh = false, diagnostic) {
  const id = sessionId(token, settings);
  if (isRevoked(id)) return Promise.resolve({ status: 401 });
  const cached = completedChecks.get(id);
  if (!fresh && cached?.authorization.leaseUntil > Date.now()
    && cached.authorization.leaseUntil <= cached.authorization.verifiedAt + (settings.authorizationLeaseMs || AUTHORIZATION_LEASE_MS)) return Promise.resolve(cached);
  completedChecks.delete(id);
  const pending = pendingChecks.get(id);
  if (pending) return pending;
  if (pendingChecks.size >= 256) return Promise.resolve({ status: 503 });
  const check = verify(token, settings, diagnostic).then(result => {
    // Logout may finish while /me is in flight: never resurrect that grant.
    if (isRevoked(id)) return { status: 401 };
    if (result.status === 200) remember(completedChecks, id, result);
    return result;
  }).finally(() => pendingChecks.delete(id));
  pendingChecks.set(id, check);
  return check;
}
function validAuthorization(session, settings) {
  const a = session.authorization;
  return session.version === 2 && a?.allowed === true
    && a.clientId === settings.clientId && a.siteOrigin === new URL(settings.siteUrl).origin
    && (a.authOrigin === settings.authOrigin || a.authOrigin === settings.authOrigin + '/') && a.accessPolicy === settings.accessPolicy
    && (settings.accessPolicy !== 'admin' || a.membershipAdmin === true)
    && typeof a.userId === 'string' && a.userId.length > 0 && a.userId.length <= 256
    && ['policy', 'manual_grant'].includes(a.source)
    && Number.isFinite(a.verifiedAt) && a.verifiedAt > 0 && a.verifiedAt <= Date.now()
    && Number.isFinite(a.leaseUntil) && a.leaseUntil > a.verifiedAt
    && a.leaseUntil <= a.verifiedAt + (settings.authorizationLeaseMs || AUTHORIZATION_LEASE_MS) && a.leaseUntil <= session.expires;
}
async function sessionCookie(session, secret, audience) {
  const cookie = await seal(session, secret, audience);
  return COOKIE + '=' + cookie + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' + Math.max(0, Math.floor((session.expires - Date.now()) / 1000));
}

export async function serveProtected(request, env, settings) {
  const url = new URL(request.url);
  // Only the explicitly registered deployment origin can serve protected content.
  if (url.origin !== new URL(settings.siteUrl).origin) return response(null, 403);
  if (['/__accesskit/diagnostics', '/__accesskit/diagnostics/ping'].includes(url.pathname)) {
    if (!['GET','HEAD'].includes(request.method)) return response(null,405);
    if (request.headers.get('Origin') && request.headers.get('Origin') !== url.origin) return response(null,403);
    if (request.headers.get('Sec-Fetch-Site') === 'cross-site' && url.pathname.endsWith('/ping')) return response(null,403);
    if (request.headers.has('Range')) return response(null,416);
    const ping = url.pathname.endsWith('/ping');
    return response(request.method === 'HEAD' ? null : ping ? JSON.stringify({ok:true,gate:RUNTIME_VERSION}) : diagnosticsPage({...settings,redirectUri:settings.siteUrl,sitePing:true}),200,{'Content-Type':ping?'application/json':'text/html; charset=utf-8','Referrer-Policy':'no-referrer',...(ping?{'Timing-Allow-Origin':url.origin}:{})});
  }
  if (typeof env.ACCESS_KIT_SESSION_SECRET !== 'string' || env.ACCESS_KIT_SESSION_SECRET.length < 32) return denied(request, 503, settings);
  const audience = `${url.origin}/${settings.clientId}`;
  const session = await readSession(request, env.ACCESS_KIT_SESSION_SECRET, audience);
  if (['/__accesskit/session', '/__accesskit/logout'].includes(url.pathname)) {
    if (request.method !== 'POST') return response(null, 405);
    if (request.headers.get('Origin') !== url.origin || request.headers.get('Sec-Fetch-Site') === 'cross-site') return response(null, 403);
    if (url.pathname.endsWith('/logout')) {
      let revoked = !session;
      if (session) {
        const id = sessionId(session.token, settings);
        remember(revokedSessions, id, session.expires);
        completedChecks.delete(id);
        try {
          const result = await (settings.fetchAuth || fetch)(new URL('/logout', settings.authOrigin), { method: 'POST', headers: { Authorization: `Bearer ${session.token}` }, redirect: 'manual', signal: AbortSignal.timeout(30000) });
          revoked = result.ok;
        } catch { revoked = false; }
      }
      const result = response(null, 204, { 'Set-Cookie': clearCookie, 'X-Access-Kit-Revoke': revoked ? 'confirmed' : 'failed' });
      result.headers.append('Set-Cookie', signedOutCookie + '=1' + cookieAttributes);
      return result;
    }
    if (request.headers.get('Content-Type')?.split(';')[0] !== 'application/json') return response(null, 415);
    // Bound the body before buffering it, including chunked requests.
    const reader = request.body?.getReader();
    if (!reader) return response(null, 400);
    const chunks = []; let length = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 8192) { await reader.cancel(); return response(null, 413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    let token;
    try { token = JSON.parse(new TextDecoder().decode(bytes)).access_token; } catch { return response(null, 400); }
    if (typeof token !== 'string' || token.length < 1 || token.length > 2048) return response(null, 400);
    const ref=request.headers.get('X-Access-Kit-Diagnostic-Reference'), cap=request.headers.get('X-Access-Kit-Diagnostic-Capability');
    const diagnostic=/^dg_[A-Za-z0-9_-]{24}$/.test(ref || '')&&/^[A-Za-z0-9_-]{43}$/.test(cap || '')?{'X-Access-Kit-Diagnostic-Reference':ref,'X-Access-Kit-Diagnostic-Capability':cap}:undefined;
    const checked = await verifyConcurrent(token, settings, true, diagnostic);
    if (checked.status !== 200) return denied(request, checked.status, settings);
    const expires = Math.min(checked.expires, Date.now() + (settings.sessionMaxAgeSeconds || 3600)*1000);
    const authorization = { ...checked.authorization, leaseUntil: Math.min(checked.authorization.leaseUntil, expires) };
    const cookie = await sessionCookie({ version: 2, token, expires, authorization }, env.ACCESS_KIT_SESSION_SECRET, audience);
    if (isRevoked(sessionId(token, settings))) return denied(request, 401, settings);
    const result = response(null, 204, { 'Set-Cookie': cookie });
    if (hasSignedOutCookie(request)) result.headers.append('Set-Cookie', signedOutCookie + '=' + cookieAttributes + '; Max-Age=0');
    return result;
  }
  // Existing applications own their API method/CSRF policy. Authentication must
  // run before dispatch, but must not discard their POST/PUT/DELETE handlers.
  if (url.pathname === '/__accesskit/login' || isOAuthCallback(request,settings)) return denied(request, 401, settings);
  if (!session) return denied(request, 401, settings);
  if (isRevoked(sessionId(session.token, settings))) return denied(request, 401, settings);
  // Only the previously shipped token-only format can migrate via central validation.
  const legacy = session.version === undefined && session.authorization === undefined;
  if (!legacy && !validAuthorization(session, settings)) return denied(request, 403, settings);
  let renewedCookie;
  let authorization=session.authorization;
  if (legacy || session.authorization.leaseUntil <= Date.now()) {
    const checked = await verifyConcurrent(session.token, settings);
    if (checked.status !== 200) return denied(request, checked.status, settings);
    const expires = Math.min(session.expires, checked.expires);
    if (expires <= Date.now()) return denied(request, 401, settings);
    authorization = { ...checked.authorization, leaseUntil: Math.min(checked.authorization.leaseUntil, expires) };
    renewedCookie = await sessionCookie({ version: 2, token: session.token, expires, authorization }, env.ACCESS_KIT_SESSION_SECRET, audience);
  }
  if (isRevoked(sessionId(session.token, settings))) return denied(request, 401, settings);
  const identity=Object.freeze({id:authorization.userId,displayName:authorization.displayName || '',membershipAdmin:authorization.membershipAdmin===true,serviceDeveloper:authorization.serviceDeveloper===true});
  const asset = await env.ASSETS.fetch(request, identity);
  const headers = new Headers(asset.headers);
  // Conditional requests also require a valid authorization lease before returning 304.
  headers.set('Cache-Control', asset.headers.has('ETag') && [200, 304].includes(asset.status)
    ? 'private, no-cache, max-age=0, must-revalidate' : 'private, no-store, max-age=0');
  headers.set('Vary', [headers.get('Vary'), 'Cookie'].filter(Boolean).join(', '));
  if (renewedCookie) headers.append('Set-Cookie', renewedCookie);
  headers.set('X-Access-Kit-Gate', 'v1');
  headers.set('X-Access-Kit-Runtime', RUNTIME_VERSION);
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(asset.body, { status: asset.status, headers });
}

// Public server API: hosts provide only their secret and protected content handler.
export function createGate(settings) {
  const config = { provider:'firebase', authorizationLeaseMs:300000, sessionMaxAgeSeconds:604800, ...settings };
  for (const name of ['siteUrl', 'authOrigin']) {
    const url = new URL(config[name]);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error(`${name} must be HTTPS`);
    config[name] = name === 'authOrigin' ? url.origin : url.href;
  }
  if (!config.clientId || !['member', 'guest', 'admin'].includes(config.accessPolicy)) throw new Error('clientId and accessPolicy are required');
  if(config.authorizationLeaseMs!==undefined && (!Number.isInteger(config.authorizationLeaseMs)||config.authorizationLeaseMs<1000||config.authorizationLeaseMs>AUTHORIZATION_LEASE_MS))throw new Error('authorizationLeaseMs must be 1000..3600000');
  if(config.sessionMaxAgeSeconds!==undefined && (!Number.isInteger(config.sessionMaxAgeSeconds)||config.sessionMaxAgeSeconds<60||config.sessionMaxAgeSeconds>604800))throw new Error('sessionMaxAgeSeconds must be 60..604800');
  if(config.deploymentId!==undefined && !/^[a-f0-9]{32}$/.test(config.deploymentId))throw new Error('Invalid deploymentId');
  Object.freeze(config);
  return (request, { sessionSecret, serveAsset, fetchAuth }) => serveProtected(request, {
    ACCESS_KIT_SESSION_SECRET: sessionSecret,
    ASSETS: { fetch: serveAsset },
  }, fetchAuth ? { ...config, fetchAuth } : config);
}
