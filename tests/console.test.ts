import test from 'node:test';
import assert from 'node:assert/strict';
import {createAuthFixture} from './auth-fixture';
import {createSession} from '../src/store';
import app from '../src/index';
import {consolePage} from '../src/console-ui';

test('console runtime script parses and login contains no management navigation',async t=>{
 new Function(consolePage().split('<script type="module">')[1].split('</script>')[0]);
 const f=await createAuthFixture();t.after(f.dispose);
 const r=await app.request('https://auth.test/auth/firebase',{},f.env);const html=await r.text();
 assert.equal(html.includes('id="admin"'),false);assert.equal(html.includes('href="/developer'),false);
});

test('console roles preserve membership, enforce scope and prevent self or last operator removal',async t=>{
 const f=await createAuthFixture();t.after(f.dispose);
 await f.DB.batch([f.DB.prepare("INSERT INTO auth_operators VALUES('user','operator',0,NULL)"),f.DB.prepare("INSERT INTO users VALUES('staff','Staff',NULL,'active',0,0),('applicant','Applicant',NULL,'active',0,0)"),f.DB.prepare("INSERT INTO member_organizations VALUES('own','Own'),('other','Other')"),f.DB.prepare("INSERT INTO member_seasons VALUES('s','Season','active')"),f.DB.prepare("INSERT INTO member_applications VALUES('applicant','kr','77','Nick','pending',0,NULL,NULL)")]);
 const owner=await createSession(f.env,'user'),staff=await createSession(f.env,'staff');
 const req=(token:string,path:string,body?:unknown)=>app.request('https://auth.test/console/'+path,{method:body?'POST':'GET',headers:{Cookie:'accesskit_sid='+token,Origin:'https://auth.test','X-Access-Kit-Action':'1','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})},f.env);
 assert.equal((await req(staff.token,'data')).status,403);
 assert.equal((await req(owner.token,'role',{userId:'staff',role:'manager',organizationId:'own',enabled:true})).status,200);
 assert.equal((await req(staff.token,'data')).status,200);
 assert.equal(await f.DB.prepare("SELECT * FROM common_members WHERE user_id='staff'").first(),null);
 assert.equal((await req(staff.token,'role',{userId:'staff',role:'superadmin',enabled:true})).status,403);
 assert.equal((await req(staff.token,'membership',{action:'approve',userId:'applicant',seasonId:'s',organizationId:'other'})).status,403);
 assert.equal((await req(staff.token,'membership',{action:'approve',userId:'applicant',seasonId:'s',organizationId:'own'})).status,200);
 assert.equal((await req(staff.token,'membership',{action:'member',userId:'applicant',status:'suspended'})).status,403);
 assert.equal((await req(owner.token,'role',{userId:'staff',role:'manager',organizationId:'own',enabled:false})).status,200);
 assert.equal((await req(staff.token,'data')).status,403);
 assert.equal((await req(owner.token,'role',{userId:'user',role:'superadmin',enabled:false})).status,409);
 await assert.rejects(()=>f.DB.prepare("DELETE FROM auth_operators WHERE user_id='user'").run(),/LAST_OPERATOR/);
 assert.equal((await req(owner.token,'role',{userId:'staff',role:'superadmin',enabled:true})).status,200);
 assert.equal((await req(staff.token,'data')).status,200);
 assert.equal((await req(owner.token,'role',{userId:'staff',role:'superadmin',enabled:false})).status,200);
 assert.equal((await req(staff.token,'data')).status,403);
});

test('branding is owner scoped and service login uses validated branding',async t=>{
 const f=await createAuthFixture();t.after(f.dispose);const s=await createSession(f.env,'user');
 await f.DB.batch([f.DB.prepare("INSERT INTO developers VALUES('user','active')"),f.DB.prepare("INSERT INTO application_owners VALUES('site','user')")]);
 const input={clientId:'site',title:'Member Hub',description:'Welcome',logoUrl:'',accent:'#4657cf',theme:'light'};
 const post=(body:unknown)=>app.request('https://auth.test/console/branding',{method:'POST',headers:{Cookie:'accesskit_sid='+s.token,Origin:'https://auth.test','X-Access-Kit-Action':'1','Content-Type':'application/json'},body:JSON.stringify(body)},f.env);
 assert.equal((await post(input)).status,200);assert.equal((await post({...input,clientId:'other'})).status,403);
 assert.equal((await post({...input,logoUrl:'javascript:alert(1)'})).status,400);
 const publicBrand=await app.request('https://auth.test/public/branding?client_id=site',{},f.env);assert.equal((await publicBrand.json()).title,'Member Hub');
 const request='https://auth.test/authorize?'+new URLSearchParams({client_id:'site',redirect_uri:'https://site.test/',response_type:'code',code_challenge:'a'.repeat(43),code_challenge_method:'S256',state:'b'.repeat(24)});
 const auth=await app.request(request,{},f.env);const html=await(await app.request('https://auth.test'+auth.headers.get('location'),{},f.env)).text();assert.match(html,/Member Hub/);assert.equal(html.includes('id="admin"'),false);
});
