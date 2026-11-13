-- Additive presentation drafts and publication. Existing profile flags and URLs remain authoritative.
CREATE TABLE IF NOT EXISTS private.profile_designs (
 owner_id uuid NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('booking','smart')),
 profile_key text NOT NULL,
 draft jsonb NOT NULL,
 published jsonb,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 updated_at timestamptz NOT NULL DEFAULT now(),
 published_at timestamptz,
 PRIMARY KEY(owner_id,kind,profile_key)
);
REVOKE ALL ON private.profile_designs FROM PUBLIC, anon, authenticated;
