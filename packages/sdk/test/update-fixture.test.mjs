import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {RUNTIME_VERSION} from '../server/gate.mjs';
const exec=promisify(execFile);
const sdk=fileURLToPath(new URL('../',import.meta.url));
const npm=process.env.npm_execpath?.endsWith('npm-cli.js')?process.env.npm_execpath:join(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
test('actual npm install/update checks new exports and CLI in new processes and rolls back corruption',async t=>{
 const root=await mkdtemp(join(tmpdir(),'ak-update-'));
 t.after(()=>rm(root,{recursive:true,force:true,maxRetries:3}));
 const packs=join(root,'packs'),app=join(root,'app');await mkdir(packs);await mkdir(app);
 const npmRun=(cwd,...args)=>exec(process.execPath,[npm,...args],{cwd,env:{...process.env,npm_config_audit:'false',npm_config_fund:'false'},maxBuffer:4*1024*1024});
 async function pack(name,mutate){
  const source=join(root,name);await cp(sdk,source,{recursive:true});
  const pkg=JSON.parse(await readFile(join(source,'package.json'),'utf8'));pkg.version='0.3.'+({good:10,exports:11,cli:12}[name]);
  await writeFile(join(source,'package.json'),JSON.stringify(pkg));
  if(mutate)await mutate(source);
  const result=JSON.parse((await npmRun(source,'pack','--json','--pack-destination',packs)).stdout);
  return join(packs,result[0].filename);
 }
 const good=await pack('good');
 const badExports=await pack('exports',async source=>writeFile(join(source,'server/gate.mjs'),'export const unrelated=true;'));
 const badCli=await pack('cli',async source=>writeFile(join(source,'bin/access-kit.mjs'),'console.log("{}");'));
 await writeFile(join(app,'package.json'),JSON.stringify({name:'local-update-fixture',private:true,type:'module'}));
 await npmRun(app,'install','--save-exact',good);
 await mkdir(join(app,'dist'));await writeFile(join(app,'dist/index.html'),'private fixture');
 const cli=join(app,'node_modules/@goyoung2/access-kit/bin/access-kit.mjs');
 const run=(...args)=>exec(process.execPath,[cli,...args],{cwd:app,env:{...process.env,npm_execpath:npm,npm_config_audit:'false',npm_config_fund:'false'},maxBuffer:4*1024*1024});
 await run('init','--client-id','fixture','--site-url','https://fixture.test/','--auth-origin','https://auth.test','--assets','dist');
 const originalPackage=await readFile(join(app,'package.json'),'utf8'),originalLock=await readFile(join(app,'package-lock.json'),'utf8');
 for(const archive of [badExports,badCli]){
  await assert.rejects(run('update','--package',archive,'--sha256',hash(await readFile(archive))));
  assert.equal(await readFile(join(app,'package.json'),'utf8'),originalPackage);
  assert.equal(await readFile(join(app,'package-lock.json'),'utf8'),originalLock);
  const doctor=JSON.parse((await run('doctor')).stdout);assert.equal(doctor.ok,true);assert.equal(doctor.runtime,RUNTIME_VERSION);
 }
 await run('update','--package',good,'--sha256',hash(await readFile(good)));
 const doctor=JSON.parse((await run('doctor')).stdout);assert.equal(doctor.ok,true);
 const updated=JSON.parse(await readFile(join(app,'package.json'),'utf8'));
 assert.match(updated.dependencies['@goyoung2/access-kit'],/^file:vendor\//);
});
