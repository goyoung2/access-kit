import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {t as list,x as extract} from 'tar';

test('public npm archive includes runnable SDK and standalone documentation without server sources or private data',async t=>{
 const root=fileURLToPath(new URL('../../../',import.meta.url));
 const metadata=JSON.parse(await readFile(join(root,'packages/sdk/package.json'),'utf8'));
 await promisify(execFile)(process.execPath,['scripts/pack-sdk.mjs'],{cwd:root});
 const file=join(root,'dist/access-kit-sdk-'+metadata.version+'.tgz');
 const entries=[];
 await list({file,onReadEntry:entry=>entries.push({path:entry.path,type:entry.type})});
 for(const entry of entries){
  assert.match(entry.path,/^package\/(?:package\.json|README\.md|LICENSE|browser\.js|(?:bin|server|docs)\/[A-Za-z0-9_.-]+)$/);
  assert.equal(entry.type,'File');
 }
 for(const required of ['package.json','README.md','bin/access-kit.mjs','server/gate.mjs','browser.js','docs/INSTALL.md','docs/QUICKSTART.md','docs/ADAPTERS.md','docs/UPGRADE.md','docs/CONSOLE.md','docs/ROSTER.md','docs/LLM_INSTALLATION.md'])assert.ok(entries.some(entry=>entry.path==='package/'+required),required);
 const directory=await mkdtemp(join(tmpdir(),'ak-public-package-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 await extract({file,cwd:directory});
 const packed=JSON.parse(await readFile(join(directory,'package/package.json'),'utf8'));
 assert.deepEqual(packed.publishConfig,{access:'public',registry:'https://registry.npmjs.org/'});
 assert.notEqual(packed.private,true);
 assert.equal(packed.scripts,undefined);
 const npm=process.env.npm_execpath?.endsWith('npm-cli.js')?process.env.npm_execpath:join(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
 const exec=promisify(execFile),env={...process.env,npm_config_audit:'false',npm_config_fund:'false'};
 await writeFile(join(directory,'package.json'),JSON.stringify({name:'public-sdk-install-check',private:true}));
 await exec(process.execPath,[npm,'install','--save-exact',file],{cwd:directory,env});
 await mkdir(join(directory,'build'));await writeFile(join(directory,'build/index.html'),'protected fixture');
 const cli=join(directory,'node_modules/@goyoung2/access-kit/bin/access-kit.mjs');
 await exec(process.execPath,[cli,'init','--client-id','fixture','--auth-origin','https://auth.test','--site-url','https://site.test/','--assets','build'],{cwd:directory,env});
 const doctor=JSON.parse((await exec(process.execPath,[cli,'doctor'],{cwd:directory,env})).stdout);
 assert.equal(doctor.ok,true);
});
