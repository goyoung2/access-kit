import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,access} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {initAuth,doctorAuth,bootstrapSql} from '../bin/auth-project.mjs';

async function fixture(){
 const cwd=await mkdtemp(join(tmpdir(),'access-kit-auth-init-')),templateDirectory=join(cwd,'template');await mkdir(join(templateDirectory,'migrations'),{recursive:true});
 const files={'worker.mjs':'export default {fetch(){return new Response("fixture")}};', 'migrations/0001_fixture.sql':'CREATE TABLE users(id TEXT);'};
 for(const [name,bytes] of Object.entries(files))await writeFile(join(templateDirectory,name),bytes);
 await writeFile(join(templateDirectory,'template.json'),JSON.stringify({schema:1,files:Object.fromEntries(Object.entries(files).map(([name,bytes])=>[name,createHash('sha256').update(bytes).digest('hex')]))}));
 const values={directory:'own-auth',name:'bangju-auth','auth-origin':'https://bangju-auth.test','firebase-project-id':'bangju-project','firebase-api-key':'public-fixture-key','firebase-auth-domain':'bangju-project.firebaseapp.com','firebase-app-id':'fixture-app'};
 return {cwd,templateDirectory,values};
}

test('independent auth plan creates no files; init pins a separate server without overwriting existing files',async()=>{
 const f=await fixture(),plan=await initAuth({...f.values,plan:true},f);assert.equal(plan.remoteChanges,false);
 await assert.rejects(access(join(f.cwd,'own-auth')));
 const result=await initAuth(f.values,f);assert.equal(result.mode,'independent');
 const config=JSON.parse(await readFile(join(result.directory,'wrangler.jsonc'),'utf8'));assert.equal(config.vars.FIREBASE_PROJECT_ID,'bangju-project');assert.equal(config.vars.AUTH_ORIGIN,'https://bangju-auth.test');
 assert.equal(config.d1_databases[0].database_name,'bangju-auth');assert.equal(config.main,'worker.mjs');
 await assert.rejects(initAuth(f.values,f),/덮어쓰지/);
 assert.equal((await doctorAuth({...f.values,local:true},f)).remoteReady,false);
 await assert.rejects(doctorAuth(f.values,f),/D1/);
 config.d1_databases[0].database_id='11111111-2222-4333-8444-555555555555';await writeFile(join(result.directory,'wrangler.jsonc'),JSON.stringify(config));
 assert.equal((await doctorAuth(f.values,f)).remoteReady,true);
 await writeFile(join(result.directory,'worker.mjs'),'changed');await assert.rejects(doctorAuth({...f.values,local:true},f),/변경/);
});

test('independent scaffolding rejects corrupt packages and paths outside the installing project before writing',async()=>{
 const f=await fixture();await assert.rejects(initAuth({...f.values,directory:'../outside'},f),/하위 폴더/);
 await writeFile(join(f.templateDirectory,'worker.mjs'),'tampered');await assert.rejects(initAuth(f.values,f),/무결성/);
 await assert.rejects(access(join(f.cwd,'own-auth')));
});

test('bootstrap query scopes the first operator to the specified Firebase project and safely quotes an arbitrary UID',()=>{
 const query=bootstrapSql('bangju-project',"uid' OR 1=1 --");
 assert.ok(query.includes("'uid'' OR 1=1 --'"));assert.ok(query.includes("'firebase:bangju-project'"));
 assert.throws(()=>bootstrapSql('bangju-project','bad\nuid'));
});
