import { getPool } from "./db";
import { stripeClient } from "./billing";
// Closed UTC calendar months only. A durable invoice ID is committed BEFORE
// adding lines/finalizing, so a crash cannot cause a second collectible invoice.
export async function settleEnvelopeInvoices() {
  const db = await getPool().connect();
  let settled = 0;
  try {
    await db.query(`INSERT INTO private.envelope_usage_invoices(billing_owner,month,customer_id,amount_cents) SELECT billing_owner,date_trunc('month',sent_at AT TIME ZONE 'UTC')::date,customer_id,sum(charge_cents)::int FROM private.envelope_usage WHERE charge_cents>0 AND sent_at<date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' GROUP BY 1,2,3 ON CONFLICT DO NOTHING`);
    const pending = (await db.query("SELECT * FROM private.envelope_usage_invoices WHERE NOT finalized ORDER BY month LIMIT 10")).rows;
    if (!pending.length) return settled;
    const stripe = await stripeClient();
    for (const batch of pending) {
      await db.query("BEGIN");
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["envelope-invoice:" + batch.billing_owner]);
      try {
        let row = (await db.query("SELECT * FROM private.envelope_usage_invoices WHERE billing_owner=$1 AND month=$2 AND customer_id=$3", [batch.billing_owner,batch.month,batch.customer_id])).rows[0];
        if (row.finalized) { await db.query("COMMIT"); continue; }
        const month = new Date(row.month).toISOString().slice(0,7);
        const marker = `envelopes:${row.billing_owner}:${month}:${row.customer_id}`;
        if (!row.invoice_id) {
          const source = (await db.query("SELECT subscription_id FROM private.envelope_usage WHERE billing_owner=$1 AND customer_id=$2 AND charge_cents>0 ORDER BY sent_at DESC LIMIT 1",[row.billing_owner,row.customer_id])).rows[0];
          const subscription = source?.subscription_id ? await stripe.subscriptions.retrieve(source.subscription_id) : null;
          const method = subscription?.default_payment_method;
          const paymentMethod = typeof method === "string" ? method : method?.id;
          const invoice = await stripe.invoices.create({customer:row.customer_id,...(paymentMethod ? {default_payment_method:paymentMethod} : {}),auto_advance:false,automatic_tax:{enabled:Boolean(subscription?.automatic_tax?.enabled)},collection_method:"charge_automatically",pending_invoice_items_behavior:"exclude",metadata:{zenvio_envelopes:marker},description:`Zenvio additional signing envelopes · ${month}`}, {idempotencyKey:marker});
          await db.query("UPDATE private.envelope_usage_invoices SET invoice_id=$4 WHERE billing_owner=$1 AND month=$2 AND customer_id=$3", [row.billing_owner,row.month,row.customer_id,invoice.id]);
          row.invoice_id = invoice.id;
        }
        await db.query("COMMIT");
        await db.query("BEGIN");
        await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["envelope-invoice:" + batch.billing_owner]);
        row = (await db.query("SELECT * FROM private.envelope_usage_invoices WHERE billing_owner=$1 AND month=$2 AND customer_id=$3", [batch.billing_owner,batch.month,batch.customer_id])).rows[0];
        if (row.finalized) { await db.query("COMMIT"); continue; }
        const invoice = await stripe.invoices.retrieve(row.invoice_id);
        if (invoice.status === "draft") {
          if (invoice.lines.data.length === 0) await stripe.invoiceItems.create({customer:row.customer_id,invoice:row.invoice_id,currency:"usd",amount:row.amount_cents,discountable:false,description:`${row.amount_cents / 100} additional envelopes × $1.00 (${month})`,metadata:{zenvio_envelopes:marker}}, {idempotencyKey:marker+":line"});
          const checked = await stripe.invoices.retrieve(row.invoice_id);
          if (checked.lines.has_more || checked.lines.data.length !== 1 || checked.lines.data[0].amount !== row.amount_cents) throw Error("Envelope invoice amount needs review.");
          await stripe.invoices.finalizeInvoice(row.invoice_id,{auto_advance:true},{idempotencyKey:marker+":finalize"});
        } else if (!["open","paid"].includes(invoice.status || "")) throw Error("Envelope invoice status needs review.");
        await db.query("UPDATE private.envelope_usage_invoices SET finalized=true WHERE billing_owner=$1 AND month=$2 AND customer_id=$3", [row.billing_owner,row.month,row.customer_id]);
        await db.query("COMMIT");
        settled++;
      } catch (e) { await db.query("ROLLBACK"); throw e; }
    }
    return settled;
  } finally { db.release(); }
}
