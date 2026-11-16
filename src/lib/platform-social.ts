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
  const links = Array.isArray(input) ? input : [];
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

export async function platformSocialLinks(): Promise<PlatformSocialLink[]> {
  if (!databaseConfigured()) return [];
  try {
    const row = (
      await getPool().query(
        "SELECT value FROM private.platform_settings WHERE key='platform_social_links'",
      )
    ).rows[0]?.value;
    return parsePlatformSocialLinks(row?.links ?? row ?? []);
  } catch {
    return [];
  }
}
