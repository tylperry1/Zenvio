ALTER TABLE private.google_calendar_connections DROP CONSTRAINT google_calendar_connections_pkey;
ALTER TABLE private.google_calendar_connections ADD PRIMARY KEY(user_id,account_sub);
