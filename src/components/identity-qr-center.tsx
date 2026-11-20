"use client";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { EmptyState, Notice, PageHeader, Panel, Skeleton } from "./ds";
import { Icon } from "./icons";
import { ShareLinkActions } from "./share-link";
import { publicShareOrigin } from "@/lib/share";

type Profile = { id: string; slug: string; display_name: string; published: boolean; archived_at?: string | null };

/** Dedicated QR management for Digital Identity — always encodes the canonical /p/{slug} URL. */
export function IdentityQrCenter() {
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [selected, setSelected] = useState("");
  const [qr, setQr] = useState("");
  const [origin, setOrigin] = useState("https://gozenvio.com");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    setOrigin(publicShareOrigin(window.location.origin));
    fetch("/api/smart-profiles?days=7", { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Unable to load profiles.");
        const list = (d.profiles as Profile[]).filter((p) => !p.archived_at);
        setProfiles(list);
        setSelected(list.find((p) => p.published)?.id || list[0]?.id || "");
      })
      .catch((e) => setError(e.message));
  }, []);

  const profile = profiles?.find((p) => p.id === selected);
  const profileUrl = profile ? `${origin}/p/${profile.slug}` : "";
  const qrUrl = profileUrl ? `${profileUrl}?via=qr` : "";

  useEffect(() => {
    if (!qrUrl || !profile?.published) {
      setQr("");
      return;
    }
    let active = true;
    QRCode.toString(qrUrl, { type: "svg", margin: 4, errorCorrectionLevel: "M", color: { dark: "#151b38", light: "#ffffff" } })
      .then((svg) => {
        if (active) setQr(svg);
      })
      .catch(() => {
        if (active) setQr("");
      });
    return () => {
      active = false;
    };
  }, [qrUrl, profile?.published]);

  return (
    <div className="ds-root sc">
      <PageHeader
        title="QR Codes"
        description="Every published Digital Identity has a QR code that opens the same canonical profile URL. Regenerating the image never changes the destination."
      />
      {error && <Notice tone="danger">{error}</Notice>}
      {notice && <Notice tone="success">{notice}</Notice>}
      {!profiles ? (
        !error && <Skeleton height={280} />
      ) : !profiles.length ? (
        <EmptyState icon="grid" title="Create a profile first">
          <a className="ds-btn primary sm" href="/app/identity">
            Open My Profiles
          </a>
        </EmptyState>
      ) : (
        <Panel title="Profile QR" description="Print-ready PNG and SVG downloads encode /p/{slug}?via=qr for attribution.">
          <label className="ds-field">
            Digital Identity
            <select className="ds-select" value={selected} onChange={(e) => setSelected(e.target.value)}>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.display_name} · {p.published ? "Published" : "Private"}
                </option>
              ))}
            </select>
          </label>
          {!profile?.published ? (
            <Notice>Publish this profile to generate a live QR code. Existing QR images keep working after content edits.</Notice>
          ) : (
            <div className="sc-share">
              <div className="sc-qr" role="img" aria-label="QR code for your profile" dangerouslySetInnerHTML={{ __html: qr }} />
              <code>{profileUrl}</code>
              <div className="sc-share-actions">
                <ShareLinkActions
                  variant="buttons"
                  url={profileUrl}
                  label="Profile QR destination"
                  title={profile.display_name}
                  copiedMessage="Profile link copied."
                  onResult={(result, message) => {
                    if (result === "copied") setNotice("Profile link copied.");
                    if (result === "unavailable") setError(message);
                  }}
                />
                <a className="ds-btn sm primary" href={`/p/${profile.slug}/qr?format=png`}>
                  <Icon name="download" size={14} /> Download PNG
                </a>
                <a className="ds-btn sm" href={`/p/${profile.slug}/qr?format=svg`}>
                  Download SVG
                </a>
                <button
                  type="button"
                  className="ds-btn sm"
                  onClick={() => {
                    setNotice("QR image regenerated. The canonical profile URL is unchanged.");
                    setQr("");
                    QRCode.toString(qrUrl, { type: "svg", margin: 4, errorCorrectionLevel: "M", color: { dark: "#151b38", light: "#ffffff" } }).then(setQr);
                  }}
                >
                  Regenerate image
                </button>
                <a className="ds-btn sm" href={`/p/${profile.slug}?via=qr`} target="_blank" rel="noopener">
                  Preview destination
                </a>
              </div>
              <p className="sc-hint">
                Print at high resolution using the PNG or SVG download. Scanning always opens the live Digital Identity —
                profile edits do not require reprinting.
              </p>
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}
