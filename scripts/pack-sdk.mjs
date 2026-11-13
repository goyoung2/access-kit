import {mkdir,readFile,copyFile,writeFile,cp,mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
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
 for(const name of ['INSTALL.md','QUICKSTART.md','UPGRADE.md','ADAPTERS.md','CONSOLE.md','ROSTER.md'])await copyFile('docs/'+name,join(staging,'sdk/docs',name));
 execFileSync(process.execPath,[npm,'pack',join(staging,'sdk'),'--pack-destination',resolve('dist')],{stdio:'inherit'});
}finally{await rm(staging,{recursive:true,force:true});}
const filename='access-kit-sdk-'+pkg.version+'.tgz';
await copyFile('dist/'+pkg.name.replace('@','').replace('/','-')+'-'+pkg.version+'.tgz','dist/'+filename);
const hash=createHash('sha256').update(await readFile('dist/'+filename)).digest('hex');
await writeFile('dist/SHA256SUMS',hash+'  '+filename+'\n');
console.log(filename+' SHA256 '+hash);
