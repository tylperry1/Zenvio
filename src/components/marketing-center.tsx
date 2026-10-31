"use client";
import QRCode from "qrcode";
import { useEffect, useMemo, useState } from "react";
import { Badge, BarChart, EmptyState, Kpi, Notice, PageHeader, Panel, Segmented, Skeleton, formatDate, relativeTime } from "./ds";
import { Icon } from "./icons";

type Workspace = { profile: { slug: string; name: string }; events: { slug: string; title: string; active: boolean; deleted_at?: string | null }[] };
type Sources = {
  sources: { source: string; views: number; bookings: number; confirmed: number }[];
  daily: { day: string; views: number; bookings: number }[];
  untracked: number;
  campaigns: { campaign: string; source: string; bookings: number }[];
};
type Review = {
  id: string;
  rating: number;
  comment: string;
  display_name: string | null;
  public_consent: boolean;
  hidden_reason: string | null;
  owner_reply: string | null;
  created_at: string;
  guest_name: string;
  starts_at: string;
  service: string | null;
};
type Reviews = {
  summary: { total: number; average: number | null; r5: number; r4: number; r3: number; r2: number; r1: number };
  reviews: Review[];
  eligible: { id: string; guest_name: string; guest_email: string; starts_at: string; service: string | null }[];
  requests: { sent: number; completed: number; open: number };
  mail: boolean;
  hiddenReasons: Record<string, string>;
};

const presets = [
  ["instagram", "Instagram bio"],
  ["facebook", "Facebook"],
  ["google", "Google Business Profile"],
  ["email", "Email signature"],
  ["website", "Your website"],
  ["flyer", "Print / flyer"],
] as const;
const sourceNames: Record<string, string> = {
  direct: "Direct / unknown",
  widget: "Website widget",
  qr: "QR code",
  referral: "Other websites",
  google: "Google",
  facebook: "Facebook",
  instagram: "Instagram",
  email: "Email",
  website: "Your website",
  flyer: "Print / flyer",
  linkedin: "LinkedIn",
  x: "X",
  tiktok: "TikTok",
  youtube: "YouTube",
  bing: "Bing",
  duckduckgo: "DuckDuckGo",
};
const stars = (n: number) => "★★★★★".slice(0, n) + "☆☆☆☆☆".slice(0, 5 - n);
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 1000) / 10}%` : "—");

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function MarketingCenter() {
  const [tab, setTab] = useState<"share" | "sources" | "reviews">("share");
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const t = new URLSearchParams(location.search).get("tab");
    if (t === "sources" || t === "reviews") setTab(t);
    fetch("/api/workspace", { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Unable to load your workspace.");
        setWorkspace(d);
      })
      .catch((e) => setError(e.message));
  }, []);
  return (
    <div className="ds-root mk">
      <PageHeader
        title="Marketing & reviews"
        description="Share your booking page everywhere, see which channels bring appointments, and collect verified reviews from real clients."
      />
      <Segmented
        label="Marketing sections"
        value={tab}
        onChange={(v) => {
          setTab(v);
          history.replaceState(null, "", `/app/marketing${v === "share" ? "" : `?tab=${v}`}`);
        }}
        options={[["share", "Share & embed"], ["sources", "Booking sources"], ["reviews", "Reviews"]] as const}
      />
      {error && <Notice tone="danger">{error}</Notice>}
      {tab === "share" && (workspace ? <Share workspace={workspace} /> : !error && <Skeleton height={320} />)}
      {tab === "sources" && <SourcesTab />}
      {tab === "reviews" && <ReviewsTab />}
    </div>
  );
}

function Share({ workspace }: { workspace: Workspace }) {
  const origin = typeof window === "undefined" ? "https://gozenvio.com" : window.location.origin;
  const events = workspace.events.filter((e) => e.active && !e.deleted_at);
  const [event, setEvent] = useState("");
  const [source, setSource] = useState("instagram");
  const [custom, setCustom] = useState("");
  const [campaign, setCampaign] = useState("");
  const [qr, setQr] = useState("");
  const [copied, setCopied] = useState("");
  const base = `${origin}/book/${workspace.profile.slug}${event ? `/${event}` : ""}`;
  const src = source === "custom" ? custom.trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, "-").slice(0, 40) : source;
  const link = useMemo(() => {
    const u = new URL(base);
    if (src) u.searchParams.set("src", src);
    if (campaign.trim()) u.searchParams.set("utm_campaign", campaign.trim().slice(0, 80));
    return u.toString();
  }, [base, src, campaign]);
  const qrLink = useMemo(() => {
    const u = new URL(base);
    u.searchParams.set("src", "qr");
    if (campaign.trim()) u.searchParams.set("utm_campaign", campaign.trim().slice(0, 80));
    return u.toString();
  }, [base, campaign]);

  useEffect(() => {
    QRCode.toString(qrLink, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#151b38", light: "#ffffff" } })
      .then(setQr)
      .catch(() => setQr(""));
  }, [qrLink]);

  async function copy(id: string, text: string) {
    if (await copyText(text)) {
      setCopied(id);
      setTimeout(() => setCopied(""), 1600);
    }
  }
  async function downloadPng() {
    const url = await QRCode.toDataURL(qrLink, { width: 1024, margin: 2, color: { dark: "#151b38", light: "#ffffff" } });
    const a = document.createElement("a");
    a.href = url;
    a.download = `zenvio-qr-${workspace.profile.slug}${event ? "-" + event : ""}.png`;
    a.click();
  }
  function downloadSvg() {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([qr], { type: "image/svg+xml" }));
    a.download = `zenvio-qr-${workspace.profile.slug}${event ? "-" + event : ""}.svg`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const widget = `<script src="${origin}/widget.js" data-zenvio-host="${workspace.profile.slug}" data-label="Book now" defer></script>`;
  const button = `<a href="${origin}/book/${workspace.profile.slug}?src=website" target="_blank" rel="noopener" style="display:inline-block;padding:12px 20px;border-radius:999px;background:#365cff;color:#fff;font:600 15px sans-serif;text-decoration:none">Book an appointment</a>`;

  return (
    <div className="mk-grid">
      <Panel title="Tracked booking link" description="Add a source so you can see which channels bring bookings. Visitors see your normal booking page.">
        <div className="mk-form">
          <label className="ds-field">
            Page
            <select className="ds-select" value={event} onChange={(e) => setEvent(e.target.value)}>
              <option value="">All services (profile page)</option>
              {events.map((e) => (
                <option key={e.slug} value={e.slug}>
                  {e.title}
                </option>
              ))}
            </select>
          </label>
          <div className="ds-field">
            Where will you share it?
            <div className="mk-chips" role="group" aria-label="Source">
              {presets.map(([id, label]) => (
                <button key={id} type="button" aria-pressed={source === id} onClick={() => setSource(id)}>
                  {label}
                </button>
              ))}
              <button type="button" aria-pressed={source === "custom"} onClick={() => setSource("custom")}>
                Other…
              </button>
            </div>
          </div>
          {source === "custom" && (
            <label className="ds-field">
              Source name
              <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="e.g. newsletter" maxLength={40} />
            </label>
          )}
          <label className="ds-field">
            <span>
              Campaign <small>optional, e.g. spring-promo</small>
            </span>
            <input value={campaign} onChange={(e) => setCampaign(e.target.value)} maxLength={80} />
          </label>
          <div className="mk-link">
            <code>{link}</code>
            <button className="ds-btn sm primary" type="button" onClick={() => void copy("link", link)}>
              {copied === "link" ? "Copied" : "Copy link"}
            </button>
          </div>
        </div>
      </Panel>

      <Panel title="QR code" description="For flyers, business cards, receipts and your front desk. Scans are tracked as “QR code”.">
        <div className="mk-qr">
          <div className="mk-qr-img" aria-label="QR code for your booking page" role="img" dangerouslySetInnerHTML={{ __html: qr }} />
          <div className="mk-qr-actions">
            <button className="ds-btn sm" type="button" onClick={() => void downloadPng()} disabled={!qr}>
              <Icon name="download" size={14} /> PNG
            </button>
            <button className="ds-btn sm" type="button" onClick={downloadSvg} disabled={!qr}>
              <Icon name="download" size={14} /> SVG
            </button>
          </div>
          <small>Points to {event ? "the selected service" : "your profile page"}.</small>
        </div>
      </Panel>

      <Panel title="Website booking button" description="Paste before the closing </body> tag. Adds a floating “Book now” button that opens your booking page in a new tab.">
        <div className="mk-snippet">
          <pre>{widget}</pre>
          <button className="ds-btn sm" type="button" onClick={() => void copy("widget", widget)}>
            {copied === "widget" ? "Copied" : "Copy code"}
          </button>
        </div>
        <p className="mk-muted">
          Options: <code>data-label</code>, <code>data-color</code> (hex), <code>data-position=&quot;left&quot;</code>. No cookies or tracking pixels are added to your site.
        </p>
      </Panel>

      <Panel title="Inline link button" description="A simple styled link for a page, newsletter or link-in-bio tool.">
        <div className="mk-snippet">
          <pre>{button}</pre>
          <button className="ds-btn sm" type="button" onClick={() => void copy("button", button)}>
            {copied === "button" ? "Copied" : "Copy code"}
          </button>
        </div>
        <div className="mk-preview" aria-hidden="true">
          <span>Book an appointment</span>
        </div>
      </Panel>
    </div>
  );
}

function SourcesTab() {
  const [days, setDays] = useState<"30" | "90" | "365">("30");
  const [data, setData] = useState<Sources | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setData(null);
    fetch(`/api/marketing/sources?days=${days}`, { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Unable to load sources.");
        setData(d);
      })
      .catch((e) => setError(e.message));
  }, [days]);
  const views = data?.sources.reduce((s, x) => s + x.views, 0) || 0;
  const bookings = data?.sources.reduce((s, x) => s + x.bookings, 0) || 0;
  const top = data?.sources.filter((s) => s.source !== "direct").sort((a, b) => b.bookings - a.bookings)[0];
  return (
    <div className="mk-stack">
      <div className="mk-toolbar">
        <Segmented label="Date range" value={days} onChange={setDays} options={[["30", "30 days"], ["90", "90 days"], ["365", "12 months"]] as const} />
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="ds-kpis">
        <Kpi label="Booking page visits" icon="globe" loading={!data} value={views.toLocaleString()} detail="Once per visitor session" />
        <Kpi label="Tracked bookings" icon="calendar" loading={!data} value={bookings.toLocaleString()} detail={data ? `${data.untracked} untracked (manual or before tracking)` : undefined} />
        <Kpi label="Conversion" icon="spark" loading={!data} value={pct(bookings, views)} detail="Tracked bookings ÷ visits" />
        <Kpi label="Top channel" icon="link" loading={!data} value={top ? sourceNames[top.source] || top.source : "—"} detail={top ? `${top.bookings} booking${top.bookings === 1 ? "" : "s"}` : "Share a tracked link to start"} />
      </div>
      <div className="ds-grid-2">
        <Panel flush title="By source" description="Visits and bookings from each channel.">
          {!data ? (
            <div className="mk-pad">
              <Skeleton height={160} />
            </div>
          ) : data.sources.length ? (
            <div className="ds-table-wrap">
              <table className="ds-table">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th className="num">Visits</th>
                    <th className="num">Bookings</th>
                    <th className="num">Conversion</th>
                  </tr>
                </thead>
                <tbody>
                  {data.sources.map((s) => (
                    <tr key={s.source}>
                      <td>
                        <b className="mk-strong">{sourceNames[s.source] || s.source}</b>
                      </td>
                      <td className="num">{s.views.toLocaleString()}</td>
                      <td className="num">
                        {s.bookings}
                        {s.bookings !== s.confirmed && <small className="mk-muted-inline"> ({s.confirmed} kept)</small>}
                      </td>
                      <td className="num">{pct(s.bookings, s.views)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon="link" title="No tracked visits yet">
              Share a tracked link or QR code from the Share tab. Results appear here as people visit and book.
            </EmptyState>
          )}
        </Panel>
        <Panel title="Daily bookings" description="Tracked bookings per day.">
          {data ? (
            <BarChart
              label="Tracked bookings per day"
              data={data.daily.slice(-30).map((d) => ({
                label: new Date(d.day).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" }),
                value: d.bookings,
              }))}
            />
          ) : (
            <Skeleton height={180} />
          )}
          {data && data.campaigns.length > 0 && (
            <div className="mk-campaigns">
              <h3>Campaigns</h3>
              <ul>
                {data.campaigns.map((c) => (
                  <li key={c.campaign + c.source}>
                    <span>{c.campaign}</span>
                    <small>{sourceNames[c.source] || c.source}</small>
                    <b>{c.bookings}</b>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>
      </div>
      <p className="mk-muted">Zenvio counts visits in aggregate and stores no visitor identifiers. Bookings you add manually aren’t attributed to a source.</p>
    </div>
  );
}

function ReviewsTab() {
  const [data, setData] = useState<Reviews | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [replying, setReplying] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [shareLink, setShareLink] = useState<{ name: string; link: string } | null>(null);

  async function load() {
    const r = await fetch("/api/reviews", { cache: "no-store" });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Unable to load reviews.");
    setData(d);
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  async function act(id: string, payload: Record<string, unknown>, done: (d: Record<string, unknown>) => void) {
    setBusy(id);
    setError("");
    setNotice("");
    try {
      const r = await fetch("/api/reviews", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Unable to save.");
      done(d);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save.");
    } finally {
      setBusy(null);
    }
  }

  const s = data?.summary;
  return (
    <div className="mk-stack">
      {notice && <Notice tone="success">{notice}</Notice>}
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="ds-kpis">
        <Kpi label="Average rating" icon="spark" loading={!data} value={s?.total ? `${s.average?.toFixed(1)} ★` : "—"} detail={s ? `${s.total} verified review${s.total === 1 ? "" : "s"}` : undefined} />
        <Kpi label="Requests sent" icon="mail" loading={!data} value={data?.requests.sent} detail={data ? `${data.requests.open} awaiting a response` : undefined} />
        <Kpi label="Response rate" icon="check" loading={!data} value={data ? pct(data.requests.completed, data.requests.sent) : ""} detail="Reviews ÷ requests" />
        <Kpi label="Ready to ask" icon="clock" loading={!data} value={data?.eligible.length} detail="Completed in the last 90 days" />
      </div>

      {data && !data.mail && (
        <Notice tone="warning">Email isn’t connected yet. Requests create a private link you can copy and send yourself.</Notice>
      )}

      <div className="ds-grid-2">
        <Panel flush title="Ask for a review" description="Completed appointments from the last 90 days. Each client can be asked once; links expire after 30 days.">
          {!data ? (
            <div className="mk-pad">
              <Skeleton height={140} />
            </div>
          ) : data.eligible.length ? (
            <ul className="mk-ask">
              {data.eligible.map((b) => (
                <li key={b.id}>
                  <span>
                    <b>{b.guest_name}</b>
                    <small>
                      {b.service || "Appointment"} · {formatDate(b.starts_at)}
                    </small>
                  </span>
                  <button
                    className="ds-btn sm"
                    disabled={busy === b.id}
                    onClick={() =>
                      void act(b.id, { action: "request", bookingId: b.id }, (d) => {
                        if (d.emailed) setNotice(`Review request emailed to ${b.guest_name}.`);
                        else setShareLink({ name: b.guest_name, link: String(d.link) });
                      })
                    }
                  >
                    {busy === b.id ? "Sending…" : data.mail ? "Email request" : "Create link"}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon="check" title="You're all caught up">
              Completed appointments appear here so you can ask clients how it went.
            </EmptyState>
          )}
        </Panel>
        <Panel title="Rating breakdown" description="Every rating counts, including reviews without a public comment.">
          {s && s.total ? (
            <ul className="mk-dist">
              {[5, 4, 3, 2, 1].map((n) => {
                const count = Number(s[`r${n}` as "r5"]) || 0;
                return (
                  <li key={n}>
                    <span>{n} ★</span>
                    <i>
                      <em style={{ width: `${(count / s.total) * 100}%` }} />
                    </i>
                    <b>{count}</b>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState icon="spark" title="No reviews yet">
              Ask your recent clients. Reviews appear on your booking page once you have one.
            </EmptyState>
          )}
        </Panel>
      </div>

      <Panel title="Reviews" description="Hide a comment only when it breaks content rules; its rating still counts. You can reply publicly.">
        {!data ? (
          <Skeleton height={120} />
        ) : data.reviews.length ? (
          <ul className="mk-reviews">
            {data.reviews.map((r) => (
              <li key={r.id} className={r.hidden_reason ? "hidden" : ""}>
                <div className="mk-review-head">
                  <span className="mk-stars" aria-label={`${r.rating} out of 5 stars`}>
                    {stars(r.rating)}
                  </span>
                  <b>{r.guest_name}</b>
                  <small>
                    {r.service || "Appointment"} · {relativeTime(r.created_at)}
                  </small>
                  <span className="mk-review-badges">
                    {!r.public_consent ? (
                      <Badge>Private</Badge>
                    ) : r.hidden_reason ? (
                      <Badge tone="warning">Hidden · {data.hiddenReasons[r.hidden_reason]}</Badge>
                    ) : r.comment ? (
                      <Badge tone="success" dot>
                        Public as {r.display_name}
                      </Badge>
                    ) : (
                      <Badge>Rating only</Badge>
                    )}
                  </span>
                </div>
                {r.comment && <p>{r.comment}</p>}
                {r.owner_reply && replying !== r.id && (
                  <p className="mk-reply">
                    <b>Your reply:</b> {r.owner_reply}
                  </p>
                )}
                {replying === r.id ? (
                  <div className="mk-reply-form">
                    <textarea value={reply} onChange={(e) => setReply(e.target.value)} maxLength={1000} rows={3} aria-label="Reply" />
                    <div>
                      <button className="ds-btn sm ghost" onClick={() => setReplying(null)}>
                        Cancel
                      </button>
                      <button
                        className="ds-btn sm primary"
                        disabled={busy === r.id}
                        onClick={() => void act(r.id, { action: "reply", id: r.id, reply }, () => setReplying(null))}
                      >
                        Save reply
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mk-review-actions">
                    {r.public_consent && r.comment && (
                      <button
                        className="ds-btn sm ghost"
                        onClick={() => {
                          setReplying(r.id);
                          setReply(r.owner_reply || "");
                        }}
                      >
                        {r.owner_reply ? "Edit reply" : "Reply"}
                      </button>
                    )}
                    {r.public_consent && r.comment && (
                      <select
                        className="ds-select mk-hide"
                        aria-label="Visibility"
                        value={r.hidden_reason || ""}
                        disabled={busy === r.id}
                        onChange={(e) => void act(r.id, { action: "hide", id: r.id, reason: e.target.value || null }, () => {})}
                      >
                        <option value="">Shown on booking page</option>
                        {Object.entries(data.hiddenReasons).map(([id, label]) => (
                          <option key={id} value={id}>
                            Hide: {label}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon="feedback" title="No reviews yet">
            Reviews from clients appear here as they respond.
          </EmptyState>
        )}
      </Panel>

      {shareLink && (
        <div className="ds-drawer-backdrop" onClick={(e) => e.target === e.currentTarget && setShareLink(null)}>
          <aside className="ds-drawer mk-share" role="dialog" aria-modal="true" aria-labelledby="mk-share-title">
            <header>
              <div>
                <h2 id="mk-share-title">Review link for {shareLink.name}</h2>
                <p>Private and single-use. Send it by text or email; it expires in 30 days.</p>
              </div>
              <button className="ds-btn sm ghost" onClick={() => setShareLink(null)} aria-label="Close" autoFocus>
                <Icon name="close" size={16} />
              </button>
            </header>
            <div className="ds-drawer-body">
              <code className="mk-share-link">{shareLink.link}</code>
              <button className="ds-btn primary" onClick={() => void copyText(shareLink.link).then((ok) => ok && setNotice("Review link copied."))}>
                Copy link
              </button>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
