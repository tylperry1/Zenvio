-- Preserve signed-up customers' original allowance; new subscriptions get 20/seat.
ALTER TABLE private.subscriptions ADD COLUMN envelope_allowance integer NOT NULL DEFAULT 20 CHECK(envelope_allowance>0);
UPDATE private.subscriptions SET envelope_allowance=100 WHERE plan IN ('individual','team') AND subscription_id IS NOT NULL;
CREATE TABLE private.envelope_overage_settings (
 user_id uuid PRIMARY KEY REFERENCES public."user"(id), enabled boolean NOT NULL DEFAULT false,
 monthly_cap_cents integer NOT NULL DEFAULT 0 CHECK(monthly_cap_cents BETWEEN 0 AND 100000 AND monthly_cap_cents%100=0), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE private.envelope_usage (
 source_id uuid NOT NULL, source_kind text NOT NULL CHECK(source_kind IN ('pdf','text')),
 user_id uuid NOT NULL REFERENCES public."user"(id), billing_owner uuid NOT NULL REFERENCES public."user"(id),
 sent_at timestamptz NOT NULL DEFAULT now(), charge_cents integer NOT NULL DEFAULT 0 CHECK(charge_cents IN (0,100)),
 customer_id text, subscription_id text,
 PRIMARY KEY(source_kind,source_id), CHECK(charge_cents=0 OR customer_id IS NOT NULL)
);
CREATE INDEX envelope_usage_budget ON private.envelope_usage(billing_owner,sent_at);
-- Backfill current usage only. Never bill historical sends. Drafts are excluded.
INSERT INTO private.envelope_usage(source_id,source_kind,user_id,billing_owner,sent_at)
 SELECT d.id,d.kind,d.user_id,coalesce(r.owner_id,d.user_id),d.sent_at FROM (
 SELECT id,'pdf' kind,user_id,sent_at FROM private.signature_envelopes WHERE sent_at>=date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
 UNION ALL SELECT id,'text',user_id,created_at FROM private.signing_documents WHERE created_at>=date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
 ) d LEFT JOIN LATERAL (SELECT owner_id FROM private.team_entitlement_roots(d.user_id) ORDER BY (owner_id=d.user_id) DESC,owner_id LIMIT 1) r ON true;
CREATE TABLE private.envelope_usage_invoices (
 billing_owner uuid NOT NULL REFERENCES public."user"(id), month date NOT NULL, customer_id text NOT NULL,
 amount_cents integer NOT NULL CHECK(amount_cents>0), invoice_id text UNIQUE, finalized boolean NOT NULL DEFAULT false,
 PRIMARY KEY(billing_owner,month,customer_id)
);
REVOKE ALL ON private.envelope_overage_settings,private.envelope_usage,private.envelope_usage_invoices FROM public,anon,authenticated;
