import type {Context} from 'hono';
import type {Env} from './types';
import {parseCookies} from './http';
import {findSessionUser} from './store';
import {isPlatformAdmin} from './policy';

export async function developerIdentity(c:Context<{Bindings:Env}>){
 const user=await findSessionUser(c.env,parseCookies(c.req.header('Cookie')).accesskit_sid);
 if(!user)return null;
 if(await isPlatformAdmin(c.env,user))return {user,admin:true,serviceOnly:false};
 const row=await c.env.DB.prepare("SELECT d.user_id FROM developers d JOIN users u ON u.id=d.user_id WHERE d.user_id=? AND d.status='active' AND u.status='active'").bind(user).first();
 if(row)return {user,admin:false,serviceOnly:false};
 const assigned=await c.env.DB.prepare('SELECT 1 FROM service_managers WHERE user_id=? LIMIT 1').bind(user).first();
 return assigned?{user,admin:false,serviceOnly:true}:null;
}
