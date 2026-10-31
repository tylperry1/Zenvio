import { createHash, randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { getPool } from "./db";

type DB = Pick<PoolClient, "query">;
export type Attribution = { source: string; medium: string | null; campaign: string | null; referrerHost: string | null };

const TOKEN = /^[a-z0-9][a-z0-9_.-]{0,39}$/;
// Well-known referrers map to a readable source when no explicit tag is present.
const REFERRERS: [RegExp, string][] = [
  [/(^|\.)google\./, "google"],
  [/(^|\.)bing\.com$/, "bing"],
  [/(^|\.)duckduckgo\.com$/, "duckduckgo"],
  [/(^|\.)(facebook|fb)\.com$|(^|\.)m\.facebook\.com$/, "facebook"],
  [/(^|\.)instagram\.com$/, "instagram"],
  [/(^|\.)(t\.co|twitter\.com|x\.com)$/, "x"],
  [/(^|\.)linkedin\.com$|(^|\.)lnkd\.in$/, "linkedin"],
  [/(^|\.)tiktok\.com$/, "tiktok"],
  [/(^|\.)youtube\.com$/, "youtube"],
];

export function normalizeToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 40);
  return TOKEN.test(v) ? v : null;
}

/** Validates client-reported attribution. Unknown or malformed input becomes "direct". */
export function cleanAttribution(input: unknown, ownHost?: string): Attribution {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  let referrerHost: string | null = null;
  if (typeof raw.referrer === "string" && raw.referrer.length <= 2048) {
    try {
      const host = new URL(raw.referrer).hostname.toLowerCase();
      if (host && host !== ownHost && !host.endsWith(".gozenvio.com") && host !== "gozenvio.com") referrerHost = host.slice(0, 255);
    } catch {
      /* ignore malformed referrers */
    }
  }
  const explicit = normalizeToken(raw.source);
  const fromReferrer = referrerHost ? REFERRERS.find(([re]) => re.test(referrerHost!))?.[1] || "referral" : null;
  const campaign = typeof raw.campaign === "string" ? raw.campaign.trim().slice(0, 80) || null : null;
  return {
    source: explicit || fromReferrer || "direct",
    medium: normalizeToken(raw.medium),
    campaign,
    referrerHost,
  };
}

/** Owner comes from the booking row itself, never from client input. */
export async function recordBookingSource(bookingId: string, attribution: Attribution, db: DB = getPool()) {
  await db.query(
    `INSERT INTO private.booking_sources(booking_id,user_id,source,medium,campaign,referrer_host)
     SELECT b.id,b.user_id,$2,$3,$4,$5 FROM public.bookings b WHERE b.id=$1
     ON CONFLICT (booking_id) DO NOTHING`,
    [bookingId, attribution.source, attribution.medium, attribution.campaign, attribution.referrerHost],
  );
}

export async function recordPageView(ownerId: string, source: string, db: DB = getPool()) {
  await db.query(
    `INSERT INTO private.booking_page_views(user_id,day,source,views) VALUES($1,(now() AT TIME ZONE 'UTC')::date,$2,1)
     ON CONFLICT (user_id,day,source) DO UPDATE SET views=booking_page_views.views+1`,
    [ownerId, source],
  );
}

/** Per-source views, bookings and conversion for the owner's own booking pages. */
export async function sourceReport(ownerId: string, days: number, db: DB = getPool()) {
  const since = `now()-make_interval(days=>$2)`;
  const [rows, daily, untracked, campaigns] = await Promise.all([
    db.query(
      `WITH v AS (SELECT source,sum(views)::int views FROM private.booking_page_views WHERE user_id=$1 AND day>=(${since})::date GROUP BY 1),
            b AS (SELECT s.source,count(*)::int bookings,count(*) FILTER (WHERE bk.status='confirmed')::int confirmed
                    FROM private.booking_sources s JOIN public.bookings bk ON bk.id=s.booking_id
                   WHERE s.user_id=$1 AND s.created_at>=${since} GROUP BY 1)
       SELECT coalesce(v.source,b.source) source,coalesce(v.views,0) views,coalesce(b.bookings,0) bookings,coalesce(b.confirmed,0) confirmed
         FROM v FULL JOIN b ON b.source=v.source ORDER BY bookings DESC,views DESC,source`,
      [ownerId, days],
    ),
    db.query(
      `SELECT d::date AS day,
              (SELECT coalesce(sum(views),0)::int FROM private.booking_page_views WHERE user_id=$1 AND day=d::date) views,
              (SELECT count(*)::int FROM private.booking_sources WHERE user_id=$1 AND created_at>=d AND created_at<d+interval '1 day') bookings
         FROM generate_series(date_trunc('day',now() AT TIME ZONE 'UTC')-make_interval(days=>$2-1),date_trunc('day',now() AT TIME ZONE 'UTC'),interval '1 day') d`,
      [ownerId, days],
    ),
    db.query(
      `SELECT count(*)::int count FROM public.bookings b
        WHERE b.user_id=$1 AND b.created_at>=${since} AND NOT EXISTS(SELECT 1 FROM private.booking_sources s WHERE s.booking_id=b.id)`,
      [ownerId, days],
    ),
    db.query(
      `SELECT campaign,source,count(*)::int bookings FROM private.booking_sources
        WHERE user_id=$1 AND created_at>=${since} AND campaign IS NOT NULL GROUP BY 1,2 ORDER BY 3 DESC LIMIT 10`,
      [ownerId, days],
    ),
  ]);
  return { sources: rows.rows, daily: daily.rows, untracked: untracked.rows[0].count, campaigns: campaigns.rows };
}

// ---------- Reviews ----------
export const hiddenReasons = {
  personal_information: "Contains personal information",
  offensive: "Offensive or abusive language",
  not_about_business: "Not about this business",
  spam: "Spam",
} as const;
export type HiddenReason = keyof typeof hiddenReasons;
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export function newReviewToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}
export const REVIEW_LINK_DAYS = 30;

/** Public summary counts every submitted rating so hiding text never changes the score. */
export async function publicReviews(ownerId: string, db: DB = getPool()) {
  const [summary, recent] = await Promise.all([
    db.query(
      `SELECT count(*)::int total,round(avg(rating)::numeric,1)::float average,
              count(*) FILTER (WHERE rating=5)::int r5,count(*) FILTER (WHERE rating=4)::int r4,count(*) FILTER (WHERE rating=3)::int r3,
              count(*) FILTER (WHERE rating=2)::int r2,count(*) FILTER (WHERE rating=1)::int r1
         FROM private.reviews WHERE user_id=$1`,
      [ownerId],
    ),
    db.query(
      `SELECT r.id,r.rating,r.comment,r.display_name,r.owner_reply,r.created_at,e.title service
         FROM private.reviews r JOIN public.bookings b ON b.id=r.booking_id LEFT JOIN public.event_types e ON e.id=b.event_id
        WHERE r.user_id=$1 AND r.public_consent AND r.hidden_reason IS NULL AND length(r.comment)>0
        ORDER BY r.created_at DESC LIMIT 6`,
      [ownerId],
    ),
  ]);
  return { summary: summary.rows[0], reviews: recent.rows };
}

/** Sends a review request through Resend. The link carries the token in the URL fragment. */
export async function sendReviewRequestEmail(input: { to: string; business: string; service: string; link: string; requestId: string }) {
  const [{ integrationValue }, { resendFailure }] = await Promise.all([import("./platform-settings"), import("./resend-diagnostics")]);
  const [key, from] = await Promise.all([integrationValue("RESEND_API_KEY"), integrationValue("AUTH_EMAIL_FROM")]);
  if (!key.trim() || !from.trim()) throw new Error("Email is not configured.");
  const subject = `How was your ${input.service} with ${input.business}?`;
  const text = [
    `Thanks for your recent ${input.service} with ${input.business}.`,
    "",
    "Would you share a quick rating? It takes less than a minute:",
    input.link,
    "",
    "Only people who booked an appointment receive this link, and it can be used once.",
    "If you'd rather not, simply ignore this email.",
  ].join("\n");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key.trim()}`, "Content-Type": "application/json", "Idempotency-Key": `review-${input.requestId}` },
    body: JSON.stringify({ from: from.trim(), to: input.to, subject, text }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw resendFailure(response.status, await response.json().catch(() => ({})));
}
