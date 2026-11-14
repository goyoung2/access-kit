import type {Hono,Context} from 'hono';
import {z} from 'zod';
import type {Env,OAuthRequestRow} from './types';
import {randomToken,sha256Base64Url} from './crypto';
import {parseCookies,sessionCookie,redirectWithParams} from './http';
import {findSessionUser,createSession,createAuthorizationCode} from './store';
import {isPlatformAdmin,diagnoseApplicationAccess} from './policy';
import {verifyGoogleIdentity,InvalidGoogleIdentity} from './firebase-identity';
import {adminAction,mutateMembership,membershipOverview,MembershipConflict} from './common-admin';
import {commonPage} from './common-ui';
import {getBranding,escapeHtml} from './branding';
import {getApplication,isAllowedRedirect} from './http';

type C=Context<{Bindings:Env}>;
const identityInput=z.object({idToken:z.string().min(1).max(16384)});
const applicationInput=z.object({nickname:z.string().trim().min(1).max(40),gameUid:z.string().regex(/^\d{1,32}$/)});
async function current(c:C){return findSessionUser(c.env,parseCookies(c.req.header('Cookie')).accesskit_sid);}
async function requestRow(c:C){
 return c.env.DB.prepare('SELECT * FROM oauth_requests WHERE id=? AND expires_at>?')
  .bind(c.req.query('request')||'',Date.now()).first<OAuthRequestRow>();
}
export function registerCommonRoutes(app:Hono<{Bindings:Env}>,verify=verifyGoogleIdentity){
 app.use('/auth/firebase*',async(c,next)=>{
  c.header('Cache-Control','no-store');c.header('X-Frame-Options','DENY');c.header('Referrer-Policy','no-referrer');
  if(c.env.AUTH_PROVIDER!=='firebase')return c.json({error:'NOT_ENABLED'},404);
  if(c.req.method==='POST'&&(c.req.header('Origin')!==new URL(c.req.url).origin || c.req.header('X-Access-Kit-Action')!=='1'))return c.json({error:'ORIGIN_DENIED'},403);
  try{await next();}catch(error){
   if(error instanceof z.ZodError)return c.json({error:'입력 내용을 확인해 주세요.'},400);
   if(error instanceof MembershipConflict)return c.json({error:error.message},409);
   throw error;
  }
 });
 app.get('/auth/firebase',async c=>{const r=await requestRow(c);return c.html(commonPage(false,'',await getBranding(c.env,r?.client_id||''),c.req.query('console')==='1'||c.req.query('admin')==='1'));});
 app.get('/auth/firebase/admin',async c=>{
  const user=await current(c);
  if(!user)return c.redirect('/auth/firebase?admin=1');
  if(!await isPlatformAdmin(c.env,user))return c.text('관리자 권한이 필요합니다.',403);
  return c.redirect('/console');
 });
 app.get('/auth/firebase/config',c=>c.json({apiKey:c.env.FIREBASE_API_KEY,projectId:c.env.FIREBASE_PROJECT_ID,authDomain:c.env.FIREBASE_AUTH_DOMAIN,appId:c.env.FIREBASE_APP_ID}));
 app.post('/auth/firebase/session',async c=>{
  const body=identityInput.parse(await c.req.json());
  if(!c.env.FIREBASE_PROJECT_ID)return c.json({error:'AUTH_NOT_CONFIGURED'},503);
  let identity;
  try{identity=await verify(body.idToken,c.env.FIREBASE_PROJECT_ID);}catch(error){
   if(error instanceof InvalidGoogleIdentity)return c.json({error:'Google 로그인을 다시 진행해 주세요.'},401);
   console.error('Google identity verification unavailable',error instanceof Error?error.name:'unknown');
   return c.json({error:'인증 서버 연결을 확인하지 못했습니다. 다시 시도해 주세요.'},503);
  }
  const provider='firebase:'+c.env.FIREBASE_PROJECT_ID,now=Date.now();
  const linked=await c.env.DB.prepare('SELECT user_id FROM auth_identities WHERE provider=? AND provider_user_id=?').bind(provider,identity.sub).first<{user_id:string}>();
  let userId=linked?.user_id;
  if(!userId){
   userId='usr_'+randomToken(18);
   await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO users SELECT ?,?,NULL,'active',?,? WHERE NOT EXISTS(SELECT 1 FROM auth_identities WHERE provider=? AND provider_user_id=?)").bind(userId,identity.name||identity.email,now,now,provider,identity.sub),
    c.env.DB.prepare('INSERT INTO auth_identities SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM users WHERE id=?) ON CONFLICT(provider,provider_user_id) DO NOTHING').bind('id_'+randomToken(18),userId,provider,identity.sub,now,now,userId),
   ]);
   const resolved=await c.env.DB.prepare('SELECT user_id FROM auth_identities WHERE provider=? AND provider_user_id=?').bind(provider,identity.sub).first<{user_id:string}>();
   if(!resolved)throw new Error('Identity creation did not persist');
   userId=resolved.user_id;
  }
  const user=await c.env.DB.prepare("SELECT id FROM users WHERE id=? AND status='active'").bind(userId).first();
  if(!user)return c.json({error:'이용이 제한된 계정입니다.'},403);
  const session=await createSession(c.env,userId);
  c.header('Set-Cookie',sessionCookie(session.token,true,session.maxAgeSeconds));
  return c.json({ok:true});
 });
 app.get('/auth/firebase/status',async c=>{
  const userId=await current(c);if(!userId)return c.json({loggedIn:false});
  const user=await c.env.DB.prepare('SELECT display_name,status FROM users WHERE id=?').bind(userId).first();
  if(!user||user.status!=='active')return c.json({loggedIn:true,user,blocked:true,consoleAccess:false});
  const member=await c.env.DB.prepare('SELECT status FROM common_members WHERE user_id=?').bind(userId).first();
  const application=await c.env.DB.prepare('SELECT nickname,realm,game_uid,status FROM member_applications WHERE user_id=?').bind(userId).first();
  const admin=await isPlatformAdmin(c.env,userId);
  const manager=await c.env.DB.prepare('SELECT user_id FROM member_managers WHERE user_id=? LIMIT 1').bind(userId).first();
  const developer=await c.env.DB.prepare("SELECT user_id FROM developers WHERE user_id=? AND status='active'").bind(userId).first();
  const request=await requestRow(c);
  const serviceAccess=request?await diagnoseApplicationAccess(c.env,userId,request.client_id):null;
  return c.json({loggedIn:true,user,member,application,admin,serviceAccess,requestExpired:Boolean(c.req.query('request'))&&!request,consoleAccess:admin||Boolean(manager)||Boolean(developer)});
 });
 app.post('/auth/firebase/apply',async c=>{
  const userId=await current(c);if(!userId)return c.json({error:'LOGIN_REQUIRED'},401);
  const user=await c.env.DB.prepare("SELECT id FROM users WHERE id=? AND status='active'").bind(userId).first();
  if(!user)return c.json({error:'ACCESS_DENIED'},403);
  const member=await c.env.DB.prepare('SELECT user_id FROM common_members WHERE user_id=?').bind(userId).first();
  if(member)return c.json({error:'이미 등록된 회원입니다.'},409);
  const b=applicationInput.parse(await c.req.json());
  const gameUid=b.gameUid.replace(/^0+(?=\d)/,'');
  // Keep legacy account/roster keys without asking applicants to select a server.
  // Deleted roster entries are included so an exclusion cannot be bypassed by a new namespace.
  const known=await c.env.DB.prepare('SELECT realm FROM game_accounts WHERE game_uid=? UNION SELECT realm FROM roster_entries WHERE game_uid=? UNION SELECT realm FROM member_applications WHERE game_uid=?')
   .bind(gameUid,gameUid,gameUid).all<{realm:string}>();
  if(known.results.length>1)return c.json({error:'이 CID의 명부 정보가 중복되어 있습니다. 관리자에게 확인을 요청해 주세요.'},409);
  const realm=known.results[0]?.realm??'kr';
  const result=await c.env.DB.prepare(`INSERT INTO member_applications VALUES(?,?,?,?,'pending',?,NULL,NULL)
   ON CONFLICT(user_id) DO UPDATE SET realm=excluded.realm,game_uid=excluded.game_uid,nickname=excluded.nickname,status='pending',requested_at=excluded.requested_at,reviewed_at=NULL,reviewed_by=NULL WHERE member_applications.status='rejected'`)
   .bind(userId,realm,gameUid,b.nickname.normalize('NFC'),Date.now()).run();
  if(result.meta.changes!==1)return c.json({error:'이미 승인 대기 중입니다.'},409);
  return c.json({ok:true});
 });
 app.get('/auth/firebase/continue',async c=>{
  const userId=await current(c),r=await requestRow(c);
  if(!userId)return c.redirect('/auth/firebase?request='+encodeURIComponent(c.req.query('request')||''));
  if(!r){
   const expired=await c.env.DB.prepare('SELECT * FROM oauth_requests WHERE id=?').bind(c.req.query('request')||'').first<OAuthRequestRow>();
   const application=expired?await getApplication(c.env,expired.client_id):null;
   const returnUrl=expired&&application&&isAllowedRedirect(application,expired.redirect_uri)?expired.redirect_uri:null;
   return c.html(`<!doctype html><html lang="ko"><meta name="viewport" content="width=device-width,initial-scale=1"><title>다시 로그인</title><main><h1>로그인을 다시 시작해 주세요.</h1>${returnUrl?'<a href="'+escapeHtml(returnUrl)+'">서비스로 돌아가기</a>':'<a href="/auth/firebase">로그인 화면으로</a>'}</main></html>`,400);
  }
  const access=await diagnoseApplicationAccess(c.env,userId,r.client_id);
  if(!access.allowed)return c.html(commonPage(false,'',await getBranding(c.env,r.client_id)));
  const sid=parseCookies(c.req.header('Cookie')).accesskit_sid;
  const session=await c.env.DB.prepare('SELECT expires_at FROM auth_sessions WHERE token_hash=?').bind(await sha256Base64Url(sid)).first<{expires_at:number}>();
  if(!session)return c.text('로그인해 주세요.',401);
  const code=await createAuthorizationCode(c.env,userId,r.client_id,r.redirect_uri,r.code_challenge,session.expires_at);
  await c.env.DB.prepare('DELETE FROM oauth_requests WHERE id=?').bind(r.id).run();
  return c.redirect(redirectWithParams(r.redirect_uri,{code,state:r.client_state}));
 });
 app.get('/auth/firebase/admin/data',async c=>{
  const user=await current(c);if(!user||!await isPlatformAdmin(c.env,user))return c.json({error:'ADMIN_REQUIRED'},403);
  return c.json(await membershipOverview(c.env));
 });
 app.post('/auth/firebase/admin/action',async c=>{
  const user=await current(c);if(!user||!await isPlatformAdmin(c.env,user))return c.json({error:'ADMIN_REQUIRED'},403);
  await mutateMembership(c.env,user,adminAction.parse(await c.req.json()));return c.json({ok:true});
 });
}
