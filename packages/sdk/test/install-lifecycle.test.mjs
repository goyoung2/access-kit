import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const cli=fileURLToPath(new URL('../bin/access-kit.mjs',import.meta.url));
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'ak-lifecycle-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'build'));await writeFile(join(root,'build/index.html'),'private');return {root,run:(...args)=>execFileSync(process.execPath,[cli,...args],{cwd:root,stdio:'pipe'}).toString()};}
const init=['init','--client-id','site','--site-url','https://site.test/','--auth-origin','https://auth.test'];
test('config only is not a valid installation',async t=>{const {root,run}=await fixture(t);await writeFile(join(root,'access-kit.json'),JSON.stringify({clientId:'site',siteUrl:'https://site.test/',authOrigin:'https://auth.test',accessPolicy:'member'}));assert.throws(()=>run('doctor'));});
test('existing Worker bindings, routes, exports and source survive installation and sync',async t=>{
 const {root,run}=await fixture(t);const source='export class Counter {}\nexport default {fetch(){return new Response("API")},scheduled(){}}';await writeFile(join(root,'app.mjs'),source);
 const original={name:'existing-app',main:'app.mjs',compatibility_date:'2026-08-24',assets:{directory:'build',binding:'FILES'},vars:{LABEL:'preserved'},d1_databases:[{binding:'DB',database_id:'id',database_name:'db'}],triggers:{crons:['0 0 * * *']},routes:['example.com/*']};
 const text=JSON.stringify(original);await writeFile(join(root,'wrangler.jsonc'),text);run(...init);
 assert.equal(await readFile(join(root,'wrangler.jsonc'),'utf8'),text);assert.equal(await readFile(join(root,'app.mjs'),'utf8'),source);
 const config=JSON.parse(await readFile(join(root,'wrangler.access-kit.json'),'utf8'));
 for(const k of ['name','vars','d1_databases','triggers','routes'])assert.deepEqual(config[k],original[k]);
 assert.equal(config.assets.run_worker_first,true);assert.equal(config.assets.binding,'FILES');
 const wrapper=await readFile(join(root,'access-kit.worker.mjs'),'utf8');assert.match(wrapper,/export \* from "\.\/app.mjs"/);assert.match(wrapper,/original.fetch.call/);
 original.vars.LABEL='changed';await writeFile(join(root,'wrangler.jsonc'),JSON.stringify(original));assert.throws(()=>run('doctor'));run('sync');run('doctor');
 assert.equal(JSON.parse(await readFile(join(root,'wrangler.access-kit.json'),'utf8')).vars.LABEL,'changed');
 await rm(join(root,'access-kit.worker.mjs'));assert.throws(()=>run('doctor'));
});
test('Pages protects every asset and detects build overwriting route coverage',async t=>{const {root,run}=await fixture(t);run(...init,'--hosting','pages','--assets','build');run('doctor');await writeFile(join(root,'build/_routes.json'),JSON.stringify({version:1,include:['/*'],exclude:['/private.json']}));assert.throws(()=>run('doctor'));run('prepare');run('doctor');});
test('dry plan leaves existing project untouched',async t=>{const {root,run}=await fixture(t);run(...init,'--assets','build','--plan');await assert.rejects(readFile(join(root,'access-kit.json')));});
test('update rejects incorrect archive hash before modifying dependencies',async t=>{const {root,run}=await fixture(t);run(...init,'--assets','build');await writeFile(join(root,'fake.tgz'),'invalid');assert.throws(()=>run('update','--package','fake.tgz','--sha256','0'.repeat(64)));await assert.rejects(readFile(join(root,'package.json')));});
test('Pages rejects advanced Worker files and directories before prepare, doctor or deploy',async t=>{
 const {root,run}=await fixture(t);run(...init,'--hosting','pages','--assets','build');
 await writeFile(join(root,'package.json'),'{}');
 const worker=join(root,'build/_worker.js');
 for(const kind of ['file','directory']){
  if(kind==='file')await writeFile(worker,'export default {}');else await mkdir(worker);
  for(const command of ['prepare','doctor','deploy'])assert.throws(()=>run(command),error=>error.stderr.toString().includes('_worker.js'));
  await rm(worker,{recursive:true});
 }
 run('prepare');run('doctor');
});

test('legacy and new text hashes tolerate checkout newline conversion but detect source edits',async t=>{
 const {root,run}=await fixture(t);
 const config=join(root,'wrangler.jsonc');
 await writeFile(config,'{\r\n  "name": "existing-app"\r\n}\r\n');
 run(...init,'--assets','build');
 for(const name of ['access-kit.worker.mjs','wrangler.access-kit.json','wrangler.jsonc']){
  const path=join(root,name),content=await readFile(path,'utf8');
  await writeFile(path,content.includes('\r\n')?content.replaceAll('\r\n','\n'):content.replaceAll('\n','\r\n'));
 }
 run('doctor');
 await writeFile(config,(await readFile(config,'utf8')).replace('existing-app','different-app'));
 assert.throws(()=>run('doctor'));
});
