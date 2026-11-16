-- Business-owner referral codes and redemption ledger for SaaS signup attribution.
CREATE TABLE private.referral_codes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_user_id uuid NOT NULL REFERENCES public."user"(id),
 code text NOT NULL UNIQUE,
 active boolean NOT NULL DEFAULT true,
 max_redemptions integer CHECK(max_redemptions IS NULL OR max_redemptions>0),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX referral_codes_owner ON private.referral_codes(owner_user_id);
CREATE TABLE private.referral_redemptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 code_id uuid NOT NULL REFERENCES private.referral_codes(id),
 referrer_user_id uuid NOT NULL REFERENCES public."user"(id),
 referee_user_id uuid NOT NULL UNIQUE REFERENCES public."user"(id),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','qualified','rewarded','rejected')),
 qualified_at timestamptz,
 rewarded_at timestamptz,
 reward_reference text UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX referral_redemptions_referrer ON private.referral_redemptions(referrer_user_id,created_at DESC);
CREATE INDEX referral_redemptions_status ON private.referral_redemptions(status) WHERE status IN ('pending','qualified');
REVOKE ALL ON private.referral_codes,private.referral_redemptions FROM public,anon,authenticated;
