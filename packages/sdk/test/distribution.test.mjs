import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {t as list,x as extract} from 'tar';
import {createHash} from 'node:crypto';

test('npm archive includes gates and a pinned independent server template without raw source trees or private data',async t=>{
 const root=fileURLToPath(new URL('../../../',import.meta.url));
 const metadata=JSON.parse(await readFile(join(root,'packages/sdk/package.json'),'utf8'));
 await promisify(execFile)(process.execPath,['scripts/pack-sdk.mjs'],{cwd:root});
 const file=join(root,'dist/access-kit-sdk-'+metadata.version+'.tgz');
 const entries=[];
 await list({file,onReadEntry:entry=>entries.push({path:entry.path,type:entry.type})});
 for(const entry of entries){
  assert.match(entry.path,/^package\/(?:package\.json|README\.md|LICENSE|browser\.js|(?:bin|server|docs)\/[A-Za-z0-9_.-]+|auth\/(?:worker\.mjs|template\.json|migrations\/\d{4}_[a-z0-9_]+\.sql))$/);
  assert.equal(entry.type,'File');
 }
 for(const required of ['package.json','README.md','bin/access-kit.mjs','bin/auth-project.mjs','server/gate.mjs','browser.js','docs/INSTALL.md','docs/QUICKSTART.md','docs/ADAPTERS.md','docs/UPGRADE.md','docs/CONSOLE.md','docs/ROSTER.md','docs/LLM_INSTALLATION.md','docs/LLM_INDEPENDENT.md','docs/INDEPENDENT_AUTH.md','auth/worker.mjs','auth/template.json','auth/migrations/0008_service_rosters.sql','auth/migrations/0009_service_administrators.sql','auth/migrations/0010_member_services_and_reservations.sql','docs/SERVICE_ADMINISTRATORS.md'])assert.ok(entries.some(entry=>entry.path==='package/'+required),required);
 const directory=await mkdtemp(join(tmpdir(),'ak-public-package-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 await extract({file,cwd:directory});
 const template=JSON.parse(await readFile(join(directory,'package/auth/template.json'),'utf8'));assert.equal(template.schema,1);
 for(const [name,digest] of Object.entries(template.files))assert.equal(createHash('sha256').update(await readFile(join(directory,'package/auth',name))).digest('hex'),digest,name);
 const packed=JSON.parse(await readFile(join(directory,'package/package.json'),'utf8'));
 assert.deepEqual(packed.publishConfig,{access:'public',registry:'https://registry.npmjs.org/'});
 assert.notEqual(packed.private,true);
 assert.equal(packed.scripts,undefined);
 const npm=process.env.npm_execpath?.endsWith('npm-cli.js')?process.env.npm_execpath:join(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
 const exec=promisify(execFile),env={...process.env,npm_config_audit:'false',npm_config_fund:'false'};
 await writeFile(join(directory,'package.json'),JSON.stringify({name:'public-sdk-install-check',private:true}));
 await exec(process.execPath,[npm,'install','--save-exact',file],{cwd:directory,env});
 await mkdir(join(directory,'build'));await writeFile(join(directory,'build/index.html'),'protected fixture');
 const cli=join(directory,'node_modules/access-kit-sdk/bin/access-kit.mjs');
 await exec(process.execPath,[cli,'init','--client-id','fixture','--auth-origin','https://auth.test','--site-url','https://site.test/','--assets','build'],{cwd:directory,env});
 const doctor=JSON.parse((await exec(process.execPath,[cli,'doctor'],{cwd:directory,env})).stdout);
 assert.equal(doctor.ok,true);
});
