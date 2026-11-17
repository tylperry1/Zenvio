-- Master-admin programmable social links for public marketing surfaces.
INSERT INTO private.platform_settings(key, value)
VALUES ('platform_social_links', '{"links":[]}'::jsonb)
ON CONFLICT (key) DO NOTHING;
