import { getPool } from "../db";
import { ApiError } from "../server";
import type { PoolClient } from "pg";
export async function applyBalanceEntry(db: PoolClient, input: {
    userId: string;
    accountId: string;
    delta: number;
    reference: string;
    reason: string;
    reversalOf?: string;
}) {
    if (!Number.isSafeInteger(input.delta) || input.delta === 0 || Math.abs(input.delta) > 100000000)
        throw new ApiError("Invalid balance adjustment.");
    if (!/^[A-Za-z0-9._:-]{16,120}$/.test(input.reference) || input.reason.trim().length < 8 || input.reason.length > 500)
        throw new ApiError("A stable reference and adjustment reason are required.");
    await db.query("select pg_advisory_xact_lock(hashtextextended($1,0))", ["balance-entry:" + input.userId + ":" + input.reference]);
    const existing = (await db.query("select * from private.customer_balance_entries where user_id=$1 and reference=$2", [input.userId, input.reference])).rows[0];
    if (existing) {
        if (existing.account_id !== input.accountId || Number(existing.delta) !== input.delta || existing.reversal_of !== (input.reversalOf || null))
            throw new ApiError("Reference already used for another adjustment.", 409);
        return existing;
    }
    const account = (await db.query("select * from private.customer_balance_accounts where id=$1 and user_id=$2 for update", [input.accountId, input.userId])).rows[0];
    if (!account)
        throw new ApiError("Balance account not found.", 404);
    if(input.delta<0&&account.frozen)throw new ApiError("Credits are suspended pending refund reconciliation.",409);
    if (input.delta < 0 && account.expires_at && Date.parse(account.expires_at) <= Date.now())
        throw new ApiError("These credits have expired.", 409);
    const next = Number(account.balance) + input.delta;
    if (!Number.isSafeInteger(next) || next < 0)
        throw new ApiError("Insufficient credit balance.", 409);
    if (input.reversalOf) {
        const original = (await db.query("select * from private.customer_balance_entries where id=$1 and user_id=$2 and account_id=$3 for update", [input.reversalOf, input.userId, input.accountId])).rows[0];
        if (!original || original.reversal_of || Number(original.delta) !== -input.delta)
            throw new ApiError("Invalid credit reversal.", 409);
        if ((await db.query("select 1 from private.customer_balance_entries where reversal_of=$1", [input.reversalOf])).rowCount)
            throw new ApiError("This entry was already reversed.", 409);
    }
    await db.query("update private.customer_balance_accounts set balance=$3 where id=$1 and user_id=$2", [input.accountId, input.userId, next]);
    const result = (await db.query("insert into private.customer_balance_entries(account_id,user_id,delta,balance_after,reference,reason,reversal_of) values($1,$2,$3,$4,$5,$6,$7) returning *", [input.accountId, input.userId, input.delta, next, input.reference, input.reason, input.reversalOf || null])).rows[0];
    await db.query("insert into private.operation_log(actor_id,action,details) values($1,'customer_balance_adjustment',$2)", [input.userId, JSON.stringify({ accountId: input.accountId, entryId: result.id, delta: input.delta, reason: input.reason })]);
    return result;
}
export async function adjustBalance(input: Parameters<typeof applyBalanceEntry>[1]) { const db = await getPool().connect(); try {
    await db.query("begin");
    const result = await applyBalanceEntry(db, input);
    await db.query("commit");
    return result;
}
catch (e) {
    await db.query("rollback");
    throw e;
}
finally {
    db.release();
} }
