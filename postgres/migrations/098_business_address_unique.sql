-- One business address per workspace (contact_id IS NULL). Keep the newest on conflict.
DELETE FROM private.addresses a
 USING private.addresses b
 WHERE a.address_type = 'business'
   AND b.address_type = 'business'
   AND a.workspace_id = b.workspace_id
   AND a.contact_id IS NULL
   AND b.contact_id IS NULL
   AND a.id <> b.id
   AND (
     a.updated_at < b.updated_at
     OR (a.updated_at = b.updated_at AND a.id < b.id)
   );

CREATE UNIQUE INDEX IF NOT EXISTS addresses_workspace_business_uidx
  ON private.addresses (workspace_id)
  WHERE address_type = 'business' AND contact_id IS NULL;
