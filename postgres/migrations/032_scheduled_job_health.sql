CREATE TABLE private.job_runner_state (
 id text PRIMARY KEY CHECK(id='scheduled'),
 claim_id uuid,locked_until timestamptz,
 last_started_at timestamptz,last_success_at timestamptz,last_error text
);
REVOKE ALL ON private.job_runner_state FROM public,anon,authenticated;
