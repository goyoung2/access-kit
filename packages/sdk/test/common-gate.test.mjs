import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createGate} from '../server/gate.mjs';
const cli=fileURLToPath(new URL('../bin/access-kit.mjs',import.meta.url));
test('installer generates usable independent settings and refuses overwrite',async t=>{
 const root=await mkdtemp(join(tmpdir(),'access-kit-install-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await mkdir(join(root,'dist'));await writeFile(join(root,'dist/index.html'),'private');
 const args=[cli,'init','--client-id','site','--site-url','https://site.test/','--auth-origin','https://auth.test','--assets','dist'];
 execFileSync(process.execPath,args,{cwd:root});
 const settings=JSON.parse(await readFile(join(root,'access-kit.json'),'utf8'));assert.equal(settings.authOrigin,'https://auth.test');assert.equal(typeof createGate(settings),'function');
 const before=await readFile(join(root,'access-kit.worker.mjs'),'utf8');
 assert.throws(()=>execFileSync(process.execPath,args,{cwd:root,stdio:'pipe'}));assert.equal(await readFile(join(root,'access-kit.worker.mjs'),'utf8'),before);
 execFileSync(process.execPath,[cli,'doctor'],{cwd:root});
});
test('installer rejects assets outside the service',async t=>{
 const root=await mkdtemp(join(tmpdir(),'access-kit-outside-'));t.after(()=>rm(root,{recursive:true,force:true}));
 assert.throws(()=>execFileSync(process.execPath,[cli,'init','--client-id','site','--site-url','https://site.test/','--auth-origin','https://auth.test','--assets','..'],{cwd:root,stdio:'pipe'}));
});
