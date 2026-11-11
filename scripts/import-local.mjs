import {getPlatformProxy} from 'wrangler';
import {resolve} from 'node:path';
// Local-only, explicit source path. No tokens, cookies or credentials are migrated.
const source=process.argv[2];if(!source)throw Error('Usage: node scripts/import-local.mjs SOURCE_DIRECTORY');
const tables=['users','auth_identities','auth_operators','user_reauthentication','common_members','game_accounts','member_applications','member_organizations','member_seasons','season_memberships','member_approval_receipts','applications','common_application_policies'];
const old=await getPlatformProxy({configPath:resolve(source,'wrangler.jsonc'),persist:{path:resolve(source,'.wrangler/state/v3')},remoteBindings:false});
const current=await getPlatformProxy({configPath:resolve('wrangler.jsonc'),persist:{path:resolve('.wrangler/state/v3')},remoteBindings:false});
try{
 if((await current.env.DB.prepare('SELECT COUNT(*) AS n FROM users').first()).n)throw Error('Destination already has users; refusing overwrite');
 const statements=[],counts={};
 for(const table of tables){const rows=(await old.env.DB.prepare('SELECT * FROM '+table).all()).results;counts[table]=rows.length;
 for(const row of rows){const columns=Object.keys(row);statements.push(current.env.DB.prepare('INSERT INTO '+table+' ('+columns.join(',')+') VALUES('+columns.map(()=>'?').join(',')+')').bind(...columns.map(k=>row[k])));}}
 await current.env.DB.batch(statements);
 for(const table of tables){const n=(await current.env.DB.prepare('SELECT COUNT(*) AS n FROM '+table).first()).n;if(n!==counts[table])throw Error('Count mismatch: '+table);}
 console.log(JSON.stringify({local:true,counts,sessionsCopied:0}));
}finally{await old.dispose();await current.dispose();}
