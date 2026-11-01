-- Forward-only catalog history. No existing subscription is repriced or reclassified.
ALTER TABLE private.subscriptions ADD COLUMN catalog_version text NOT NULL DEFAULT 'legacy';
ALTER TABLE private.subscriptions ADD COLUMN promotion_ends_at timestamptz;
ALTER TABLE private.subscriptions ADD COLUMN monthly_amount_cents integer CHECK(monthly_amount_cents>=0);
ALTER TABLE private.subscription_prices ADD COLUMN catalog_version text NOT NULL DEFAULT 'legacy';
CREATE TABLE private.subscription_price_history (
 stripe_price_id text PRIMARY KEY, plan text NOT NULL, period text NOT NULL,
 catalog_version text NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO private.subscription_price_history(stripe_price_id,plan,period,catalog_version)
 SELECT stripe_price_id,plan,period,catalog_version FROM private.subscription_prices ON CONFLICT DO NOTHING;
CREATE TABLE private.subscription_usage_reservations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), billing_owner uuid NOT NULL REFERENCES public."user"(id),
 user_id uuid NOT NULL REFERENCES public."user"(id), meter text NOT NULL CHECK(meter IN ('aiCredits','videoMinutes','emails','smsSegments','storageBytes','envelopes')),
 period date NOT NULL, reference text NOT NULL, reserved bigint NOT NULL CHECK(reserved>0),
 consumed bigint CHECK(consumed>=0), state text NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','settled','released','uncertain')),
 created_at timestamptz NOT NULL DEFAULT now(), settled_at timestamptz,
 UNIQUE(billing_owner,meter,reference)
);
CREATE INDEX subscription_usage_period ON private.subscription_usage_reservations(billing_owner,period,meter,state);
CREATE TABLE private.subscription_credit_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), billing_owner uuid NOT NULL REFERENCES public."user"(id),
 meter text NOT NULL CHECK(meter IN ('aiCredits','videoMinutes','emails','smsSegments','storageBytes','envelopes')),
 quantity bigint NOT NULL CHECK(quantity<>0), reference text NOT NULL UNIQUE,
 stripe_transaction_id text, reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX subscription_credit_owner ON private.subscription_credit_entries(billing_owner,meter);
CREATE TABLE private.provider_economic_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES public."user"(id), billing_owner uuid REFERENCES public."user"(id),
 provider text NOT NULL, feature text NOT NULL, period date NOT NULL,
 raw_quantity numeric(24,6) NOT NULL CHECK(raw_quantity>=0), unit text NOT NULL,
 estimated_micros bigint NOT NULL CHECK(estimated_micros>=0), actual_micros bigint CHECK(actual_micros>=0),
 evidence_reference text, event_reference text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(provider,event_reference)
);
CREATE INDEX provider_economics_period ON private.provider_economic_events(period,provider,billing_owner);
INSERT INTO private.platform_settings(key,value) VALUES('pricing_v3_launch_promotion','{"enabled":true}'::jsonb) ON CONFLICT DO NOTHING;
REVOKE ALL ON private.subscription_price_history,private.subscription_usage_reservations,private.subscription_credit_entries,private.provider_economic_events FROM public,anon,authenticated;
ALTER TABLE private.subscription_usage_reservations ADD COLUMN included_quantity bigint NOT NULL DEFAULT 0 CHECK(included_quantity>=0);
ALTER TABLE private.subscription_usage_reservations ADD COLUMN purchased_quantity bigint NOT NULL DEFAULT 0 CHECK(purchased_quantity>=0);
ALTER TABLE private.provider_usage_reservations ADD COLUMN subscription_usage_id uuid REFERENCES private.subscription_usage_reservations(id);
CREATE TABLE private.subscription_addon_orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), billing_owner uuid NOT NULL REFERENCES public."user"(id),
 addon text NOT NULL, meter text NOT NULL, quantity bigint NOT NULL CHECK(quantity>0), amount_cents integer NOT NULL CHECK(amount_cents>0),
 customer_id text NOT NULL, checkout_id text UNIQUE, payment_intent_id text UNIQUE,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','paid','refunded','partially_refunded')),
 refunded_cents integer NOT NULL DEFAULT 0 CHECK(refunded_cents>=0 AND refunded_cents<=amount_cents),
 reversed_credits bigint NOT NULL DEFAULT 0 CHECK(reversed_credits>=0 AND reversed_credits<=quantity),
 created_at timestamptz NOT NULL DEFAULT now(),paid_at timestamptz
);
CREATE INDEX subscription_addon_owner ON private.subscription_addon_orders(billing_owner,created_at DESC);
REVOKE ALL ON private.subscription_addon_orders FROM public,anon,authenticated;
