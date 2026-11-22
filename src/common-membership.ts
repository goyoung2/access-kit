import type {Env} from './types';
import {sha256Base64Url} from './crypto';
import {catalogAvailable} from './membership-catalog';
import {activeRosterSql,effectiveMemberStatusSql,registrationJoinsSql} from './automatic-registration';
import {usableRosterSql} from './access-rosters';

/** Explicit application policy is required; missing policy never grants access. */
export async function commonAccess(env:Env,userId:string,clientId:string,requireMember=false,token:string|null=null) {
 if(env.AUTH_PROVIDER!=='firebase')return null;
 const policy=await env.DB.prepare('SELECT p.mode,p.organization_id,b.roster_id FROM common_application_policies p LEFT JOIN application_rosters b ON b.client_id=p.client_id WHERE p.client_id=?')
  .bind(clientId).first<{mode:string;organization_id:string|null;roster_id:string|null}>();
 if(!policy||(policy.mode==='roster'&&!policy.roster_id))return null;
 const tokenHash=token?await sha256Base64Url(token):null;
 const row=await env.DB.prepare(`SELECT u.id,COALESCE(registration.nickname,g.nickname,u.display_name) AS display_name,u.avatar_url,u.status,${effectiveMemberStatusSql} AS member_status,
  a.name,a.redirect_uris,a.status AS app_status,t.expires_at,
  EXISTS(SELECT 1 FROM auth_operators o WHERE o.user_id=u.id) AS operator,
  EXISTS(SELECT 1 FROM service_managers manager WHERE manager.client_id=a.client_id AND manager.user_id=u.id) AS service_developer,
  EXISTS(SELECT 1 FROM access_rosters r WHERE r.id=? AND ${usableRosterSql} AND (
   (r.organization_id IS NULL AND EXISTS(SELECT 1 FROM access_roster_entries entry WHERE entry.roster_id=r.id AND entry.game_uid=g.game_uid AND entry.status='active'))
   OR EXISTS(SELECT 1 FROM (${activeRosterSql}) shared WHERE shared.organization_id=r.organization_id AND shared.realm=g.realm AND shared.game_uid=g.game_uid))) AS roster_member,
  CASE WHEN registration.user_id IS NOT NULL THEN EXISTS(SELECT 1 FROM (${activeRosterSql}) r WHERE r.realm=g.realm AND r.game_uid=g.game_uid AND r.organization_id=?)
  ELSE EXISTS(SELECT 1 FROM season_memberships sm JOIN member_seasons s ON s.id=sm.season_id
    WHERE sm.user_id=u.id AND s.status='active' AND sm.status='active' AND sm.organization_id=? AND ${catalogAvailable('season','s.id')} AND ${catalogAvailable('organization','sm.organization_id')}) END AS season_member
  FROM applications a
  LEFT JOIN access_tokens t ON t.token_hash=? AND t.client_id=a.client_id AND t.revoked_at IS NULL AND t.expires_at>?
    AND NOT EXISTS(SELECT 1 FROM user_reauthentication r WHERE r.user_id=t.user_id AND t.created_at<=r.requested_at)
  LEFT JOIN users u ON u.id=CASE WHEN ? IS NULL THEN ? ELSE t.user_id END
  ${registrationJoinsSql} WHERE a.client_id=?`)
  .bind(policy.roster_id,policy.organization_id,policy.organization_id,tokenHash,Date.now(),tokenHash,userId,clientId)
  .first<{id:string|null;display_name:string;avatar_url:string|null;status:string;member_status:string|null;name:string;redirect_uris:string;app_status:string;expires_at:number|null;operator:number;season_member:number;roster_member:number;service_developer:number}>();
 const approved=row?.member_status==='approved';
 const member=policy.mode==='roster'?Boolean(row?.roster_member||row?.service_developer):Boolean(approved||row?.service_developer);
 const allowed=Boolean(row?.id && row.status==='active' && row.app_status==='active' &&
  (policy.mode==='admin'?row.operator && (!requireMember || approved):row.member_status!=='suspended'&&member&&(row.service_developer||policy.mode!=='season'||row.season_member)));
 const reason=!row?.id?'USER_DISABLED':row.app_status!=='active'?'APP_DISABLED':row.status!=='active'?'USER_DISABLED':
  policy.mode==='admin'&&!row.operator?'AUTH_OPERATOR_REQUIRED':row.member_status==='suspended'?'MEMBERSHIP_INACTIVE':!member&&policy.mode!=='admin'?(policy.mode==='roster'?'ROSTER_MEMBERSHIP_REQUIRED':'MEMBERSHIP_INACTIVE'):!allowed?'SEASON_MEMBERSHIP_REQUIRED':'POLICY_ALLOWED';
 return {user:row?.id?{id:row.id,display_name:row.display_name,avatar_url:row.avatar_url,status:row.status,membershipAdmin:Boolean(row.operator),
  serviceDeveloper:Boolean(row.service_developer),serviceRole:row.service_developer?'developer' as const:member?'member' as const:'visitor' as const,
  membership:{is_guild_member:approved,is_member:member,role:member?'member' as const:'user' as const,checked_at:null}}:null,
  access:{allowed,reason,policy:policy.mode==='admin'?'admin' as const:'member' as const,qualification_mode:'common',
   qualification_match_mode:null,qualification_ids:[],season_role_id:'',role_ids:[],missing_role_ids:[],checked_at:null,
   manual_grant:false,reauthentication_requested_at:null,reauthentication_status:null},
  tokenExpiresAt:row?.expires_at??null,application:row?{client_id:clientId,name:row.name,redirect_uris:row.redirect_uris,status:row.app_status}:null};
}
