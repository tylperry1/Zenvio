import { OAuth2Client, CodeChallengeMethod } from "google-auth-library";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getPool } from "./db";
import {
  integrationValue,
  sealSecret,
  unsealSecret,
} from "./platform-settings";
import { ApiError } from "./server";
const scopes = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.events.freebusy",
];
export function googleRedirect(origin: string) {
  return new URL(
    "/api/calendars/google/callback",
    process.env.NEXT_PUBLIC_APP_URL || process.env.BETTER_AUTH_URL || origin,
  ).toString();
}
export async function googleConfigured() {
  return Boolean(
    process.env.INTEGRATION_ENCRYPTION_KEY &&
    (await integrationValue("GOOGLE_CLIENT_ID")) &&
    (await integrationValue("GOOGLE_CLIENT_SECRET")),
  );
}
async function oauthClient(redirectUri?: string) {
  const [clientId, clientSecret] = await Promise.all([
    integrationValue("GOOGLE_CLIENT_ID"),
    integrationValue("GOOGLE_CLIENT_SECRET"),
  ]);
  if (!clientId || !clientSecret)
    throw new ApiError(
      "Google Calendar is not configured by the platform administrator yet.",
      503,
    );
  return new OAuth2Client({
    clientId,
    clientSecret,
    redirectUri,
    transporterOptions: { timeout: 15000 },
  });
}
export async function beginGoogleConnection(userId: string, origin: string) {
  if (!(await googleConfigured()))
    throw new ApiError(
      "Google Calendar setup is required in master admin.",
      503,
    );
  const redirect = googleRedirect(origin),
    oauth = await oauthClient(redirect),
    proof = await oauth.generateCodeVerifierAsync(),
    state = randomBytes(32).toString("base64url");
  await getPool().query(
    "INSERT INTO private.google_calendar_oauth(user_id,state_hash,verifier_ciphertext,redirect_uri) VALUES($1,$2,$3,$4) ON CONFLICT(user_id) DO UPDATE SET state_hash=$2,verifier_ciphertext=$3,redirect_uri=$4,expires_at=now()+interval '10 minutes'",
    [
      userId,
      createHash("sha256").update(state).digest("hex"),
      sealSecret(proof.codeVerifier),
      redirect,
    ],
  );
  return oauth.generateAuthUrl({
    scope: scopes,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: true,
    state,
    code_challenge: proof.codeChallenge,
    code_challenge_method: CodeChallengeMethod.S256,
  });
}
export async function finishGoogleConnection(
  userId: string,
  state: string,
  code: string,
) {
  if (state.length > 200 || code.length > 4096)
    throw new ApiError("Invalid Google authorization response.");
  const { rows } = await getPool().query(
    "DELETE FROM private.google_calendar_oauth WHERE user_id=$1 AND state_hash=$2 AND expires_at>now() RETURNING verifier_ciphertext,redirect_uri",
    [userId, createHash("sha256").update(state).digest("hex")],
  );
  if (!rows[0])
    throw new ApiError(
      "This Google authorization link expired or was already used. Connect again.",
      409,
    );
  const oauth = await oauthClient(rows[0].redirect_uri);
  const { tokens } = await oauth.getToken({
    code,
    codeVerifier: unsealSecret(rows[0].verifier_ciphertext),
    redirect_uri: rows[0].redirect_uri,
  });
  if (!tokens.access_token || !tokens.refresh_token || !tokens.id_token)
    throw new ApiError(
      "Google did not grant offline calendar access. Connect again and approve the requested permissions.",
      409,
    );
  const ticket = await oauth.verifyIdToken({
      idToken: tokens.id_token,
      audience: await integrationValue("GOOGLE_CLIENT_ID"),
    }),
    identity = ticket.getPayload();
  if (!identity?.sub || !identity.email || !identity.email_verified)
    throw new ApiError("Google account verification failed.", 409);
  const granted = new Set((tokens.scope || "").split(" "));
  if (
    !granted.has("https://www.googleapis.com/auth/calendar") &&
    !scopes.slice(2).every((s) => granted.has(s))
  )
    throw new ApiError(
      "Calendar permissions were not granted. Connect again and allow calendar access.",
      409,
    );
  const c = await getPool().connect();
  try {
    await c.query("BEGIN");
    await c.query(
      "INSERT INTO private.google_calendar_connections(user_id,account_sub,account_email,access_ciphertext,refresh_ciphertext,expires_at,scope) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(user_id) DO UPDATE SET account_sub=$2,account_email=$3,access_ciphertext=$4,refresh_ciphertext=$5,expires_at=$6,scope=$7,status='connected',last_sync_at=NULL,last_error=NULL,updated_at=now()",
      [
        userId,
        identity.sub,
        identity.email,
        sealSecret(tokens.access_token),
        sealSecret(tokens.refresh_token),
        new Date(tokens.expiry_date || Date.now() + 3500000),
        tokens.scope,
      ],
    );
    await c.query(
      "INSERT INTO private.google_calendar_jobs(booking_id,user_id) SELECT id,user_id FROM public.bookings WHERE user_id=$1 AND status='confirmed' AND ends_at>now() ON CONFLICT(booking_id) DO UPDATE SET attempts=0,not_before=now(),last_error=NULL,revision=private.google_calendar_jobs.revision+1",
      [userId],
    );
    await c.query(
      "INSERT INTO private.operation_log(actor_id,action,details) VALUES($1,'google_calendar_connected',$2)",
      [userId, JSON.stringify({ accountEmail: identity.email })],
    );
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
async function access(userId: string) {
  const c = await getPool().connect();
  try {
    await c.query("BEGIN");
    const { rows } = await c.query(
        "SELECT * FROM private.google_calendar_connections WHERE user_id=$1 FOR UPDATE",
        [userId],
      ),
      row = rows[0];
    if (!row) throw new ApiError("Connect Google Calendar first.", 409);
    if (row.status !== "connected")
      throw new ApiError(
        "Reconnect Google Calendar to restore synchronization.",
        409,
      );
    let token = unsealSecret(row.access_ciphertext);
    if (new Date(row.expires_at).getTime() < Date.now() + 60000) {
      const oauth = await oauthClient();
      oauth.setCredentials({
        refresh_token: unsealSecret(row.refresh_ciphertext),
      });
      try {
        const { credentials } = await oauth.refreshAccessToken();
        if (!credentials.access_token) throw Error("Missing token");
        token = credentials.access_token;
        await c.query(
          "UPDATE private.google_calendar_connections SET access_ciphertext=$2,refresh_ciphertext=$3,expires_at=$4,updated_at=now() WHERE user_id=$1",
          [
            userId,
            sealSecret(token),
            credentials.refresh_token
              ? sealSecret(credentials.refresh_token)
              : row.refresh_ciphertext,
            new Date(credentials.expiry_date || Date.now() + 3500000),
          ],
        );
      } catch (e) {
        const invalid =
          (e as { response?: { data?: { error?: string } } }).response?.data
            ?.error === "invalid_grant";
        if (invalid) {
          await c.query(
            "UPDATE private.google_calendar_connections SET status='reconnect_required',last_error='Google authorization expired or was revoked.' WHERE user_id=$1",
            [userId],
          );
          await c.query("COMMIT");
          throw new ApiError(
            "Reconnect Google Calendar to restore synchronization.",
            409,
          );
        }
        throw e;
      }
    }
    await c.query("COMMIT");
    return { token, accountSub: row.account_sub };
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
async function googleRequest(
  userId: string,
  path: string,
  options: RequestInit = {},
  expectedAccount?: string,
) {
  const { token, accountSub } = await access(userId);
  if (expectedAccount && accountSub !== expectedAccount)
    throw new ApiError(
      "The connected Google account changed. Retry synchronization.",
      409,
    );
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/${path}`,
    {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(12000),
      cache: "no-store",
    },
  );
  if (response.status === 401) {
    await getPool().query(
      "UPDATE private.google_calendar_connections SET status='reconnect_required',last_error='Reconnect Google Calendar to restore access.' WHERE user_id=$1",
      [userId],
    );
  }
  return { response, accountSub };
}
export function overlapsBusy(
  start: string,
  end: string,
  busy: { start: string; end: string }[],
) {
  return busy.some(
    (b) =>
      Date.parse(start) < Date.parse(b.end) &&
      Date.parse(end) > Date.parse(b.start),
  );
}
export async function googleBusyForHost(
  host: string,
  start: string,
  end: string,
) {
  const { rows } = await getPool().query(
    "SELECT p.id,c.check_conflicts FROM public.profiles p JOIN private.google_calendar_connections c ON c.user_id=p.id WHERE p.slug=$1",
    [host],
  );
  if (!rows[0]?.check_conflicts) return [];
  try {
    const { response } = await googleRequest(rows[0].id, "freeBusy", {
      method: "POST",
      body: JSON.stringify({
        timeMin: start,
        timeMax: end,
        items: [{ id: "primary" }],
      }),
    });
    if (!response.ok) throw Error("Calendar unavailable");
    const data = await response.json();
    const calendars = Object.values(data.calendars || {}) as {
      errors?: unknown[];
      busy?: { start: string; end: string }[];
    }[];
    const primary =
      data.calendars?.primary || (calendars.length === 1 ? calendars[0] : null);
    if (
      !primary ||
      primary.errors?.length ||
      !Array.isArray(primary.busy) ||
      !primary.busy.every(
        (b: { start: string; end: string }) =>
          Number.isFinite(Date.parse(b.start)) &&
          Number.isFinite(Date.parse(b.end)) &&
          Date.parse(b.end) > Date.parse(b.start),
      )
    )
      throw Error("Calendar unavailable");
    return primary.busy as { start: string; end: string }[];
  } catch {
    await getPool()
      .query(
        "UPDATE private.google_calendar_connections SET last_error='Google Calendar availability could not be checked. Review calendar access and permissions.' WHERE user_id=$1",
        [rows[0].id],
      )
      .catch(() => {});
    throw new ApiError(
      "Calendar availability is temporarily unavailable. Please try again later.",
      503,
    );
  }
}
export async function runGoogleJobs(userId?: string, limit = 5) {
  let completed = 0;
  for (let n = 0; n < Math.min(20, Math.max(1, limit)); n++) {
    const claim = randomUUID();
    const { rows: claims } = await getPool().query(
      `UPDATE private.google_calendar_jobs SET locked_until=now()+interval '5 minutes',claim_token=$1 WHERE booking_id=(SELECT j.booking_id FROM private.google_calendar_jobs j JOIN private.google_calendar_connections g ON g.user_id=j.user_id WHERE g.status='connected' AND g.sync_events AND j.not_before<=now() AND j.attempts<8 AND (j.locked_until IS NULL OR j.locked_until<now()) ${userId ? "AND j.user_id=$2" : ""} ORDER BY j.not_before LIMIT 1 FOR UPDATE OF j SKIP LOCKED) RETURNING booking_id,user_id,revision`,
      userId ? [claim, userId] : [claim],
    );
    if (!claims[0]) break;
    const claimed = claims[0];
    try {
      const { rows } = await getPool().query(
        "SELECT b.*,e.title,e.location,g.account_sub FROM public.bookings b JOIN public.event_types e ON e.id=b.event_id JOIN private.google_calendar_connections g ON g.user_id=b.user_id WHERE b.id=$1",
        [claimed.booking_id],
      );
      const job = rows[0];
      if (!job) throw Error("Disconnected");
      const { rows: mapped } = await getPool().query(
        "SELECT event_id FROM private.google_calendar_events WHERE user_id=$1 AND account_sub=$2 AND booking_id=$3",
        [job.user_id, job.account_sub, job.id],
      );
      const eventId = mapped[0]?.event_id || "a" + job.id.replaceAll("-", ""),
        endpoint = `calendars/primary/events/${eventId}`;
      if (job.status === "cancelled") {
        if (mapped[0]) {
          const { response } = await googleRequest(
            job.user_id,
            endpoint + "?sendUpdates=none",
            { method: "DELETE" },
            job.account_sub,
          );
          if (!response.ok && ![404, 410].includes(response.status))
            throw Error("Sync failed");
        }
      } else {
        const payload = {
          id: eventId,
          summary: job.title,
          visibility: "private",
          location: job.location,
          description: `Zenvio appointment\nGuest: ${job.guest_name}\nEmail: ${job.guest_email}\nManage this appointment in Zenvio.`,
          start: { dateTime: new Date(job.starts_at).toISOString() },
          end: { dateTime: new Date(job.ends_at).toISOString() },
          extendedProperties: {
            private: { zenvioBookingId: job.id, zenvioOwnerId: job.user_id },
          },
        };
        let { response } = await googleRequest(
          job.user_id,
          "calendars/primary/events?sendUpdates=none",
          { method: "POST", body: JSON.stringify(payload) },
          job.account_sub,
        );
        if (response.status === 409) {
          const existing = await googleRequest(
            job.user_id,
            endpoint,
            {},
            job.account_sub,
          );
          if (!existing.response.ok) throw Error("Sync failed");
          const found = await existing.response.json();
          if (
            found.extendedProperties?.private?.zenvioBookingId !== job.id ||
            found.extendedProperties?.private?.zenvioOwnerId !== job.user_id
          )
            throw Error("Event ownership mismatch");
          const { id: _, ...update } = payload;
          response = (
            await googleRequest(
              job.user_id,
              endpoint + "?sendUpdates=none",
              { method: "PATCH", body: JSON.stringify(update) },
              job.account_sub,
            )
          ).response;
        }
        if (!response.ok) throw Error("Sync failed");
      }
      const c = await getPool().connect();
      try {
        await c.query("BEGIN");
        await c.query(
          "INSERT INTO private.google_calendar_events(user_id,account_sub,booking_id,event_id,status) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,account_sub,booking_id) DO UPDATE SET status=$5,synced_at=now()",
          [job.user_id, job.account_sub, job.id, eventId, job.status],
        );
        const deleted = await c.query(
          "DELETE FROM private.google_calendar_jobs WHERE booking_id=$1 AND claim_token=$2 AND revision=$3 RETURNING booking_id",
          [job.id, claim, claimed.revision],
        );
        if (!deleted.rows.length)
          await c.query(
            "UPDATE private.google_calendar_jobs SET locked_until=NULL,claim_token=NULL WHERE booking_id=$1 AND claim_token=$2",
            [job.id, claim],
          );
        await c.query(
          "UPDATE private.google_calendar_connections SET last_sync_at=now(),last_error=NULL WHERE user_id=$1 AND account_sub=$2",
          [job.user_id, job.account_sub],
        );
        await c.query("COMMIT");
        completed++;
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      } finally {
        c.release();
      }
    } catch {
      await getPool().query(
        "UPDATE private.google_calendar_jobs SET attempts=CASE WHEN revision=$3 THEN attempts+1 ELSE attempts END,not_before=CASE WHEN revision=$3 THEN now()+interval '5 minutes' ELSE now() END,locked_until=NULL,claim_token=NULL,last_error='Calendar update could not be delivered.' WHERE booking_id=$1 AND claim_token=$2",
        [claimed.booking_id, claim, claimed.revision],
      );
      await getPool().query(
        "UPDATE private.google_calendar_connections SET last_error='One or more calendar updates need retry.' WHERE user_id=$1",
        [claimed.user_id],
      );
    }
  }
  return completed;
}
export async function disconnectGoogle(userId: string) {
  let revoked = true;
  const { rows } = await getPool().query(
    "SELECT refresh_ciphertext FROM private.google_calendar_connections WHERE user_id=$1",
    [userId],
  );
  if (rows[0]) {
    try {
      const oauth = new OAuth2Client({
        transporterOptions: { timeout: 15000 },
      });
      await oauth.revokeToken(unsealSecret(rows[0].refresh_ciphertext));
    } catch {
      revoked = false;
    }
  }
  const c = await getPool().connect();
  try {
    await c.query("BEGIN");
    await c.query(
      "DELETE FROM private.google_calendar_connections WHERE user_id=$1",
      [userId],
    );
    await c.query(
      "DELETE FROM private.google_calendar_oauth WHERE user_id=$1",
      [userId],
    );
    await c.query("DELETE FROM private.google_calendar_jobs WHERE user_id=$1", [
      userId,
    ]);
    await c.query(
      "INSERT INTO private.operation_log(actor_id,action) VALUES($1,'google_calendar_disconnected')",
      [userId],
    );
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
  return { revocationConfirmed: revoked };
}

export async function filterGoogleSlots(
  host: string,
  eventSlug: string,
  starts: string[],
) {
  if (!starts.length) return starts;
  const { rows } = await getPool().query(
    "SELECT e.duration,e.buffer FROM public.event_types e JOIN public.profiles p ON p.id=e.user_id JOIN private.google_calendar_connections g ON g.user_id=p.id WHERE p.slug=$1 AND e.slug=$2 AND e.active AND e.deleted_at IS NULL AND g.check_conflicts",
    [host, eventSlug],
  );
  if (!rows[0]) return starts;
  const { duration, buffer } = rows[0],
    windows = starts.map((s) => ({
      start: new Date(Date.parse(s) - buffer * 60000).toISOString(),
      end: new Date(Date.parse(s) + (duration + buffer) * 60000).toISOString(),
    }));
  const from = windows.reduce(
      (a, b) => (a < b.start ? a : b.start),
      windows[0].start,
    ),
    to = windows.reduce((a, b) => (a > b.end ? a : b.end), windows[0].end),
    busy = await googleBusyForHost(host, from, to);
  return starts.filter(
    (_, i) => !overlapsBusy(windows[i].start, windows[i].end, busy),
  );
}

export async function runGoogleJobsForHost(host: string) {
  const { rows } = await getPool().query(
    "SELECT id FROM public.profiles WHERE slug=$1",
    [host],
  );
  if (rows[0]) await runGoogleJobs(rows[0].id);
}
export async function runGoogleJobsForCancellation(cancelToken: string) {
  const { rows } = await getPool().query(
    "SELECT user_id FROM public.bookings WHERE cancel_token=$1",
    [cancelToken],
  );
  if (rows[0]) await runGoogleJobs(rows[0].user_id);
}
