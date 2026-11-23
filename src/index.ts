import {Hono} from 'hono';
import {z} from 'zod';
import type {Env} from './types';
import {registerCommonRoutes} from './common-routes';
import {MutationConflict} from './atomic-mutation';
import {registerConsole} from './console';
import {registerDeveloperRoutes} from './developer';
import {registerDeveloperRosters,DeveloperRosterError} from './developer-rosters';
import {randomToken} from './crypto';
import {getApplication,isAllowedRedirect,isAllowedOrigin,parseCookies} from './http';
import {findSessionUser,exchangeAuthorizationCode,revokeAccessToken,cleanupExpiredAuthData} from './store';
import {inspectApplicationTokenAccess} from './policy';
import browserSource from './browser-source';
import legacyBrowserSource from './browser-source-v010';
import {publicGuidePage} from './guide-page';
import {installationInstructions} from './llm-instructions';
import {registerServiceAdministrators} from './service-administrators';
import {registerPermissionReservations} from './permission-reservations';

const app=new Hono<{Bindings:Env}>();
app.use('*',async(c,next)=>{
 c.header('X-Robots-Tag','noindex, nofollow, noarchive');
 c.header('X-Content-Type-Options','nosniff');
 c.header('Referrer-Policy','no-referrer');
 c.header('Cache-Control','no-store');
 const publicGuide=['/guide','/guide/llm'].includes(c.req.path)&&(c.req.method==='GET'||c.req.method==='HEAD');
 if(!publicGuide&&c.env.AUTH_PROVIDER!=='firebase')return c.json({error:'FIREBASE_CONFIGURATION_REQUIRED'},503);
 await next();
});
app.onError((error,c)=>{
 if(error instanceof DeveloperRosterError)return c.json({error:error.message},error.status);
 if(error instanceof MutationConflict)return c.json({error:error.message},409);
 if(error instanceof z.ZodError)return c.json({error:'INVALID_INPUT'},400);
 console.error('access-kit request failed',{type:error.name,path:c.req.path});
 return c.json({error:'SERVICE_UNAVAILABLE'},503);
});
registerConsole(app);
registerCommonRoutes(app);
registerDeveloperRoutes(app);
registerDeveloperRosters(app);
registerServiceAdministrators(app);
registerPermissionReservations(app);
app.get('/',c=>c.redirect('/auth/firebase'));
app.get('/guide',c=>c.html(publicGuidePage()));
app.get('/guide/llm',c=>c.text(installationInstructions(new URL(c.req.url).origin,c.req.query())));
app.get('/robots.txt',c=>c.text('User-agent: *\nDisallow: /\n'));
app.get('/api/health',c=>c.json({ok:true,service:'access-kit',version:'0.6.1'}));
// The browser runtime contains no member data, keys, or fixed authentication host.
app.get('/sdk/v0.1.0/access-kit.js',c=>new Response(legacyBrowserSource,{headers:{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'public, max-age=31536000, immutable','Access-Control-Allow-Origin':'*','X-Robots-Tag':'noindex'}}));
app.get('/sdk/v0.3.1/access-kit.js',c=>new Response(browserSource,{headers:{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'public, max-age=31536000, immutable','Access-Control-Allow-Origin':'*','X-Robots-Tag':'noindex'}}));
for(const route of ['/token','/me','/logout'])app.use(route,async(c,next)=>{
 const origin=c.req.header('Origin');
 if(origin){
  const application=await getApplication(c.env,c.req.query('client_id')||'');
  if(!application||!isAllowedOrigin(application,origin))return c.json({error:'ORIGIN_DENIED'},403);
  c.header('Access-Control-Allow-Origin',origin);c.header('Vary','Origin');
  c.header('Access-Control-Allow-Headers','Content-Type, Authorization');
  c.header('Access-Control-Allow-Methods','GET, POST, OPTIONS');
 }
 if(c.req.method==='OPTIONS')return c.body(null,204);
 await next();
});
const authorizeInput=z.object({client_id:z.string().min(1).max(128),redirect_uri:z.url(),response_type:z.literal('code'),code_challenge:z.string().regex(/^[A-Za-z0-9_-]{43}$/),code_challenge_method:z.literal('S256'),state:z.string().min(16).max(256)});
app.get('/authorize',async c=>{
 const input=authorizeInput.parse(c.req.query());
 const application=await getApplication(c.env,input.client_id);
 if(!application||!isAllowedRedirect(application,input.redirect_uri))return c.json({error:'INVALID_CLIENT'},400);
 const id=randomToken(24),now=Date.now();
 await c.env.DB.prepare('INSERT INTO oauth_requests VALUES(?,?,?,?,?,?,?)').bind(id,input.client_id,input.redirect_uri,input.code_challenge,input.state,now+600000,now).run();
 return c.redirect('/auth/firebase'+(await findSessionUser(c.env,parseCookies(c.req.header('Cookie')).accesskit_sid)?'/continue':'')+'?request='+encodeURIComponent(id));
});
const tokenInput=z.object({grant_type:z.literal('authorization_code'),client_id:z.string(),redirect_uri:z.url(),code:z.string().min(1).max(256),code_verifier:z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/)});
app.post('/token',async c=>{
 const b=tokenInput.parse(await c.req.json());
 if(b.client_id!==c.req.query('client_id'))return c.json({error:{code:'CLIENT_ID_MISMATCH'}},400);
 const application=await getApplication(c.env,b.client_id);
 if(!application||!isAllowedRedirect(application,b.redirect_uri))return c.json({error:{code:'INVALID_CLIENT'}},400);
 try{
  const token=await exchangeAuthorizationCode(c.env,{code:b.code,clientId:b.client_id,redirectUri:b.redirect_uri,codeVerifier:b.code_verifier});
  return c.json({access_token:token.accessToken,token_type:'Bearer',expires_in:token.expiresIn});
 }catch(error){
  if(error instanceof Error&&/^(INVALID_OR_EXPIRED_CODE|CODE_CLIENT_MISMATCH|PKCE_VERIFICATION_FAILED|ACCESS_DENIED|SESSION_EXPIRED)$/.test(error.message))return c.json({error:{code:error.message}},400);
  throw error;
 }
});
app.get('/me',async c=>{
 const token=c.req.header('Authorization')?.match(/^Bearer (.+)$/)?.[1],client=c.req.query('client_id')||'';
 if(!token)return c.json({error:'LOGIN_REQUIRED'},401);
 const snapshot=await inspectApplicationTokenAccess(c.env,token,client);
 if(!snapshot?.tokenExpiresAt)return c.json({error:'INVALID_TOKEN'},401);
 if(!snapshot.access.allowed)return c.json({error:'ACCESS_DENIED'},403);
 return c.json({ok:true,data:snapshot.user,expires_at:snapshot.tokenExpiresAt,application_access:{client_id:client,allowed:true,source:'policy'}});
});
app.post('/logout',async c=>{
 const token=c.req.header('Authorization')?.match(/^Bearer (.+)$/)?.[1];
 if(token)await revokeAccessToken(c.env,token);
 return c.json({ok:true});
});
export default Object.assign(app,{scheduled(_controller:ScheduledController,env:Env,ctx:ExecutionContext){ctx.waitUntil(cleanupExpiredAuthData(env));}});
