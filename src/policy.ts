import type {Env} from './types';
import {commonAccess} from './common-membership';
export async function isPlatformAdmin(env:Env,userId:string):Promise<boolean>{
 return Boolean(await env.DB.prepare("SELECT o.user_id FROM auth_operators o JOIN users u ON u.id=o.user_id WHERE o.user_id=? AND u.status='active'").bind(userId).first());
}
export const inspectApplicationAccess=(env:Env,userId:string,clientId:string,requireMember=false)=>commonAccess(env,userId,clientId,requireMember);
export const inspectApplicationTokenAccess=(env:Env,token:string,clientId:string,requireMember=false)=>commonAccess(env,'',clientId,requireMember,token);
export async function diagnoseApplicationAccess(env:Env,userId:string,clientId:string){return (await commonAccess(env,userId,clientId))?.access ?? {allowed:false,reason:'APPLICATION_POLICY_REQUIRED'};}
export async function isApplicationAccessAllowed(env:Env,userId:string,clientId:string){return (await diagnoseApplicationAccess(env,userId,clientId)).allowed;}
