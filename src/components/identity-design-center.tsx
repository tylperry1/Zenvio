"use client";
import { useEffect, useState } from "react";
import { EmptyState, Notice, PageHeader, Panel, Skeleton } from "./ds";
import { ProfileStudio } from "./profile-studio";

type Profile = {
  id: string;
  slug: string;
  display_name: string;
  company: string;
  job_title: string;
  bio: string;
  phone: string;
  email: string;
  website: string;
  address: string;
  links: { label: string; url: string }[];
  show_phone: boolean;
  show_email: boolean;
  show_address: boolean;
  show_booking: boolean;
  published: boolean;
  archived_at?: string | null;
};

/** Design & Branding for Digital Identity — reuses ProfileStudio on the smart profile record. */
export function IdentityDesignCenter() {
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [bookingSlug, setBookingSlug] = useState<string | null>(null);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/smart-profiles?days=7", { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Unable to load profiles.");
        const list = (d.profiles as Profile[]).filter((p) => !p.archived_at);
        setProfiles(list);
        setBookingSlug(d.bookingSlug || null);
        setSelected(list.find((p) => p.published)?.id || list[0]?.id || "");
      })
      .catch((e) => setError(e.message));
  }, []);

  const profile = profiles?.find((p) => p.id === selected);

  return (
    <div className="ds-root sc">
      <PageHeader
        title="Design & Branding"
        description="Brand customization for your Digital Identity. One design system powers the public profile visitors see from QR, NFC, and Smart Cards."
      />
      {error && <Notice tone="danger">{error}</Notice>}
      {!profiles ? (
        !error && <Skeleton height={320} />
      ) : !profiles.length ? (
        <EmptyState icon="spark" title="Create a profile to design">
          <a className="ds-btn primary sm" href="/app/identity">
            Open My Profiles
          </a>
        </EmptyState>
      ) : (
        <>
          <label className="ds-field sc-profile-picker">
            Digital Identity
            <select
              className="ds-select"
              value={selected}
              onChange={(e) => {
                const next = e.target.value;
                if (next === selected) return;
                // ProfileStudio unmounts on key change — confirm before discarding unsaved design work.
                if (!window.confirm("Switch profiles? Unsaved design changes on this profile will be discarded.")) {
                  e.target.value = selected;
                  return;
                }
                setSelected(next);
              }}
            >
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.display_name}
                </option>
              ))}
            </select>
          </label>
          {profile ? (
            <ProfileStudio
              key={profile.id}
              kind="smart"
              profileId={profile.id}
              identity={{
                name: profile.display_name,
                tagline: [profile.job_title, profile.company].filter(Boolean).join(" · "),
                company: profile.company,
                bio: profile.bio,
                phone: profile.show_phone ? profile.phone : undefined,
                email: profile.show_email ? profile.email : undefined,
                address: profile.show_address ? profile.address : undefined,
                website: profile.website,
                links: profile.links,
                bookingUrl: profile.show_booking && bookingSlug ? `/book/${bookingSlug}` : undefined,
                vcardUrl: `/p/${profile.slug}/vcard`,
              }}
              publicUrl={`/p/${profile.slug}`}
            />
          ) : (
            <Panel title="Select a profile">Choose a Digital Identity to edit branding.</Panel>
          )}
        </>
      )}
    </div>
  );
}
