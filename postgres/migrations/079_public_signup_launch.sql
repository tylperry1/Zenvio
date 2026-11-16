BEGIN;
-- Open public workspace registration for launch. Master admin can still change
-- these flags afterward. Waitlist rows and checkout remain untouched.
UPDATE private.platform_settings
SET value = value
  || jsonb_build_object('signupEnabled', true, 'invitationOnly', false)
  || CASE
       WHEN coalesce(value->>'banner','') IN ('', 'Zenvio launches')
         THEN jsonb_build_object('banner', 'Zenvio is open for new workspaces', 'bannerEnabled', false)
       ELSE '{}'::jsonb
     END,
    updated_at = now()
WHERE key = 'launch_controls';

INSERT INTO private.platform_settings(key, value)
SELECT 'launch_controls', jsonb_build_object(
  'signupEnabled', true,
  'waitlistEnabled', true,
  'invitationOnly', false,
  'checkoutEnabled', false,
  'maintenance', false,
  'bannerEnabled', false,
  'banner', 'Zenvio is open for new workspaces',
  'launchDate', '2026-11-16',
  'features', jsonb_build_object('smartCards', true, 'growth', true, 'assistant', true)
)
WHERE NOT EXISTS (SELECT 1 FROM private.platform_settings WHERE key = 'launch_controls');
COMMIT;
