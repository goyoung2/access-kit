import type {Env} from './types';
import {randomToken} from './crypto';

export class MutationConflict extends Error {}

export const activeOperator = `EXISTS (
 SELECT 1 FROM auth_operators o JOIN users u ON u.id=o.user_id
 WHERE o.user_id=? AND u.status='active'
)`;

/** Guards and writes execute in one D1 transaction, never across a read/write gap. */
export function atomicMutation(env:Env) {
 const statements:D1PreparedStatement[]=[];
 const ids:string[]=[];
 return {
  require(predicate:string,...values:(string|number|null)[]) {
   const id=randomToken(18);
   ids.push(id);
   statements.push(env.DB.prepare(`INSERT INTO mutation_guards VALUES (?, CASE WHEN (${predicate}) THEN 1 ELSE 0 END)`).bind(id,...values));
  },
  add(...writes:D1PreparedStatement[]) { statements.push(...writes); },
  async commit() {
   for(const id of ids) statements.push(env.DB.prepare('DELETE FROM mutation_guards WHERE id=?').bind(id));
   try { await env.DB.batch(statements); }
   catch(error) {
    if(error instanceof Error && /CHECK constraint|UNIQUE constraint|FOREIGN KEY|LAST_OPERATOR/.test(error.message)) {
     throw new MutationConflict('권한이나 대상 상태가 변경되었습니다. 목록을 새로 확인해 주세요.');
    }
    throw error;
   }
  },
 };
}
