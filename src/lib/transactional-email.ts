// Shared HTML layout for every Zenvio system email. Callers pass the subject
// and the plain-text body (which is also sent as the text part); the layout
// turns it into a branded, accessible email. No imports: tests load it alone.

/** Escape all customer-supplied values before inserting them into email HTML. */
const escape = (value: string) => value.replace(/[&<>"']/g, (character) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

export type EmailOptions = {
  /** The main button. Only https links on the Zenvio origin are used. */
  action?: { label: string; url: string };
  /** Inbox preview text; defaults to the first paragraph. */
  preheader?: string;
  /** Optional details table, e.g. order lines. Values are plain text. */
  rows?: [string, string][];
};

const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const URL_PATTERN = /https:\/\/[^\s<>"']+/g;

export function platformOrigin() {
  const configured = process.env.NEXT_PUBLIC_APP_URL || "https://gozenvio.com";
  try {
    const url = new URL(configured);
    if (url.protocol === "https:") return url.origin;
  } catch {}
  return "https://gozenvio.com";
}

/** Button wording that says what the link does, from where it goes. */
export function actionLabel(url: string) {
  let path = "";
  try {
    path = new URL(url).pathname;
  } catch {}
  const rules: [RegExp, string][] = [
    [/^\/sign\b/, "Review and sign"],
    [/^\/(reschedule|cancel)\b/, "Manage appointment"],
    [/^\/class-cancel\b/, "Manage registration"],
    [/^\/portal\b/, "Open your client portal"],
    [/^\/admin\/support\b/, "Open the support inbox"],
    [/^\/(app\/)?support\b/, "View conversation"],
    [/^\/marketplace\/order/, "View your order"],
    [/^\/reset-password\b/, "Reset your password"],
    [/verify/, "Verify your email"],
    [/^\/waitlist-offer\b/, "Claim this time"],
    [/^\/review\b/, "Leave a review"],
    [/^\/gift-card\b/, "View gift card"],
    [/^\/team\/accept$/, "Join your team"],
    [/^\/(book|team)\b/, "View booking page"],
    [/^\/demo\b/, "Explore the demo"],
    [/^\/pricing\b/, "See pricing"],
    [/^\/help\b/, "Visit the Help Center"],
    [/^\/admin\b/, "Open the admin console"],
  ];
  return rules.find(([pattern]) => pattern.test(path))?.[1] || "Open Zenvio";
}

function linkify(line: string, origin: string) {
  // Same-origin links become anchors; anything else stays as plain text.
  let out = "",
    last = 0;
  for (const match of line.matchAll(URL_PATTERN)) {
    const url = match[0];
    out += escape(line.slice(last, match.index));
    let internal = false;
    try {
      internal = new URL(url).origin === origin;
    } catch {}
    out += internal ? `<a href="${escape(url)}" style="color:#365cff;text-decoration:underline">${escape(url)}</a>` : escape(url);
    last = (match.index ?? 0) + url.length;
  }
  return out + escape(line.slice(last));
}

function button(url: string, label: string) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 28px"><tr>
<td align="center" bgcolor="#365cff" style="border-radius:10px">
<a href="${escape(url)}" target="_blank" style="display:inline-block;padding:14px 26px;font-family:${font};font-size:16px;font-weight:600;line-height:20px;color:#ffffff;text-decoration:none;border-radius:10px">${escape(label)}</a>
</td></tr></table>`;
}

export function transactionalEmail(subject: string, text: string, options: EmailOptions = {}) {
  const origin = platformOrigin();
  const sameOrigin = (url: string) => {
    try {
      const u = new URL(url);
      return u.protocol === "https:" && u.origin === origin;
    } catch {
      return false;
    }
  };
  const links = Array.from(text.matchAll(URL_PATTERN), (m) => m[0]);
  const actionUrl = options.action && sameOrigin(options.action.url) ? options.action.url : links.find(sameOrigin);
  const label = options.action?.label || (actionUrl ? actionLabel(actionUrl) : "");

  // Paragraphs; the line holding the action link becomes the button.
  let placed = false;
  const blocks = text
    .trim()
    .split(/\n\s*\n/)
    .map((paragraph) => {
      const lines = paragraph.split("\n");
      const at = actionUrl ? lines.findIndex((l) => l.trim() === actionUrl) : -1;
      if (at >= 0 && !placed) {
        placed = true;
        const before = lines.slice(0, at).map((l, i, all) => (i === all.length - 1 ? l.replace(/:\s*$/, ".") : l));
        const after = lines.slice(at + 1);
        const p = (ls: string[]) =>
          ls.length && ls.some((l) => l.trim())
            ? `<p style="margin:0 0 18px;font-size:16px;line-height:1.6;color:#2b3350">${ls.map((l) => linkify(l, origin)).join("<br>")}</p>`
            : "";
        return p(before) + button(actionUrl!, label) + p(after);
      }
      return `<p style="margin:0 0 18px;font-size:16px;line-height:1.6;color:#2b3350">${lines.map((l) => linkify(l, origin)).join("<br>")}</p>`;
    })
    .join("");
  const cta = actionUrl && !placed ? button(actionUrl, label) : "";
  const rows = options.rows?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 24px;border-top:1px solid #e6e9f2">${options.rows
        .map(
          ([k, v]) =>
            `<tr><td style="padding:12px 0;border-bottom:1px solid #e6e9f2;font-size:15px;color:#2b3350">${escape(k)}</td><td align="right" style="padding:12px 0 12px 16px;border-bottom:1px solid #e6e9f2;font-size:15px;color:#151b38;font-weight:600;white-space:nowrap">${escape(v)}</td></tr>`,
        )
        .join("")}</table>`
    : "";
  const preheader = (options.preheader || text.split(/\n\s*\n/)[0].replace(URL_PATTERN, "").replace(/\s+/g, " ").trim()).slice(0, 140);
  const fallback = actionUrl
    ? `<p style="margin:0;font-size:13px;line-height:1.6;color:#687390">Button not working? Copy this link into your browser:<br><a href="${escape(actionUrl)}" style="color:#365cff;word-break:break-all">${escape(actionUrl)}</a></p>`
    : "";

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${escape(subject)}</title></head>
<body style="margin:0;padding:0;background:#f3f5fa;font-family:${font};color:#151b38;-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escape(preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f5fa"><tr><td align="center" style="padding:32px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
<tr><td style="padding:0 4px 18px"><a href="${origin}" style="text-decoration:none;font-family:${font};font-size:22px;font-weight:800;letter-spacing:-0.02em;color:#151b38">zenvio</a></td></tr>
<tr><td style="background:#ffffff;border:1px solid #e3e7f0;border-radius:16px;padding:36px 36px 28px">
<h1 style="margin:0 0 22px;font-family:${font};font-size:24px;line-height:1.3;font-weight:700;letter-spacing:-0.01em;color:#151b38">${escape(subject)}</h1>
${blocks}${rows}${cta}${fallback}
</td></tr>
<tr><td style="padding:24px 8px 0;font-family:${font};font-size:12px;line-height:1.7;color:#687390;text-align:center">
This is a service email from Zenvio about activity on your account or a booking.<br>
<a href="${origin}/help" style="color:#4a5571;text-decoration:underline">Help Center</a> &nbsp;·&nbsp; <a href="${origin}/privacy" style="color:#4a5571;text-decoration:underline">Privacy</a> &nbsp;·&nbsp; <a href="${origin}/terms" style="color:#4a5571;text-decoration:underline">Terms</a><br>
© ${new Date().getFullYear()} Zenvio · Clear &amp; Connected
</td></tr></table></td></tr></table></body></html>`;
}
