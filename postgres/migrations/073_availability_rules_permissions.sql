-- Keep profile updates column-scoped and protected by the existing owner RLS policy.
GRANT UPDATE(availability_rules) ON public.profiles TO authenticated;
