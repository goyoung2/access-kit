import {z} from 'zod';

const uid=z.union([z.string(),z.number().int().nonnegative().refine(Number.isSafeInteger)])
 .transform(String).pipe(z.string().trim().regex(/^\d{1,32}$/));
export const rosterItem=z.object({nickname:z.string().trim().min(1).max(40),gameUid:uid});
export type RosterItem=z.infer<typeof rosterItem>;
type InputIssue={readonly row:number;readonly message:string};
const object=z.record(z.string(),z.unknown());

function delimited(text:string):readonly (readonly string[])[]{
 const delimiter=text.includes('\t')?'\t':',';
 const rows:string[][]=[];let row:string[]=[],field='',quoted=false;
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(c==='"'){
   if(quoted&&text[i+1]==='"'){field+='"';i++;}
   else if(quoted||field.length===0)quoted=!quoted;
   else field+=c;
  }else if(!quoted&&(c===delimiter||c==='\n')){
   row.push(field.replace(/\r$/,''));field='';
   if(c==='\n'){rows.push(row);row=[];}
  }else field+=c;
 }
 if(quoted)throw new RosterInputError('따옴표가 닫히지 않은 행이 있습니다.');
 row.push(field.replace(/\r$/,''));rows.push(row);
 return rows.filter(r=>r.some(c=>c.trim()));
}
export class RosterInputError extends Error {}

export function parseRosterInput(text:string,canonicalizeUid=false):{readonly items:readonly RosterItem[];readonly errors:readonly InputIssue[];readonly duplicateCount:number}{
 const input=text.replace(/^\uFEFF/,'').trim();
 let rows:readonly unknown[]=[];
 try{
  if(input.startsWith('{')||input.startsWith('[')){
   const value:unknown=JSON.parse(input);
   if(Array.isArray(value))rows=value;
   else{
    const parsed=object.safeParse(value);
    if(!parsed.success)throw new RosterInputError('JSON 배열 또는 닉네임·UID 매핑을 사용하세요.');
    const data=parsed.data;
    if(Array.isArray(data.records))rows=data.records;
    else if(Array.isArray(data.members))rows=data.members;
    else{
     const mapping=object.parse(data.nickname_to_cid??data.input_nickname_to_cid??data);
     rows=Object.entries(mapping).map(([nickname,gameUid])=>({nickname,gameUid}));
    }
   }
  }else{
   let cells=delimited(input);
   const first=cells[0];
   if(first&&/^(nickname|닉네임|이름)$/i.test(first[0]?.trim()||'')&&/^(uid|cid|game_?uid|아이디)$/i.test(first[1]?.trim()||''))cells=cells.slice(1);
   rows=cells.map(r=>r.length===2?{nickname:r[0],gameUid:r[1]}:null);
  }
 }catch(error){
  if(error instanceof SyntaxError||error instanceof RosterInputError||error instanceof z.ZodError)return {items:[],errors:[{row:0,message:error instanceof RosterInputError?error.message:'JSON 형식 또는 매핑을 확인해 주세요.'}],duplicateCount:0};
  throw error;
 }
 if(!rows.length||rows.length>1000)return {items:[],errors:[{row:0,message:'한 번에 1~1000명을 입력하세요. 더 큰 명부는 나누어 가져올 수 있습니다.'}],duplicateCount:0};
 const items:RosterItem[]=[],errors:InputIssue[]=[],known=new Map<string,string>();let duplicateCount=0;
 rows.forEach((row,index)=>{
  const record=object.safeParse(row);
  const value=record.success?rosterItem.safeParse({nickname:record.data.nickname??record.data.stored_nickname??record.data.input_nickname,gameUid:record.data.gameUid??record.data.game_uid??record.data.cid??record.data.uid}):null;
  if(!value?.success){errors.push({row:index+1,message:'닉네임(1~40자)과 숫자 UID를 확인하세요. 긴 UID는 JSON 문자열로 입력하세요.'});return;}
  const item=canonicalizeUid?{...value.data,gameUid:value.data.gameUid.replace(/^0+(?=\d)/,'')}:value.data;
  const existing=known.get(item.gameUid);
  if(existing!==undefined){if(existing!==value.data.nickname)errors.push({row:index+1,message:'같은 UID에 서로 다른 닉네임이 있습니다.'});else duplicateCount++;return;}
  known.set(item.gameUid,item.nickname);items.push(item);
 });
 return {items,errors,duplicateCount};
}
