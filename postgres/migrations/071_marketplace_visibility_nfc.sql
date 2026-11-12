-- Hidden until explicitly enabled by the master administrator. Orders and webhooks remain intact.
UPDATE private.platform_settings SET value=value||'{"visible":false}'::jsonb,updated_at=now() WHERE key='marketplace';
ALTER TABLE private.smart_cards ADD COLUMN destination_kind text NOT NULL DEFAULT 'profile' CHECK(destination_kind IN ('profile','review','booking','website')),
 ADD COLUMN destination_url text NOT NULL DEFAULT '' CHECK(length(destination_url)<=500);
