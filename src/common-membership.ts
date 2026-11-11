import type {Env} from './types';
import {sha256Base64Url} from './crypto';

/** Explicit application policy is required; missing policy never grants access. */
export async function commonAccess(env:Env,userId:string,clientId:string,requireMember=false,token:string|null=null) {
 if(env.AUTH_PROVIDER!=='firebase')return null;
 const policy=await env.DB.prepare('SELECT mode,organization_id FROM common_application_policies WHERE client_id=?')
  .bind(clientId).first<{mode:string;organization_id:string|null}>();
 if(!policy)return null;
 const tokenHash=token?await sha256Base64Url(token):null;
 const row=await env.DB.prepare(`SELECT u.id,COALESCE(g.nickname,u.display_name) AS display_name,u.avatar_url,u.status,m.status AS member_status,
  a.name,a.redirect_uris,a.status AS app_status,t.expires_at,
  EXISTS(SELECT 1 FROM auth_operators o WHERE o.user_id=u.id) AS operator,
  EXISTS(SELECT 1 FROM season_memberships sm JOIN member_seasons s ON s.id=sm.season_id
    WHERE sm.user_id=u.id AND s.status='active' AND sm.status='active' AND sm.organization_id=?) AS season_member
  FROM applications a
  LEFT JOIN access_tokens t ON t.token_hash=? AND t.client_id=a.client_id AND t.revoked_at IS NULL AND t.expires_at>?
    AND NOT EXISTS(SELECT 1 FROM user_reauthentication r WHERE r.user_id=t.user_id AND t.created_at<=r.requested_at)
  LEFT JOIN users u ON u.id=CASE WHEN ? IS NULL THEN ? ELSE t.user_id END
  LEFT JOIN common_members m ON m.user_id=u.id LEFT JOIN game_accounts g ON g.user_id=u.id WHERE a.client_id=?`)
  .bind(policy.organization_id,tokenHash,Date.now(),tokenHash,userId,clientId)
  .first<{id:string|null;display_name:string;avatar_url:string|null;status:string;member_status:string|null;name:string;redirect_uris:string;app_status:string;expires_at:number|null;operator:number;season_member:number}>();
 const approved=row?.member_status==='approved';
 const allowed=Boolean(row?.id && row.status==='active' && row.app_status==='active' &&
  (policy.mode==='admin'?row.operator && (!requireMember || approved):approved && (policy.mode==='approved'||row.season_member)));
 const reason=!row?.id?'USER_DISABLED':row.app_status!=='active'?'APP_DISABLED':row.status!=='active'?'USER_DISABLED':
  policy.mode==='admin'&&!row.operator?'AUTH_OPERATOR_REQUIRED':!approved&&policy.mode!=='admin'?'MEMBERSHIP_INACTIVE':!allowed?'SEASON_MEMBERSHIP_REQUIRED':'POLICY_ALLOWED';
 return {user:row?.id?{id:row.id,display_name:row.display_name,avatar_url:row.avatar_url,status:row.status,membershipAdmin:Boolean(row.operator),
  membership:{is_guild_member:approved,is_member:approved,role:approved?'member' as const:'user' as const,checked_at:null}}:null,
  access:{allowed,reason,policy:policy.mode==='admin'?'admin' as const:'member' as const,qualification_mode:'common',
   qualification_match_mode:null,qualification_ids:[],season_role_id:'',role_ids:[],missing_role_ids:[],checked_at:null,
   manual_grant:false,reauthentication_requested_at:null,reauthentication_status:null},
  tokenExpiresAt:row?.expires_at??null,application:row?{client_id:clientId,name:row.name,redirect_uris:row.redirect_uris,status:row.app_status}:null};
}
