import type {Env} from './types';
import {membershipOverviewSql,membershipOverview} from './common-admin';
import {rosterSelect,rosterRows} from './console-roster';

type ConsoleIdentity={readonly user:string;readonly name:string;readonly superadmin:boolean;readonly scopes:readonly string[];readonly developer:boolean};

/** SQL and columns are code-owned. Serialize once in D1 instead of materializing every row in JS. */
function jsonRows(sql:string,columns:readonly string[],filter='1'){
 return `(SELECT json_group_array(json_object(${columns.map(column=>`'${column}',r.${column}`).join(',')})) FROM (${sql}) r WHERE ${filter})`;
}

export async function consoleData(env:Env,identity:ConsoleIdentity){
 const [applications,members,seasons,organizations,assignments,services]=membershipOverviewSql;
 const all=identity.superadmin;
 const scoped=`organization_id IN (SELECT value FROM scopes)`;
 const visibleServices=all?'1':identity.developer?`client_id IN (SELECT client_id FROM application_owners WHERE user_id=(SELECT user FROM viewer))`:'0';
 const serviceSql=`SELECT * FROM (${services}) WHERE ${visibleServices}`;
 const catalogFields=['id','name','revision','deleted_at','roster_count','member_count','manager_count','service_count'];
 const fields=[
  ['applications',jsonRows(applications,['user_id','realm','game_uid','nickname','status','requested_at','reviewed_at','reviewed_by','display_name','pending_duplicates','registered_user'],all?'1':identity.scopes.length?`status='pending' AND registered_user IS NULL`:'0')],
  ['members',jsonRows(members,['id','display_name','status','realm','game_uid','nickname'],all?'1':`id IN (SELECT user_id FROM season_memberships WHERE ${scoped})`)],
  ['seasons',jsonRows(seasons,['id','name','status',...catalogFields.slice(2)])],
  ['organizations',jsonRows(organizations,catalogFields,all?'1':'id IN (SELECT value FROM scopes)')],
  ['assignments',jsonRows(assignments,['user_id','season_id','organization_id','status','updated_at','updated_by'],all?'1':scoped)],
  ['services',jsonRows(serviceSql,['client_id','name','mode','organization_id'])],
  ['identity','json((SELECT identity FROM viewer))'],
  ['users',jsonRows('SELECT u.id,u.display_name,u.status,g.nickname,g.game_uid,o.role AS operator_role,d.status AS developer_status FROM users u LEFT JOIN game_accounts g ON g.user_id=u.id LEFT JOIN auth_operators o ON o.user_id=u.id LEFT JOIN developers d ON d.user_id=u.id ORDER BY u.display_name',['id','display_name','status','nickname','game_uid','operator_role','developer_status'],all?'1':'0')],
  ['managers',jsonRows('SELECT * FROM member_managers',['user_id','organization_id','granted_by','created_at'],all?'1':'0')],
  ['events',jsonRows('SELECT e.event_type,e.created_at,e.detail,u.display_name FROM auth_events e LEFT JOIN users u ON u.id=e.user_id ORDER BY e.created_at DESC LIMIT 100',['event_type','created_at','detail','display_name'],all?'1':'0')],
  ['brands',jsonRows('SELECT * FROM login_branding',['client_id','title','description','logo_url','accent','theme','updated_at'],`client_id IN (SELECT client_id FROM (${serviceSql}))`)],
  ['roster',jsonRows(rosterSelect+' ORDER BY r.nickname,r.game_uid',['id','realm','game_uid','nickname','season_id','organization_id','status','revision','updated_at','updated_by','linked_user_id','member_status'],all?'1':scoped)],
 ];
 try{return await env.DB.prepare(`WITH viewer AS (SELECT ? AS user,? AS identity),scopes AS (SELECT value FROM json_each(?))
 SELECT json_object(${fields.map(([name,value])=>`'${name}',${value}`).join(',')}) AS snapshot`)
  .bind(identity.user,JSON.stringify(identity),JSON.stringify(identity.scopes)).first<string>('snapshot');
 }catch(error){
  if(!(error instanceof Error)||!/SQLITE_TOOBIG|string or blob too big/i.test(error.message))throw error;
  // D1 caps a single value at 2 MB. Large histories retain the original complete row-based response.
  return JSON.stringify(await consoleRows(env,identity));
 }
}

async function consoleRows(env:Env,i:ConsoleIdentity){
 const overview=await membershipOverview(env);
 if(!i.superadmin){
  const ids=new Set(overview.assignments.filter(row=>i.scopes.includes(String(row.organization_id))).map(row=>row.user_id));
  overview.members=overview.members.filter(row=>ids.has(row.id));
  overview.assignments=overview.assignments.filter(row=>i.scopes.includes(String(row.organization_id)));
  overview.organizations=overview.organizations.filter(row=>i.scopes.includes(String(row.id)));
  overview.applications=i.scopes.length?overview.applications.filter(row=>row.status==='pending'&&!row.registered_user):[];
  const owned=(await env.DB.prepare('SELECT client_id FROM application_owners WHERE user_id=?').bind(i.user).all<{client_id:string}>()).results;
  const ownedIds=new Set(owned.map(row=>row.client_id));
  overview.services=i.developer?overview.services.filter(row=>ownedIds.has(String(row.client_id))):[];
 }
 const [users,managers,events,brands]=await env.DB.batch<Record<string,unknown>>([
  env.DB.prepare('SELECT u.id,u.display_name,u.status,g.nickname,g.game_uid,o.role AS operator_role,d.status AS developer_status FROM users u LEFT JOIN game_accounts g ON g.user_id=u.id LEFT JOIN auth_operators o ON o.user_id=u.id LEFT JOIN developers d ON d.user_id=u.id WHERE ? ORDER BY u.display_name').bind(Number(i.superadmin)),
  env.DB.prepare('SELECT * FROM member_managers WHERE ?').bind(Number(i.superadmin)),
  env.DB.prepare('SELECT e.event_type,e.created_at,e.detail,u.display_name FROM auth_events e LEFT JOIN users u ON u.id=e.user_id WHERE ? ORDER BY e.created_at DESC LIMIT 100').bind(Number(i.superadmin)),
  env.DB.prepare('SELECT * FROM login_branding'),
 ]);
 const serviceIds=new Set(overview.services.map(row=>row.client_id));
 return {...overview,identity:i,users:users.results,managers:managers.results,events:events.results,
  brands:brands.results.filter(row=>serviceIds.has(row.client_id)),roster:i.superadmin||i.scopes.length?await rosterRows(env,i.user):[]};
}
