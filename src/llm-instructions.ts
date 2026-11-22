import {z} from 'zod';
import {llmInstallationInstructions} from './llm-instructions-source';
import {llmIndependentInstructions} from './llm-independent-source';

const rootUrl=z.url().refine(value=>{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&url.pathname==='/'&&!url.search&&!url.hash;});
const value=z.string().trim().min(1).max(256).regex(/^[^\r\n\x00-\x1f]+$/);
const input=z.object({mode:z.enum(['shared','independent']).optional(),client_id:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).optional(),site_url:rootUrl.optional(),hosting:z.enum(['workers','pages','server']).optional(),access_policy:z.enum(['member','admin']).optional(),assets:value.optional(),config:value.optional(),name:value.optional(),branch:value.optional()});
export function installationInstructions(origin:string,query:Record<string,string>){
 const parsed=input.parse(query);
 if(parsed.mode==='independent')return llmIndependentInstructions+'\n\n<access-kit-context>\n'+JSON.stringify({sdkVersion:'0.6.0',mode:'independent'},null,2)+'\n</access-kit-context>\n';
 const context={sdkVersion:'0.6.0',authOrigin:new URL(origin).origin,
  ...(parsed.client_id?{clientId:parsed.client_id}:{}),...(parsed.site_url?{siteUrl:parsed.site_url}:{}),
  ...(parsed.hosting?{hosting:parsed.hosting}:{}),...(parsed.assets?{assets:parsed.assets}:{}),
  ...(parsed.access_policy?{accessPolicy:parsed.access_policy}:{}),
  ...(parsed.config?{config:parsed.config}:{}),...(parsed.name?{name:parsed.name}:{}),...(parsed.branch?{branch:parsed.branch}:{}),
 };
 return llmInstallationInstructions+'\n\n<access-kit-context>\n'+JSON.stringify(context,null,2)+'\n</access-kit-context>\n';
}
