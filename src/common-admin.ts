import {z} from 'zod';
import type {Env} from './types';
import {randomToken} from './crypto';
const id=z.string().min(1).max(128);
export const adminAction=z.discriminatedUnion('action',[
 z.object({action:z.literal('approve'),userId:id,seasonId:id,organizationId:id,existingUserId:id.optional()}),
 z.object({action:z.literal('reject'),userId:id}),
 z.object({action:z.literal('member'),userId:id,status:z.enum(['approved','suspended'])}),
 z.object({action:z.literal('organization'),id,name:z.string().trim().min(1).max(80)}),
 z.object({action:z.literal('season'),id,name:z.string().trim().min(1).max(80)}),
 z.object({action:z.literal('assign'),userId:id,seasonId:id,organizationId:id,status:z.enum(['active','inactive'])}),
 z.object({action:z.literal('activate'),seasonId:id}),
 z.object({action:z.literal('copy'),seasonId:id,fromSeasonId:id}),
 z.object({action:z.literal('policy'),clientId:id,mode:z.enum(['approved','season','admin']),organizationId:id.nullable()}),
]);
export class MembershipConflict extends Error {}

export async function mutateMembership(env:Env,actor:string,action:z.infer<typeof adminAction>) {
 const now=Date.now(), q=(sql:string,...args:(string|number|null)[])=>env.DB.prepare(sql).bind(...args);
 const statements:D1PreparedStatement[]=[];
 switch(action.action){
 case 'approve': {
  const request=await q("SELECT * FROM member_applications WHERE user_id=? AND status='pending'",action.userId)
   .first<{realm:string;game_uid:string;nickname:string}>();
  if(!request)throw new MembershipConflict('신청 상태가 변경되었습니다.');
  const target=action.existingUserId||action.userId;
  statements.push(q('INSERT INTO member_approval_receipts VALUES(?,?,?)',action.userId,target,now));
  const user=await q("SELECT id FROM users WHERE id=? AND status='active'",target).first();
  const season=await q("SELECT id FROM member_seasons WHERE id=? AND status IN ('draft','active')",action.seasonId).first();
  if(!user||!season)throw new MembershipConflict('회원 또는 시즌을 확인해 주세요.');
  const duplicate=await q('SELECT user_id FROM game_accounts WHERE realm=? AND game_uid=? AND user_id<>?',request.realm,request.game_uid,target).first();
  if(duplicate)throw new MembershipConflict('이미 승인된 UID입니다.');
  if(target!==action.userId){
   const existing=await q('SELECT realm,game_uid FROM game_accounts WHERE user_id=?',target).first<{realm:string;game_uid:string}>();
   if(existing&&(existing.realm!==request.realm||existing.game_uid!==request.game_uid))throw new MembershipConflict('기존 회원의 게임 UID와 신청 UID가 다릅니다.');
   const membership=await q('SELECT status FROM common_members WHERE user_id=?',target).first<{status:string}>();
   if(membership?.status==='suspended')throw new MembershipConflict('정지된 회원입니다. 회원 관리에서 상태를 먼저 확인해 주세요.');
   const linked=await q("SELECT id FROM auth_identities WHERE user_id=? AND provider=?",target,'firebase:'+env.FIREBASE_PROJECT_ID).first();
   if(linked)throw new MembershipConflict('기존 회원에게 이미 Google 계정이 연결되어 있습니다.');
   statements.push(q("UPDATE auth_identities SET user_id=?,updated_at=? WHERE user_id=? AND provider=?",target,now,action.userId,'firebase:'+env.FIREBASE_PROJECT_ID));
   statements.push(q('DELETE FROM auth_sessions WHERE user_id=?',action.userId));
   statements.push(q('UPDATE access_tokens SET revoked_at=? WHERE user_id=?',now,action.userId));
  }
  statements.push(q(`INSERT INTO game_accounts VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET realm=excluded.realm,game_uid=excluded.game_uid,nickname=excluded.nickname`,target,request.realm,request.game_uid,request.nickname));
  statements.push(q(`INSERT INTO common_members VALUES(?,'approved',?,?) ON CONFLICT(user_id) DO UPDATE SET status='approved',approved_at=excluded.approved_at,approved_by=excluded.approved_by`,target,now,actor));
  statements.push(q(`INSERT INTO season_memberships VALUES(?,?,?,'active',?,?) ON CONFLICT(user_id,season_id) DO UPDATE SET organization_id=excluded.organization_id,status='active',updated_at=excluded.updated_at,updated_by=excluded.updated_by`,target,action.seasonId,action.organizationId,now,actor));
  statements.push(q("UPDATE member_applications SET status='approved',reviewed_at=?,reviewed_by=? WHERE user_id=? AND status='pending'",now,actor,action.userId));
  break;
 }
 case 'reject':statements.push(q("UPDATE member_applications SET status='rejected',reviewed_at=?,reviewed_by=? WHERE user_id=? AND status='pending'",now,actor,action.userId));break;
 case 'member':statements.push(q('UPDATE common_members SET status=? WHERE user_id=?',action.status,action.userId));break;
 case 'organization':statements.push(q('INSERT INTO member_organizations VALUES(?,?)',action.id,action.name));break;
 case 'season':statements.push(q("INSERT INTO member_seasons VALUES(?,?,'draft')",action.id,action.name));break;
 case 'assign':{
  const valid=await q(`SELECT m.user_id FROM common_members m,member_seasons s WHERE m.user_id=? AND m.status='approved' AND s.id=? AND s.status IN ('draft','active')`,action.userId,action.seasonId).first();
  if(!valid)throw new MembershipConflict('승인된 회원과 준비 중 또는 현재 시즌을 선택해 주세요.');
  statements.push(q(`INSERT INTO season_memberships VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,season_id) DO UPDATE SET organization_id=excluded.organization_id,status=excluded.status,updated_at=excluded.updated_at,updated_by=excluded.updated_by`,action.userId,action.seasonId,action.organizationId,action.status,now,actor));break;
 }
 case 'activate':{
  if(!await q("SELECT id FROM member_seasons WHERE id=? AND status='draft'",action.seasonId).first())throw new MembershipConflict('준비 중인 시즌만 시작할 수 있습니다.');
  statements.push(q("UPDATE member_seasons SET status='archived' WHERE status='active'"));
  statements.push(q("UPDATE member_seasons SET status='active' WHERE id=?",action.seasonId));break;
 }
 case 'copy':{
  if(action.seasonId===action.fromSeasonId||!await q("SELECT id FROM member_seasons WHERE id=? AND status='draft'",action.seasonId).first())throw new MembershipConflict('준비 중인 다른 시즌을 선택해 주세요.');
  statements.push(q(`INSERT INTO season_memberships(user_id,season_id,organization_id,status,updated_at,updated_by)
   SELECT sm.user_id,?,sm.organization_id,'active',?,? FROM season_memberships sm JOIN common_members m ON m.user_id=sm.user_id
   WHERE sm.season_id=? AND sm.status='active' AND m.status='approved' ON CONFLICT(user_id,season_id) DO NOTHING`,action.seasonId,now,actor,action.fromSeasonId));break;
 }
 case 'policy':
  if(action.mode==='season'&&!action.organizationId)throw new MembershipConflict('허용할 맹을 선택해 주세요.');
  statements.push(q(`INSERT INTO common_application_policies VALUES(?,?,?) ON CONFLICT(client_id) DO UPDATE SET mode=excluded.mode,organization_id=excluded.organization_id`,action.clientId,action.mode,action.organizationId));break;
 }
 // The mutation and audit record commit together. Unique UID constraints also arbitrate concurrent approvals.
 statements.push(q('INSERT INTO auth_events VALUES(?,?,?,?,?,?)','evt_'+randomToken(10),actor,null,'membership.'+action.action,JSON.stringify(action),now));
 try {await env.DB.batch(statements);} catch(error){
  if(error instanceof Error && /UNIQUE|FOREIGN KEY|CHECK constraint/.test(error.message))throw new MembershipConflict('다른 변경과 충돌했습니다. 목록을 새로 확인해 주세요.');
  throw error;
 }
}

export async function membershipOverview(env:Env){
 const [applications,members,seasons,organizations,assignments,services]=await env.DB.batch([
  env.DB.prepare(`SELECT r.*,u.display_name,(SELECT COUNT(*) FROM member_applications x WHERE x.realm=r.realm AND x.game_uid=r.game_uid AND x.user_id<>r.user_id AND x.status='pending') AS pending_duplicates,(SELECT user_id FROM game_accounts g WHERE g.realm=r.realm AND g.game_uid=r.game_uid) AS registered_user FROM member_applications r JOIN users u ON u.id=r.user_id ORDER BY requested_at DESC`),
  env.DB.prepare('SELECT u.id,u.display_name,m.status,g.realm,g.game_uid,g.nickname FROM common_members m JOIN users u ON u.id=m.user_id LEFT JOIN game_accounts g ON g.user_id=u.id ORDER BY g.nickname,u.display_name'),
  env.DB.prepare('SELECT * FROM member_seasons ORDER BY rowid DESC'),env.DB.prepare('SELECT * FROM member_organizations'),
  env.DB.prepare('SELECT * FROM season_memberships'),
  env.DB.prepare('SELECT a.client_id,a.name,p.mode,p.organization_id FROM applications a LEFT JOIN common_application_policies p ON p.client_id=a.client_id'),
 ]);
 return {applications:applications.results,members:members.results,seasons:seasons.results,organizations:organizations.results,assignments:assignments.results,services:services.results};
}
