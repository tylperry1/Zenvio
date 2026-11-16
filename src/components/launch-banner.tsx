"use client";
import { usePathname } from "next/navigation";
export function LaunchBanner({ text, date }: { text: string; date: string }) {
  const path = usePathname();
  if (["/sign-up", "/sign-in", "/reset-password"].includes(path || "")) return null;
  if (!["/", "/pricing", "/early-access"].includes(path || "")) return null;
  const at = Date.parse(date + "T12:00:00Z");
  const upcoming = Number.isFinite(at) && at > Date.now();
  return (
    <aside className="launch-banner" aria-label="Launch announcement">
      {text}
      {upcoming && (
        <>
          {" "}
          <time dateTime={date}>
            {new Intl.DateTimeFormat("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
              timeZone: "UTC",
            }).format(new Date(date + "T12:00:00Z"))}
          </time>
        </>
      )}
      . <a href="/sign-in">Member sign in</a>
    </aside>
  );
}
