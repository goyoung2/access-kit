import type {Env} from './types';
import {activeOperator} from './atomic-mutation';

/** Bind client ID, actor, actor. The view excludes disabled users and revoked owners. */
export const serviceManagementSql=`(EXISTS(SELECT 1 FROM service_managers WHERE client_id=? AND user_id=?) OR ${activeOperator})`;
export async function managesService(env:Env,userId:string,clientId:string){
 return Boolean(await env.DB.prepare('SELECT 1 WHERE '+serviceManagementSql).bind(clientId,userId,userId).first());
}
/** A shared/default source is not editable merely because somebody registered a site. */
export const boundRosterManagementSql=`(EXISTS(SELECT 1 FROM application_rosters b JOIN access_rosters r ON r.id=b.roster_id
 WHERE b.client_id=? AND r.status='active' AND (
  (r.owner_user_id IS NOT NULL AND EXISTS(SELECT 1 FROM application_owners o WHERE o.client_id=b.client_id AND o.user_id=r.owner_user_id))
  OR EXISTS(SELECT 1 FROM service_roster_grants g WHERE g.client_id=b.client_id AND g.roster_id=b.roster_id))) OR ${activeOperator})`;
export async function managesBoundRoster(env:Env,actor:string,clientId:string){return Boolean(await env.DB.prepare('SELECT 1 WHERE '+boundRosterManagementSql).bind(clientId,actor).first());}
export function serviceRosterAuthority(actor:string,clientId:string,organizationId:string){
 return {sql:`${serviceManagementSql} AND ${boundRosterManagementSql} AND EXISTS(SELECT 1 FROM application_rosters b JOIN access_rosters r ON r.id=b.roster_id WHERE b.client_id=? AND r.organization_id=? AND r.status='active')`,values:[clientId,actor,actor,clientId,actor,clientId,organizationId]};
}
