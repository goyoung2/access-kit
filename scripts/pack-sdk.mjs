import {mkdir,readFile,copyFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const pkg=JSON.parse(await readFile('packages/sdk/package.json','utf8'));
const browser=await readFile('packages/sdk/browser.js','utf8');
const generated='export default '+JSON.stringify(browser)+';\n';
// Generated runtime is committed so Worker builds do not require the SDK installer.
await writeFile('src/browser-source.ts',generated);
await mkdir('dist',{recursive:true});
const npm=process.platform==='win32'?'npm.cmd':'npm';
execFileSync(npm,['pack','./packages/sdk','--pack-destination','dist'],{stdio:'inherit',shell:process.platform==='win32'});
const filename='access-kit-sdk-'+pkg.version+'.tgz';
await copyFile('dist/'+pkg.name.replace('@','').replace('/','-')+'-'+pkg.version+'.tgz','dist/'+filename);
const hash=createHash('sha256').update(await readFile('dist/'+filename)).digest('hex');
await writeFile('dist/SHA256SUMS',hash+'  '+filename+'\n');
console.log(filename+' SHA256 '+hash);
