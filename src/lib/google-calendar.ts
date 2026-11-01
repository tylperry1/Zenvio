import type {ExternalCalendarMetadataSnapshot} from "./launch/contracts";
import {externalReference,externalEditingEnabled,calendarVersion,googleExternalReason,assertExternalUpdate,externalCalendarAudit,type ExternalCalendarUpdate} from "./external-calendar-policy";
import {calendarIntakeSummary} from "./calendar-invitation.mjs";
import { requireCapacity } from "./entitlements";
import { OAuth2Client, CodeChallengeMethod } from "google-auth-library";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getPool } from "./db";
import {
  integrationValue,
  sealSecret,
  unsealSecret,
} from "./platform-settings";
import { ApiError } from "./server";
import { calendarIssue, type CalendarIssue } from "./google-calendar-errors";
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
    prompt: "consent select_account",
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
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      "google-accounts:" + userId,
    ]);
    if (
      !(
        await c.query(
          "SELECT 1 FROM private.google_calendar_connections WHERE user_id=$1 AND account_sub=$2",
          [userId, identity.sub],
        )
      ).rowCount
    )
      await requireCapacity(c, userId, "calendars");
    const existingAccounts = await c.query(
      "SELECT count(*)::int AS count FROM private.google_calendar_connections WHERE user_id=$1 AND account_sub<>$2",
      [userId, identity.sub],
    );
    if (existingAccounts.rows[0].count >= 5)
      throw new ApiError(
        "You can connect up to five Google accounts. Disconnect one before adding another.",
        409,
      );
    await c.query(
      "INSERT INTO private.google_calendar_connections(user_id,account_sub,account_email,access_ciphertext,refresh_ciphertext,expires_at,scope) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(user_id,account_sub) DO UPDATE SET account_email=$3,access_ciphertext=$4,refresh_ciphertext=$5,expires_at=$6,scope=$7,status='connected',last_sync_at=NULL,last_error=NULL,updated_at=now()",
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
      "UPDATE private.google_calendar_jobs SET attempts=0,not_before=now() WHERE user_id=$1",
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
async function access(
  userId: string,
  expectedAccount?: string,
  forceRefresh = false,
) {
  const c = await getPool().connect();
  try {
    await c.query("BEGIN");
    const { rows } = await c.query(
        "SELECT * FROM private.google_calendar_connections WHERE user_id=$1 AND ($2::text IS NULL OR account_sub=$2) ORDER BY created_at LIMIT 1 FOR UPDATE",
        [userId, expectedAccount || null],
      ),
      row = rows[0];
    if (!row) throw new ApiError("Connect Google Calendar first.", 409);
    if (row.status !== "connected")
      throw new ApiError(
        "Reconnect Google Calendar to restore synchronization.",
        409,
      );
    let token = unsealSecret(row.access_ciphertext);
    if (
      forceRefresh ||
      new Date(row.expires_at).getTime() < Date.now() + 60000
    ) {
      const oauth = await oauthClient();
      oauth.setCredentials({
        refresh_token: unsealSecret(row.refresh_ciphertext),
      });
      try {
        const { credentials } = await oauth.refreshAccessToken();
        if (!credentials.access_token) throw Error("Missing token");
        token = credentials.access_token;
        await c.query(
          "UPDATE private.google_calendar_connections SET access_ciphertext=$2,refresh_ciphertext=$3,expires_at=$4,updated_at=now() WHERE user_id=$1 AND account_sub=$5",
          [
            userId,
            sealSecret(token),
            credentials.refresh_token
              ? sealSecret(credentials.refresh_token)
              : row.refresh_ciphertext,
            new Date(credentials.expiry_date || Date.now() + 3500000),
            row.account_sub,
          ],
        );
      } catch (e) {
        const invalid =
          (e as { response?: { data?: { error?: string } } }).response?.data
            ?.error === "invalid_grant";
        if (invalid) {
          await c.query(
            "UPDATE private.google_calendar_connections SET status='reconnect_required',last_error='Google authorization expired or was revoked.' WHERE user_id=$1 AND account_sub=$2",
            [userId, row.account_sub],
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
  const { token, accountSub } = await access(userId, expectedAccount);
  if (expectedAccount && accountSub !== expectedAccount)
    throw new ApiError(
      "The connected Google account changed. Retry synchronization.",
      409,
    );
  let response = await fetch(`https://www.googleapis.com/calendar/v3/${path}`, {
    ...options,
    headers: {
      ...Object.fromEntries(new Headers(options.headers)),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(12000),
    cache: "no-store",
  });
  // A token can be invalidated before its stored expiry. Refresh once before
  // treating the account as disconnected; retry the identical idempotent request.
  if (response.status === 401) {
    const fresh = await access(userId, accountSub, true);
    response = await fetch(`https://www.googleapis.com/calendar/v3/${path}`, {
      ...options,
      headers: {
        ...Object.fromEntries(new Headers(options.headers)),
        Authorization: `Bearer ${fresh.token}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(12000),
      cache: "no-store",
    });
  }
  if (response.status === 401) {
    await getPool().query(
      "UPDATE private.google_calendar_connections SET status='reconnect_required',last_error='Reconnect Google Calendar to restore access.' WHERE user_id=$1 AND account_sub=$2",
      [userId, accountSub],
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
class AvailabilityFailure extends Error {
  constructor(public issue: CalendarIssue) {
    super(issue.message);
  }
}
async function readGoogleBusy(
  userId: string,
  accountSub: string,
  start: string,
  end: string,
) {
  try {
    const { response } = await googleRequest(
      userId,
      "freeBusy",
      {
        method: "POST",
        body: JSON.stringify({
          timeMin: start,
          timeMax: end,
          items: [{ id: "primary" }],
        }),
      },
      accountSub,
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new AvailabilityFailure(calendarIssue(response.status, data));
    const calendars = Object.values(data.calendars || {}) as {
      errors?: { reason?: string }[];
      busy?: { start: string; end: string }[];
    }[];
    const primary =
      data.calendars?.primary || (calendars.length === 1 ? calendars[0] : null);
    if (primary?.errors?.length) {
      const reasons = primary.errors.map((e: { reason?: string }) => e.reason);
      const status = reasons.includes("notFound")
        ? 404
        : reasons.includes("forbidden")
          ? 403
          : 503;
      throw new AvailabilityFailure(
        calendarIssue(status, { error: { errors: primary.errors } }),
      );
    }
    if (
      !primary ||
      !Array.isArray(primary.busy) ||
      !primary.busy.every(
        (b: { start: string; end: string }) =>
          Number.isFinite(Date.parse(b.start)) &&
          Number.isFinite(Date.parse(b.end)) &&
          Date.parse(b.end) > Date.parse(b.start),
      )
    )
      throw new AvailabilityFailure(calendarIssue(503));
    await getPool().query(
      "UPDATE private.google_calendar_connections SET last_error=NULL WHERE user_id=$1 AND account_sub=$2",
      [userId, accountSub],
    );
    return primary.busy as { start: string; end: string }[];
  } catch (error) {
    const issue =
      error instanceof AvailabilityFailure
        ? error.issue
        : error instanceof ApiError && error.status === 409
          ? calendarIssue(401)
          : calendarIssue(503);
    await getPool()
      .query(
        "UPDATE private.google_calendar_connections SET last_error=$3 WHERE user_id=$1 AND account_sub=$2",
        [userId, accountSub, issue.message],
      )
      .catch(() => {});
    // Log only allowlisted diagnostics; never provider bodies, tokens, event data or email.
    console.warn("Google Calendar availability check failed", {
      code: issue.code,
      status: issue.status,
    });
    throw new AvailabilityFailure(issue);
  }
}
export async function checkGoogleConnection(
  userId: string,
  accountSub: string,
) {
  const owned = await getPool().query(
    "SELECT 1 FROM private.google_calendar_connections WHERE user_id=$1 AND account_sub=$2",
    [userId, accountSub],
  );
  if (!owned.rowCount) throw new ApiError("Google account not found.", 404);
  const start = new Date(),
    end = new Date(start.getTime() + 86400000);
  try {
    await readGoogleBusy(
      userId,
      accountSub,
      start.toISOString(),
      end.toISOString(),
    );
    return {
      ok: true,
      checkedAt: new Date().toISOString(),
      message:
        "Google Calendar availability access is working for this account.",
    };
  } catch (error) {
    if (error instanceof AvailabilityFailure)
      return {
        ok: false,
        code: error.issue.code,
        message: error.issue.message,
      };
    throw error;
  }
}
export async function googleBusyForHost(
  host: string,
  start: string,
  end: string,
) {
  const { rows } = await getPool().query(
    "SELECT p.id,c.account_sub FROM public.profiles p JOIN private.google_calendar_connections c ON c.user_id=p.id WHERE p.slug=$1 AND c.check_conflicts",
    [host],
  );
  const combined: { start: string; end: string }[] = [];
  for (const row of rows) {
    try {
      combined.push(
        ...(await readGoogleBusy(row.id, row.account_sub, start, end)),
      );
    } catch {
      throw new ApiError(
        "Calendar availability is temporarily unavailable. Please try again later.",
        503,
      );
    }
  }
  return combined;
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
        "SELECT b.*,e.title,e.location,g.account_sub FROM public.bookings b JOIN public.event_types e ON e.id=b.event_id JOIN private.google_calendar_connections g ON g.user_id=b.user_id WHERE b.id=$1 AND g.sync_events",
        [claimed.booking_id],
      );
      if (!rows.length) throw Error("Disconnected");
      for (const job of rows) {
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
            description: `Zenvio appointment\nGuest: ${job.guest_name}\nEmail: ${job.guest_email}\nManage this appointment in Zenvio.`+(calendarIntakeSummary(job.intake_snapshot)?"\n\nBooking details:\n"+calendarIntakeSummary(job.intake_snapshot):""),
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
          await c.query(
            "UPDATE private.google_calendar_connections SET last_sync_at=now(),last_error=NULL WHERE user_id=$1 AND account_sub=$2",
            [job.user_id, job.account_sub],
          );
          await c.query("COMMIT");
        } catch (e) {
          await c.query("ROLLBACK");
          throw e;
        } finally {
          c.release();
        }
      }
      const deleted = await getPool().query(
        "DELETE FROM private.google_calendar_jobs WHERE booking_id=$1 AND claim_token=$2 AND revision=$3 RETURNING booking_id",
        [claimed.booking_id, claim, claimed.revision],
      );
      if (!deleted.rows.length)
        await getPool().query(
          "UPDATE private.google_calendar_jobs SET locked_until=NULL,claim_token=NULL WHERE booking_id=$1 AND claim_token=$2",
          [claimed.booking_id, claim],
        );
      completed++;
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
export async function disconnectGoogle(userId: string, accountSub?: string) {
  let revoked = true;
  const { rows } = await getPool().query(
    "SELECT refresh_ciphertext FROM private.google_calendar_connections WHERE user_id=$1 AND ($2::text IS NULL OR account_sub=$2)",
    [userId, accountSub || null],
  );
  for (const row of rows) {
    try {
      const oauth = new OAuth2Client({
        transporterOptions: { timeout: 15000 },
      });
      await oauth.revokeToken(unsealSecret(row.refresh_ciphertext));
    } catch {
      revoked = false;
    }
  }
  const c = await getPool().connect();
  try {
    await c.query("BEGIN");
    await c.query(
      "DELETE FROM private.google_calendar_connections WHERE user_id=$1 AND ($2::text IS NULL OR account_sub=$2)",
      [userId, accountSub || null],
    );
    await c.query(
      "DELETE FROM private.google_calendar_oauth WHERE user_id=$1",
      [userId],
    );
    await c.query(
      "DELETE FROM private.google_calendar_jobs WHERE user_id=$1 AND NOT EXISTS(SELECT 1 FROM private.google_calendar_connections WHERE user_id=$1 AND sync_events)",
      [userId],
    );
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

// Ephemeral calendar display. Events copied from Zenvio are excluded, not duplicated.
export async function calendarDisplay(
  userId: string,
  accountSub: string,
  start: string,
  end: string,
) {
  const c = (
    await getPool().query(
      "SELECT scope,account_email FROM private.google_calendar_connections WHERE user_id=$1 AND account_sub=$2",
      [userId, accountSub],
    )
  ).rows[0];
  if (!c) throw new ApiError("Google account not found.", 404);
  if (
    !String(c.scope)
      .split(" ")
      .some((s) =>
        [
          "https://www.googleapis.com/auth/calendar",
          "https://www.googleapis.com/auth/calendar.events",
          "https://www.googleapis.com/auth/calendar.events.readonly",
        ].includes(s),
      )
  ) {
    const busy = await readGoogleBusy(userId, accountSub, start, end);
    return busy.map((b, i) => ({
      id: accountSub + ":busy:" + i,
      title: "Busy",
      starts_at: b.start,
      ends_at: b.end,
      source: accountSub,
      readOnly: true,
    }));
  }
  const result: any[] = [];
  let page = "";
  for (let n = 0; n < 5; n++) {
    const q = new URLSearchParams({
      timeMin: start,
      timeMax: end,
      singleEvents: "true",
      maxResults: "500",
      fields:
        "items(id,summary,start,end,status,extendedProperties/private),nextPageToken",
      ...(page ? { pageToken: page } : {}),
    });
    const { response } = await googleRequest(
      userId,
      "calendars/primary/events?" + q,
      {},
      accountSub,
    );
    if (!response.ok)
      throw new ApiError(
        "Google events could not be loaded. Check this account’s connection.",
        503,
      );
    const data = await response.json();
    for (const e of data.items || []) {
      if (
        e.status === "cancelled" ||
        e.extendedProperties?.private?.zenvioOwnerId === userId
      )
        continue;
      result.push({
        id: accountSub + ":" + e.id,
        title: e.summary || "Busy",
        starts_at: e.start?.dateTime || e.start?.date,
        ends_at: e.end?.dateTime || e.end?.date,
        allDay: !!e.start?.date,
        source: accountSub,
        readOnly: true,
      });
    }
    page = data.nextPageToken;
    if (!page) return result;
  }
  throw new ApiError(
    "Too many external events. Choose a smaller date range.",
    409,
  );
  return result;
}
export async function drainCalendarCleanup(user?: string) {
  const db = await getPool().connect();
  try {
    await db.query("BEGIN");
    const jobs = (
      await db.query(
        `SELECT * FROM private.google_calendar_cleanup WHERE completed_at IS NULL AND attempts<8 ${user ? "AND user_id=$1" : ""} ORDER BY created_at LIMIT 10 FOR UPDATE SKIP LOCKED`,
        user ? [user] : [],
      )
    ).rows;
    for (const j of jobs) {
      try {
        const existing = await googleRequest(
          j.user_id,
          "calendars/primary/events/" + encodeURIComponent(j.event_id),
          {},
          j.account_sub,
        );
        if (![404, 410].includes(existing.response.status)) {
          if (!existing.response.ok) throw Error("Access unavailable");
          const e = await existing.response.json();
          if (
            e.extendedProperties?.private?.zenvioOwnerId !== j.user_id ||
            e.extendedProperties?.private?.zenvioBookingId !== j.booking_id
          )
            throw Error("Ownership mismatch");
          const r = await googleRequest(
            j.user_id,
            "calendars/primary/events/" +
              encodeURIComponent(j.event_id) +
              "?sendUpdates=none",
            { method: "DELETE" },
            j.account_sub,
          );
          if (!r.response.ok && ![404, 410].includes(r.response.status))
            throw Error("Delete failed");
        }
        await db.query(
          "UPDATE private.google_calendar_cleanup SET completed_at=now(),last_error=NULL WHERE id=$1",
          [j.id],
        );
      } catch {
        await db.query(
          "UPDATE private.google_calendar_cleanup SET attempts=attempts+1,last_error='Previous staff calendar copy needs cleanup. Reconnect the previous account and retry.' WHERE id=$1",
          [j.id],
        );
      }
    }
    await db.query("COMMIT");
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
}

/** Primary-calendar metadata edits only. Booking, attendee and time changes stay in their existing workflows. */
export async function googleExternalEvent(userId:string,accountSub:string,eventId:string,update?:ExternalCalendarUpdate){
 externalReference("google",accountSub,eventId);
 const enabled=externalEditingEnabled("google");
 if(update&&!enabled)throw new ApiError("Google external editing has not passed release validation.",503);
 const c=(await getPool().query("select scope,status from private.google_calendar_connections where user_id=$1 and account_sub=$2",[userId,accountSub])).rows[0];
 if(!c)throw new ApiError("Google account not found.",404);
 if(c.status!=="connected")throw new ApiError("Reconnect Google Calendar.",409);
 const path="calendars/primary/events/"+encodeURIComponent(eventId);
 const current=await googleRequest(userId,path,{},accountSub);
 if(current.response.status===404||current.response.status===410)throw new ApiError("External event not found.",404);
 if(!current.response.ok)throw new ApiError("Google event could not be verified.",503);
 const event=await current.response.json();
 if(event.id!==eventId)throw new ApiError("Google event reference could not be verified.",503);
 const linked=(await getPool().query("select 1 from private.google_calendar_events where user_id=$1 and account_sub=$2 and event_id=$3 limit 1",[userId,accountSub,eventId])).rows.length>0;
 const reason=googleExternalReason(event,String(c.scope||""),linked),count=Array.isArray(event.attendees)?event.attendees.length:0;
 const snapshot=(e:any):ExternalCalendarMetadataSnapshot=>({provider:"google",accountId:accountSub,eventId,title:e.summary||"",location:e.location||"",start:e.start||null,end:e.end||null,version:calendarVersion(e.etag),attendeeCount:count,requiresNotificationConfirmation:count>0,editableFields:reason||!enabled?[]:["title","location"],readOnly:Boolean(reason)||!enabled,blockedReason:reason||(!enabled?"Google external editing has not passed release validation.":null)});
 if(!update)return snapshot(event);
 assertExternalUpdate(reason,calendarVersion(event.etag),count,update);
 if(event.summary===update.title && (event.location||"")===update.location)return {...snapshot(event),unchanged:true};
 await externalCalendarAudit(userId,"google",eventId,"requested");
 let patched:Awaited<ReturnType<typeof googleRequest>>;
 try{
  patched=await googleRequest(userId,path+"?sendUpdates=all",{method:"PATCH",headers:{"If-Match":update.version},body:JSON.stringify({summary:update.title,location:update.location})},accountSub);
 }catch{
  await externalCalendarAudit(userId,"google",eventId,"uncertain").catch(()=>{});
  throw new ApiError("Calendar update outcome is unknown. Refresh the event before trying again.",503);
 }
 if(patched.response.status===412){await externalCalendarAudit(userId,"google",eventId,"conflict");throw new ApiError("This event changed. Refresh it before editing.",409);}
 if(!patched.response.ok){await externalCalendarAudit(userId,"google",eventId,"unconfirmed");throw new ApiError("Calendar update was not confirmed. Refresh the event before trying again.",503);}
 const result=await patched.response.json().catch(()=>null);
 if(!result || result.id!==eventId || result.summary!==update.title || (result.location||"")!==update.location || !calendarVersion(result.etag) || result.etag===update.version){await externalCalendarAudit(userId,"google",eventId,"unverified").catch(()=>{});throw new ApiError("Calendar update could not be verified. Refresh the event.",503);}
 await externalCalendarAudit(userId,"google",eventId,"confirmed");
 return snapshot(result);
}
