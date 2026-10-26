import { createHash } from "node:crypto";
import { getPool } from "./db";
// The API facade calls Better Auth server methods. Apply a shared account-level
// throttle here too, so protection does not depend on its HTTP handler hooks.
export async function allowAuthAttempt(action: string, address: string) {
    const key = createHash('sha256').update(action + ':' + address.toLowerCase()).digest('hex');
    const { rows } = await getPool().query(`insert into private.auth_attempts(key,count,window_start) values($1,1,now())
 on conflict(key) do update set count=case when auth_attempts.window_start<now()-interval '1 minute' then 1 else auth_attempts.count+1 end,
 window_start=case when auth_attempts.window_start<now()-interval '1 minute' then now() else auth_attempts.window_start end returning count`, [key]);
    return rows[0].count <= 10;
}
