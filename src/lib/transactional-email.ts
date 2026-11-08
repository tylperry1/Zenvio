/** Escape all customer-supplied values before inserting them into email HTML. */
const escape = (value: string) => value.replace(/[&<>"']/g, (character) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

export function transactionalEmail(subject: string, text: string) {
  const configured = process.env.NEXT_PUBLIC_APP_URL || "https://gozenvio.com";
  let origin = "https://gozenvio.com";
  try { const url = new URL(configured); if (url.protocol === "https:") origin = url.origin; } catch {}
  const links = Array.from(text.matchAll(/https:\/\/[^\s<>"']+/g), (match) => match[0]);
  const action = links.find((link) => {
    try { return new URL(link).origin === origin; } catch { return false; }
  });
  const paragraphs = text.split(/\n\s*\n/).map((paragraph) =>
    `<p style="margin:0 0 18px;line-height:1.65;overflow-wrap:anywhere">${escape(paragraph).replaceAll("\n", "<br>")}</p>`).join("");
  return `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"></head>
<body style="margin:0;padding:24px 12px;background:#f3f5fa;font-family:Arial,sans-serif;color:#151b38">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;background:white;border-radius:16px">
<tr><td style="padding:28px;background:#151b38;border-radius:16px 16px 0 0;color:white;font-size:24px;font-weight:bold">Zenvio</td></tr>
<tr><td style="padding:28px"><h1 style="font-size:23px;line-height:1.3;margin:0 0 24px">${escape(subject)}</h1>${paragraphs}
${action ? `<p style="margin:24px 0"><a href="${escape(action)}" style="display:inline-block;background:#365cff;color:white;padding:14px 22px;border-radius:8px;font-weight:bold;text-decoration:none">Open in Zenvio</a></p>` : ""}
</td></tr><tr><td style="padding:20px 28px;border-top:1px solid #e8ebf2;font-size:12px;line-height:1.6;color:#647086">
Zenvio · Clear &amp; Connected<br><a href="${origin}/help" style="color:#365cff">Help Center</a> · <a href="${origin}/privacy" style="color:#365cff">Privacy</a>
</td></tr></table></td></tr></table></body></html>`;
}
