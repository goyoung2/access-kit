import {mkdir,readFile,copyFile,writeFile,cp,mkdtemp,rm,readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,relative,isAbsolute,basename} from 'node:path';
await import('./build-llm-instructions.mjs');
const pkg=JSON.parse(await readFile('packages/sdk/package.json','utf8'));
const browser=(await readFile('packages/sdk/browser.js','utf8')).replaceAll('\r\n','\n');
const generated='export default '+JSON.stringify(browser)+';\n';
// Generated runtime is committed so Worker builds do not require the SDK installer.
await writeFile('src/browser-source.ts',generated);
await mkdir('dist',{recursive:true});
const npm=process.env.npm_execpath?.endsWith('npm-cli.js')?process.env.npm_execpath:join(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
const staging=await mkdtemp(join(tmpdir(),'access-kit-pack-'));
try{
 await cp('packages/sdk',join(staging,'sdk'),{recursive:true});
 await mkdir(join(staging,'sdk/docs'));
 for(const name of ['INSTALL.md','QUICKSTART.md','UPGRADE.md','ADAPTERS.md','CONSOLE.md','ROSTER.md','SERVICE_ROSTERS.md','SERVICE_ADMINISTRATORS.md','LLM_INSTALLATION.md','INDEPENDENT_AUTH.md','LLM_INDEPENDENT.md'])await copyFile('docs/'+name,join(staging,'sdk/docs',name));
 // Only the dry-run Worker bundle and schema files enter the distributable. No DB or env files.
 const auth=join(staging,'sdk/auth'),bundle=join(staging,'bundle');await mkdir(join(auth,'migrations'),{recursive:true});
 execFileSync(process.execPath,[resolve('node_modules/wrangler/bin/wrangler.js'),'deploy','--dry-run','--config',resolve('wrangler.jsonc'),'--outdir',bundle],{stdio:'inherit'});
 await writeFile(join(auth,'worker.mjs'),(await readFile(join(bundle,'index.js'),'utf8')).replace(/^\/\/# sourceMappingURL=.*$/gm,''));
 const files={};
 for(const name of (await readdir('migrations')).filter(name=>/^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort())await copyFile('migrations/'+name,join(auth,'migrations',name));
 for(const name of ['worker.mjs',...(await readdir(join(auth,'migrations'))).map(name=>'migrations/'+name)])files[name]=createHash('sha256').update(await readFile(join(auth,name))).digest('hex');
 await writeFile(join(auth,'template.json'),JSON.stringify({schema:1,files},null,2)+'\n');
 execFileSync(process.execPath,[npm,'pack',join(staging,'sdk'),'--pack-destination',resolve('dist')],{stdio:'inherit'});
}finally{
 const local=relative(resolve(tmpdir()),resolve(staging));
 if(!local||local.startsWith('..')||isAbsolute(local)||!basename(staging).startsWith('access-kit-pack-'))throw Error('Refuse cleanup outside the generated package staging directory');
 await rm(staging,{recursive:true,force:true});
}
const filename='access-kit-sdk-'+pkg.version+'.tgz';
const packedName=pkg.name.replace('@','').replace('/','-')+'-'+pkg.version+'.tgz';
if(packedName!==filename)await copyFile('dist/'+packedName,'dist/'+filename);
const hash=createHash('sha256').update(await readFile('dist/'+filename)).digest('hex');
await writeFile('dist/SHA256SUMS',hash+'  '+filename+'\n');
console.log(filename+' SHA256 '+hash);
