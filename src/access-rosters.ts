import type {Env} from './types';
import {catalogAvailable} from './membership-catalog';

export const usableRosterSql=`r.status='active' AND (r.organization_id IS NULL OR ${catalogAvailable('organization','r.organization_id')})`;
export const defaultRosterSql=`SELECT r.id FROM default_access_roster d JOIN access_rosters r ON r.id=d.roster_id WHERE d.id=1 AND r.owner_user_id IS NULL AND ${usableRosterSql}`;

export async function availableRosters(env:Env,userId:string,admin:boolean){
 return (await env.DB.prepare(`SELECT r.id,COALESCE(o.name,r.name) AS name,r.owner_user_id,owner.display_name AS owner_name,r.organization_id,r.status,r.revision,
  CASE WHEN r.owner_user_id IS NULL THEN 'shared' ELSE 'private' END AS kind,
  EXISTS(SELECT 1 FROM default_access_roster d WHERE d.roster_id=r.id) AS is_default,
  CASE WHEN r.owner_user_id IS NULL THEN 0 ELSE 1 END AS editable,
  CASE WHEN r.owner_user_id IS NULL THEN (SELECT COUNT(*) FROM roster_entries e JOIN member_seasons s ON s.id=e.season_id WHERE e.organization_id=r.organization_id AND e.status='active' AND s.status='active')
  ELSE (SELECT COUNT(*) FROM access_roster_entries e WHERE e.roster_id=r.id AND e.status='active') END AS entry_count
  FROM access_rosters r LEFT JOIN member_organizations o ON o.id=r.organization_id LEFT JOIN users owner ON owner.id=r.owner_user_id
  WHERE (?=1 OR r.owner_user_id IS NULL OR r.owner_user_id=?)
  AND (r.organization_id IS NULL OR ${catalogAvailable('organization','r.organization_id')}) ORDER BY is_default DESC,r.owner_user_id IS NOT NULL,name`)
  .bind(Number(admin),userId).all()).results;
}
