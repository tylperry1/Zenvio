import type { CSSProperties } from "react";
export function Icon({
  name,
  size = 20,
  style,
}: {
  name: string;
  size?: number;
  style?: CSSProperties;
}) {
  const paths: Record<string, React.ReactNode> = {
    arrow: (
      <>
        <path d="M5 12h14m-6-6 6 6-6 6" />
      </>
    ),
    calendar: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="3" />
        <path d="M7 3v4m10-4v4M3 11h18m-13 5h2m4 0h2" />
      </>
    ),
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="2" />
        <rect x="14" y="3" width="7" height="7" rx="2" />
        <rect x="3" y="14" width="7" height="7" rx="2" />
        <rect x="14" y="14" width="7" height="7" rx="2" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    users: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3 21v-3a6 6 0 0 1 12 0v3m1-16a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 4v2" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="m9 3-1 3-3 1-2 5 2 5 3 1 1 3h6l1-3 3-1 2-5-2-5-3-1-1-3Z" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    check: <path d="m5 12 4 4L19 6" />,
    link: (
      <>
        <path d="m10 13 4-4m-6 2-3 3a4 4 0 0 0 6 6l3-3m-4-10 3-3a4 4 0 0 1 6 6l-3 3" />
      </>
    ),
    chevron: <path d="m9 6 6 6-6 6" />,
    video: (
      <>
        <rect x="3" y="6" width="12" height="13" rx="2" />
        <path d="m15 10 6-3v11l-6-3" />
      </>
    ),
    globe: (
      <>
        <circle cx="12" cy="12" r="9" />
        <ellipse cx="12" cy="12" rx="4" ry="9" />
        <path d="M3 12h18" />
      </>
    ),
    search: (
      <>
        <circle cx="10" cy="10" r="6" />
        <path d="m15 15 6 6" />
      </>
    ),
    logout: (
      <>
        <path d="M9 4H4v16h5m4-12 4 4-4 4m-5-4h13" />
      </>
    ),
    mail: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="3" />
        <path d="m3 7 9 6 9-6" />
      </>
    ),
    more: (
      <>
        <circle cx="5" cy="12" r="1" />
        <circle cx="12" cy="12" r="1" />
        <circle cx="19" cy="12" r="1" />
      </>
    ),
    leaf: (
      <>
        <path d="M19 3C6 2 1 10 6 16s15 2 13-13ZM5 21 16 8" />
      </>
    ),
    shield: (
      <>
        <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z" />
        <path d="m8 12 3 3 5-6" />
      </>
    ),
    close: <path d="m6 6 12 12M6 18 18 6" />,
    download: (
      <>
        <path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4" />
      </>
    ),
    menu: <path d="M4 6h16M4 12h16M4 18h16" />,
    spark: (
      <>
        <path d="m12 3 3 6 6 3-6 3-3 6-3-6-6-3 6-3Z" />
      </>
    ),
    home: <path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1Z" />,
    file: (
      <>
        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
        <path d="M14 3v5h5M9 13h6m-6 4h4" />
      </>
    ),
    layers: (
      <>
        <path d="m12 3 9 5-9 5-9-5Z" />
        <path d="m3 13 9 5 9-5" />
      </>
    ),
    bell: (
      <>
        <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15Z" />
        <path d="M10 20.5a2 2 0 0 0 4 0" />
      </>
    ),
    card: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2.5" />
        <path d="M3 10h18M7 15h3" />
      </>
    ),
    bag: (
      <>
        <path d="M5 8h14l-1 12H6Z" />
        <path d="M9 10V7a3 3 0 0 1 6 0v3" />
      </>
    ),
    team: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 5.5a3 3 0 0 1 0 5.5M17.5 14.5A5 5 0 0 1 20.5 19" />
      </>
    ),
    contact: (
      <>
        <rect x="4" y="3" width="16" height="18" rx="2.5" />
        <circle cx="12" cy="10" r="2.5" />
        <path d="M8 16.5a4 4 0 0 1 8 0" />
      </>
    ),
    plug: <path d="M9 3v5m6-5v5M7 8h10v3a5 5 0 0 1-10 0Zm5 8v5" />,
    external: <path d="M14 4h6v6m0-6-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />,
    chevronDown: <path d="m6 9 6 6 6-6" />,
    message: <path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-4.5 3.5V17H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm3 5h8m-8 3h5" />,
    send: <path d="m4 12 16-8-6 16-2.5-6.5L4 12Zm7.5 1.5L20 4" />,
    sparkles: <path d="M12 3.5 13.8 9l5.7 1.9-5.7 1.9L12 18.5l-1.8-5.7-5.7-1.9L10.2 9 12 3.5ZM18.5 15l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2Z" />,
    briefcase: <path d="M9 6V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V6M4 6h16a1 1 0 0 1 1 1v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a1 1 0 0 1 1-1Zm-1 6h18m-9-1v2" />,
    paperclip: <path d="m20 11.5-8 8a5 5 0 0 1-7-7l8.5-8.5a3.5 3.5 0 0 1 5 5L10 17.5a2 2 0 0 1-3-3l7.5-7.5" />,
    feedback: <path d="M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4V6a2 2 0 0 1 1-2Zm7 4v3m0 3h.01" />,
    image: <path d="M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm-2 13 5-5 4 4 3-3 6 6M15.5 8.5h.01" />,
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
    >
      {paths[name] || paths.calendar}
    </svg>
  );
}
export function Logo({
  light = false,
  compact = false,
}: {
  light?: boolean;
  compact?: boolean;
}) {
  return (
    <span
      className={`logo ${light ? "logo-light" : ""} ${compact ? "logo-compact" : ""}`}
    >
      {/* Brand SVGs are outlined artwork, not text or an approximation of the mark. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={
          compact
            ? light
              ? "/brand/zenvio-symbol-reversed.svg"
              : "/brand/zenvio-symbol.svg"
            : light
              ? "/brand/zenvio-reversed.svg"
              : "/brand/zenvio-primary.svg"
        }
        alt="Zenvio"
        width={compact ? 100 : 450}
        height={compact ? 100 : 110}
      />
    </span>
  );
}
