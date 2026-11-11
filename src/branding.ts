import {z} from 'zod';
import type {Env} from './types';
export const brandingInput=z.object({clientId:z.string().min(1).max(128),title:z.string().trim().min(1).max(80),description:z.string().trim().max(200),logoUrl:z.union([z.literal(''),z.url().refine(s=>{const u=new URL(s);return u.protocol==='https:'&&!u.username&&!u.password;})]),accent:z.string().regex(/^#[0-9a-fA-F]{6}$/),theme:z.enum(['light','dark'])});
export type Branding={title:string;description:string;logoUrl:string;accent:string;theme:'light'|'dark'};
export async function getBranding(env:Env,clientId:string):Promise<Branding>{
 const row=await env.DB.prepare('SELECT a.name,b.title,b.description,b.logo_url,b.accent,b.theme FROM applications a LEFT JOIN login_branding b ON b.client_id=a.client_id WHERE a.client_id=?').bind(clientId).first<{name:string;title:string|null;description:string|null;logo_url:string|null;accent:string|null;theme:'light'|'dark'|null}>();
 return {title:row?.title||row?.name||'Access Kit',description:row?.description??'Google 계정으로 로그인해 주세요.',logoUrl:row?.logo_url||'',accent:row?.accent||'#4657cf',theme:row?.theme||'light'};
}
export const escapeHtml=(s:unknown)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]||c));
