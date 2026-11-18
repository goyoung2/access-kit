import type {Context} from 'hono';
import type {Env} from './types';
import {parseCookies} from './http';
import {findSessionUser} from './store';
import {isPlatformAdmin} from './policy';

export async function developerIdentity(c:Context<{Bindings:Env}>){
 const user=await findSessionUser(c.env,parseCookies(c.req.header('Cookie')).accesskit_sid);
 if(!user)return null;
 if(await isPlatformAdmin(c.env,user))return {user,admin:true};
 const row=await c.env.DB.prepare("SELECT d.user_id FROM developers d JOIN users u ON u.id=d.user_id WHERE d.user_id=? AND d.status='active' AND u.status='active'").bind(user).first();
 return row?{user,admin:false}:null;
}
