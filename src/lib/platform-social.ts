import { getPool, databaseConfigured } from "./db";
import { ApiError } from "./server";
import { httpsUrl, socialNetworks } from "./profile-details";

export const platformSocialNetworks = socialNetworks.filter((n) => n !== "website");
export type PlatformSocialLink = {
  network: (typeof platformSocialNetworks)[number];
  url: string;
  label?: string;
};

export const platformSocialLabels: Record<(typeof platformSocialNetworks)[number], string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  x: "X",
  tiktok: "TikTok",
  youtube: "YouTube",
  yelp: "Yelp",
  google: "Google",
  nextdoor: "Nextdoor",
};

export function parsePlatformSocialLinks(input: unknown): PlatformSocialLink[] {
  if (!Array.isArray(input)) throw new ApiError("Social links must be a list.");
  const links = input;
  if (links.length > 8) throw new ApiError("Add up to eight social links.");
  const seen = new Set<string>();
  return links.map((raw) => {
    const item = raw as { network?: unknown; url?: unknown; label?: unknown };
    const network = String(item.network || "");
    if (!platformSocialNetworks.includes(network as PlatformSocialLink["network"]))
      throw new ApiError("Choose a valid social network.");
    if (seen.has(network)) throw new ApiError(`Only one ${platformSocialLabels[network as PlatformSocialLink["network"]]} link is allowed.`);
    seen.add(network);
    const label = String(item.label ?? "").trim().slice(0, 40);
    return {
      network: network as PlatformSocialLink["network"],
      url: httpsUrl(item.url, network, true),
      ...(label ? { label } : {}),
    };
  });
}

async function readPlatformSocialLinks(): Promise<PlatformSocialLink[]> {
  if (!databaseConfigured()) return [];
  const row = (
    await getPool().query(
      "SELECT value FROM private.platform_settings WHERE key='platform_social_links'",
    )
  ).rows[0]?.value;
  const raw = row?.links ?? row ?? [];
  return parsePlatformSocialLinks(Array.isArray(raw) ? raw : []);
}

/** Public surfaces: never fail the page if settings are unavailable. */
export async function platformSocialLinks(): Promise<PlatformSocialLink[]> {
  try {
    return await readPlatformSocialLinks();
  } catch {
    return [];
  }
}

/** Admin console: propagate database/read errors so operators see failures. */
export async function platformSocialLinksStrict(): Promise<PlatformSocialLink[]> {
  return readPlatformSocialLinks();
}
