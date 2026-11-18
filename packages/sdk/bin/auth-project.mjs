import {readFile,writeFile,mkdir,readdir,lstat} from 'node:fs/promises';
import {resolve,relative,join,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {run} from './operations.mjs';
import {rootUrl} from './project.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>JSON.stringify(value,null,2)+'\n';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const placeholder='00000000-0000-0000-0000-000000000000';
const text=(value,name)=>{if(typeof value!=='string'||!value.trim()||value.length>256||/[\x00-\x1f]/.test(value))throw Error(name+' 값을 확인하세요.');return value.trim();};
function target(directory,cwd){const path=resolve(cwd,directory||'access-kit-auth'),rel=relative(cwd,path);if(!rel||rel==='..'||rel.startsWith('..'+sep)||resolve(cwd,rel)!==path)throw Error('인증 서버는 현재 프로젝트 안의 새 하위 폴더에 생성하세요.');return path;}
function safeArtifact(name){if(name!=='worker.mjs'&&!/^migrations\/\d{4}_[a-z0-9_]+\.sql$/.test(name))throw Error('인증 서버 패키지 경로가 올바르지 않습니다.');return name;}
async function noSymlinks(directory,cwd){let path=cwd;for(const part of relative(cwd,directory).split(sep)){path=join(path,part);try{if((await lstat(path)).isSymbolicLink())throw Error('심볼릭 링크를 통한 인증 서버 접근은 허용하지 않습니다.');}catch(error){if(error.code==='ENOENT')break;throw error;}}}
async function configAt(directory){return JSON.parse(await readFile(join(directory,'wrangler.jsonc'),'utf8'));}

/** Creates only local files. Cloud resources are never created by init. */
export async function initAuth(values,{cwd=process.cwd(),templateDirectory=fileURLToPath(new URL('../auth/',import.meta.url))}={}){
 const directory=target(values.directory,cwd),name=text(values.name,'name');await noSymlinks(directory,cwd);if(!/^[a-z0-9][a-z0-9-]{0,62}$/.test(name))throw Error('name은 영문 소문자·숫자·하이픈으로 지정하세요.');
 const projectId=text(values['firebase-project-id'],'firebase-project-id');if(!/^[a-z][a-z0-9-]{4,62}$/.test(projectId))throw Error('Firebase 프로젝트 ID를 확인하세요.');
 const domain=text(values['firebase-auth-domain'],'firebase-auth-domain');if(!/^[a-z0-9.-]+$/.test(domain))throw Error('Firebase authDomain에는 호스트 이름만 입력하세요.');
 const databaseId=values['database-id']||placeholder;if(!uuid.test(databaseId))throw Error('새로 만든 D1의 database-id UUID를 지정하세요.');
 const config={name,main:'worker.mjs',compatibility_date:'2026-08-24',vars:{AUTH_PROVIDER:'firebase',AUTH_ORIGIN:rootUrl(values['auth-origin']).replace(/\/$/,''),FIREBASE_PROJECT_ID:projectId,FIREBASE_API_KEY:text(values['firebase-api-key'],'firebase-api-key'),FIREBASE_AUTH_DOMAIN:domain,FIREBASE_APP_ID:text(values['firebase-app-id'],'firebase-app-id')},d1_databases:[{binding:'DB',database_name:name,database_id:databaseId,migrations_dir:'migrations'}]};
 try{const existing=await lstat(directory);if(existing.isSymbolicLink()||!existing.isDirectory()||(await readdir(directory)).length)throw Error('기존 인증 서버 폴더를 덮어쓰지 않습니다. 비어 있는 새 폴더를 지정하세요.');}catch(error){if(error.code!=='ENOENT')throw error;}
 const template=JSON.parse(await readFile(join(templateDirectory,'template.json'),'utf8'));
 if(template.schema!==1||typeof template.files!=='object'||!template.files['worker.mjs']||!Object.keys(template.files).some(name=>name.startsWith('migrations/')))throw Error('독립 인증 서버 실행본이 없는 패키지입니다. 새 개발본 또는 게시된 지원 버전을 설치하세요.');
 const files={};for(const [name,digest] of Object.entries(template.files)){safeArtifact(name);const bytes=await readFile(join(templateDirectory,name));if(hash(bytes)!==digest)throw Error('인증 서버 패키지 무결성 검사 실패: '+name);files[name]=bytes;}
 if(values.plan)return {mode:'independent',directory,config,files:Object.keys(files),remoteChanges:false};
 await mkdir(directory,{recursive:true});for(const [name,bytes] of Object.entries(files)){await mkdir(resolve(directory,name,'..'),{recursive:true});await writeFile(join(directory,name),bytes,{flag:'wx'});}
 const install={schema:1,mode:'independent',files:template.files,authOrigin:config.vars.AUTH_ORIGIN,firebaseProjectId:projectId};
 await writeFile(join(directory,'wrangler.jsonc'),json(config),{flag:'wx'});
 await writeFile(join(directory,'access-kit.auth.json'),json(install),{flag:'wx'});
 await writeFile(join(directory,'.gitignore'),'.wrangler/\n.dev.vars*\n.env*\nnode_modules/\n',{flag:'wx'});
 await writeFile(join(directory,'package.json'),json({name:name+'-server',private:true,type:'module',scripts:{dev:'wrangler dev --local --ip 127.0.0.1',build:'wrangler deploy --dry-run',"db:local":'wrangler d1 migrations apply DB --local',"db:remote":'wrangler d1 migrations apply DB --remote',deploy:'wrangler deploy'},devDependencies:{wrangler:'4.160.1'}}),{flag:'wx'});
 await writeFile(join(directory,'README.md'),`# ${name}\n\nIndependent Access Kit authentication environment. This server owns its DB, roster, Google identity links, member states and administrators. No Changcheon connection is configured.\n\nRun npm install, npm run db:local, npm run build and npm run dev for local validation. For a separately authorized release, create a new D1 in your own account, replace the placeholder database_id in wrangler.jsonc, configure your own Firebase Google provider and authorized domain, apply remote migrations and deploy this directory. After your Google login, use access-kit auth bootstrap --directory this-directory --firebase-uid your-UID against this DB; no first-login administrator is granted automatically.\n\nManage the roster at /console#roster, developers at /console#roles, and services at /developer/install. Detailed guide: node_modules/access-kit-sdk/docs/INDEPENDENT_AUTH.md in the installing project. Never reuse another operator's D1 binding or Firebase configuration.\n`,{flag:'wx'});
 return {mode:'independent',directory,authOrigin:install.authOrigin,needsDatabaseId:databaseId===placeholder,remoteChanges:false};
}

/** All generated server/migration files are pinned; existing servers are never silently replaced. */
export async function doctorAuth(values,{cwd=process.cwd()}={}){
 const directory=target(values.directory,cwd);await noSymlinks(directory,cwd);const install=JSON.parse(await readFile(join(directory,'access-kit.auth.json'),'utf8')),config=await configAt(directory);
 if(install.schema!==1||install.mode!=='independent')throw Error('독립 인증 서버 설치 기록을 확인하세요.');
 for(const [name,digest] of Object.entries(install.files)){safeArtifact(name);if(hash(await readFile(join(directory,name)))!==digest)throw Error('생성 파일이 변경되었습니다. 자동으로 덮어쓰지 않습니다: '+name);}
 if(config.main!=='worker.mjs'||config.vars?.AUTH_PROVIDER!=='firebase'||config.vars.AUTH_ORIGIN!==install.authOrigin||config.vars.FIREBASE_PROJECT_ID!==install.firebaseProjectId)throw Error('인증 서버 주소·Firebase 프로젝트·실행 파일이 설치 기록과 다릅니다.');
 const database=config.d1_databases?.[0];if(config.d1_databases.length!==1||database?.binding!=='DB'||database.migrations_dir!=='migrations'||!uuid.test(database.database_id)||(!values.local&&database.database_id===placeholder))throw Error('이 운영자 계정에서 새로 만든 D1 하나를 DB 바인딩에 지정하세요. 로컬 검사에는 --local을 사용하세요.');
 return {ok:true,mode:'independent',directory,authOrigin:install.authOrigin,databaseName:database.database_name,remoteReady:database.database_id!==placeholder,remoteChanges:false};
}

const sql=value=>"'"+value.replaceAll("'","''")+"'";
/** One atomic INSERT: only an existing verified Firebase identity in this DB can become its first operator. */
export function bootstrapSql(projectId,firebaseUid){
 const provider=sql('firebase:'+text(projectId,'firebase-project-id')),uid=sql(text(firebaseUid,'firebase-uid'));
 return `INSERT INTO auth_operators(user_id,role,created_at,created_by_user_id)
 SELECT u.id,'operator',unixepoch()*1000,NULL FROM users u JOIN auth_identities i ON i.user_id=u.id
 WHERE i.provider=${provider} AND i.provider_user_id=${uid} AND u.status='active'
 AND NOT EXISTS(SELECT 1 FROM auth_operators);
 SELECT COUNT(*) AS bootstrap_confirmed FROM auth_operators o JOIN auth_identities i ON i.user_id=o.user_id
 JOIN users u ON u.id=o.user_id WHERE i.provider=${provider} AND i.provider_user_id=${uid} AND u.status='active';`;
}
export async function authCommand(command,values){
 if(command==='init')return initAuth(values);
 if(command==='doctor')return doctorAuth(values);
 if(!['migrate','bootstrap'].includes(command))throw Error('auth init|doctor|migrate|bootstrap 명령을 사용하세요.');
 if(values.local&&values.remote)throw Error('--local과 --remote를 함께 지정하지 마세요.');
 const local=!values.remote,result=await doctorAuth({...values,local}),config=join(result.directory,'wrangler.jsonc');
 const scope=local?['--local','--persist-to',join(result.directory,'.wrangler/state')]:['--remote'];
 if(command==='migrate'){
  const args=['d1','migrations','apply','DB','--config',config,...scope];if(values.plan)return {...result,command:args};await run('wrangler',args);return {...result,remoteChanges:!local};
 }
 const install=JSON.parse(await readFile(join(result.directory,'access-kit.auth.json'),'utf8'));
 const query=bootstrapSql(install.firebaseProjectId,values['firebase-uid']);
 if(values.plan)return {...result,sql:query};
 const output=await run('wrangler',['d1','execute','DB','--config',config,...scope,'--command',query,'--json'],{capture:true});
 const replies=JSON.parse(output),confirmed=replies.some(reply=>reply.results?.some(row=>row.bootstrap_confirmed===1));
 if(!confirmed)throw Error('지정한 계정의 첫 관리자 설정을 확인하지 못했습니다. 이 Firebase 프로젝트에서 먼저 로그인했는지, 기존 관리자가 있는지 확인하세요.');
 return {...result,bootstrapConfirmed:true,remoteChanges:!local};
}
