CREATE TABLE private.early_access_signups (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL UNIQUE CHECK(email=lower(email)), name text NOT NULL,
 plan text NOT NULL CHECK(plan IN ('individual','team','undecided')), seats integer NOT NULL CHECK(seats BETWEEN 1 AND 1000),
 offer_version text NOT NULL DEFAULT 'launch50_3months_v1', consent_at timestamptz NOT NULL DEFAULT now(),
 claimed_user_id uuid REFERENCES public."user"(id), created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON private.early_access_signups FROM public,anon,authenticated;
