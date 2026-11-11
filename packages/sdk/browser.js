export const VERSION='0.1.0';
const b64=bytes=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
export class AccessKitClient {
 constructor(settings){
  this.settings=settings; this.fetch=settings.fetchImpl||globalThis.fetch.bind(globalThis);
  if(!settings.clientId||!settings.authOrigin||!settings.redirectUri)throw Error('clientId, authOrigin, redirectUri required');
  const origin=new URL(settings.authOrigin);if(origin.protocol!=='https:')throw Error('HTTPS required');
  this.key='access-kit:'+settings.clientId;this.token=null;
 }
 clearLocalState(){sessionStorage.removeItem(this.key);this.token=null;}
 clearDeniedLogin(){this.clearLocalState();}
 getAccessToken(){return this.token;}
 async login(){
  const verifier=b64(crypto.getRandomValues(new Uint8Array(32))),state=b64(crypto.getRandomValues(new Uint8Array(24)));
  const challenge=b64(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));
  sessionStorage.setItem(this.key,JSON.stringify({verifier,state,at:Date.now()}));
  const url=new URL('/authorize',this.settings.authOrigin);
  for(const[k,v]of Object.entries({client_id:this.settings.clientId,redirect_uri:this.settings.redirectUri,response_type:'code',code_challenge:challenge,code_challenge_method:'S256',state}))url.searchParams.set(k,v);
  location.assign(url.href);
 }
 async bootstrap(){
  const params=new URLSearchParams(location.search);if(!params.has('state'))return null;
  const raw=sessionStorage.getItem(this.key);sessionStorage.removeItem(this.key);
  const saved=raw?JSON.parse(raw):null;
  const clean=new URL(location.href);for(const k of ['code','state','error','error_description'])clean.searchParams.delete(k);history.replaceState(null,'',clean);
  if(!saved||saved.state!==params.get('state')||Date.now()-saved.at>600000)throw Error('로그인 요청이 만료되었습니다. 다시 로그인해 주세요.');
  if(params.has('error'))throw Error(params.get('error'));
  const url=new URL('/token',this.settings.authOrigin);url.searchParams.set('client_id',this.settings.clientId);
  const r=await this.fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({grant_type:'authorization_code',client_id:this.settings.clientId,redirect_uri:this.settings.redirectUri,code:params.get('code'),code_verifier:saved.verifier})});
  const body=await r.json();if(!r.ok||!body.access_token)throw Error(body.error?.code||'로그인하지 못했습니다.');this.token=body.access_token;return {authenticated:true};
 }
}
