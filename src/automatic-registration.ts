import type {Env} from './types';
import {atomicMutation,MutationConflict} from './atomic-mutation';
import {catalogAvailable} from './membership-catalog';
import {randomToken} from './crypto';

/** Only a live row in an active, available season and affiliation grants membership. */
export const activeRosterSql=`SELECT r.* FROM roster_entries r JOIN member_seasons s ON s.id=r.season_id
 WHERE r.status='active' AND s.status='active' AND ${catalogAvailable('season','s.id')} AND ${catalogAvailable('organization','r.organization_id')}`;

/** Callers join users u, game_accounts g, common_members m and automatic_registrations registration. */
export const effectiveMemberStatusSql=`CASE WHEN m.status='suspended' THEN 'suspended'
 WHEN registration.user_id IS NOT NULL THEN CASE WHEN EXISTS(
  SELECT 1 FROM (${activeRosterSql}) r WHERE r.realm=g.realm AND r.game_uid=g.game_uid
 ) THEN 'approved' ELSE 'visitor' END ELSE m.status END`;
export const registrationJoinsSql=`LEFT JOIN game_accounts g ON g.user_id=u.id
 LEFT JOIN common_members m ON m.user_id=u.id LEFT JOIN automatic_registrations registration ON registration.user_id=u.id`;

export class RegistrationConflict extends MutationConflict {}

export async function registerFromRoster(env:Env,userId:string,nickname:string,gameUid:string){
 // Resolve historical namespaces without accepting a server field from the applicant.
 const known=await env.DB.prepare(`SELECT realm FROM game_accounts WHERE game_uid=?
  UNION SELECT realm FROM roster_entries WHERE game_uid=? UNION SELECT realm FROM member_applications WHERE game_uid=?`)
  .bind(gameUid,gameUid,gameUid).all<{realm:string}>();
 if(known.results.length>1)throw new RegistrationConflict('이 CID의 명부 정보가 중복되어 있습니다. 관리자에게 확인을 요청해 주세요.');
 const realm=known.results[0]?.realm??'kr',now=Date.now(),tx=atomicMutation(env);
 tx.require("EXISTS(SELECT 1 FROM users WHERE id=? AND status='active')",userId);
 tx.require('NOT EXISTS(SELECT 1 FROM common_members WHERE user_id=?) AND NOT EXISTS(SELECT 1 FROM automatic_registrations WHERE user_id=?)',userId,userId);
 tx.require(`NOT EXISTS(SELECT 1 FROM game_accounts WHERE game_uid=?) AND NOT EXISTS(SELECT 1 FROM game_accounts WHERE user_id=?)`,gameUid,userId);
 // The namespace snapshot and uniqueness guards are checked in the same transaction as linking.
 tx.require(`NOT EXISTS(SELECT 1 FROM (
  SELECT realm FROM game_accounts WHERE game_uid=? UNION SELECT realm FROM roster_entries WHERE game_uid=?
  UNION SELECT realm FROM member_applications WHERE game_uid=?) WHERE realm<>?)`,gameUid,gameUid,gameUid,realm);
 tx.add(
  // Keep the canonical game nickname for existing membership-to-roster triggers.
  // The applicant's name lives independently in automatic_registrations.
  env.DB.prepare(`INSERT INTO game_accounts SELECT ?,?,?,COALESCE((
   SELECT r.nickname FROM roster_entries r JOIN member_seasons s ON s.id=r.season_id WHERE r.realm=? AND r.game_uid=?
   ORDER BY CASE s.status WHEN 'active' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END,r.updated_at DESC LIMIT 1
  ),?)`).bind(userId,realm,gameUid,realm,gameUid,nickname),
  env.DB.prepare('INSERT INTO automatic_registrations VALUES(?,?,?)').bind(userId,nickname,now),
  env.DB.prepare("UPDATE member_applications SET status='approved',reviewed_at=?,reviewed_by=NULL WHERE user_id=?").bind(now,userId),
  env.DB.prepare('INSERT INTO auth_events VALUES(?,?,NULL,?,?,?)').bind('evt_'+randomToken(18),userId,'membership.register',JSON.stringify({realm,gameUid}),now),
 );
 try{await tx.commit();}
 catch(error){if(error instanceof MutationConflict)throw new RegistrationConflict('이미 가입되었거나 다른 계정에 연결된 CID입니다. 입력 정보와 계정 상태를 확인해 주세요.');throw error;}
}
