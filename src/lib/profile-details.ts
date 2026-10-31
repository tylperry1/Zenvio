import { ApiError, string } from "./server";
import { industries } from "./contractor";

export const socialNetworks = ["website", "instagram", "facebook", "linkedin", "x", "tiktok", "youtube", "yelp", "google", "nextdoor"] as const;
export type SocialLink = { network: (typeof socialNetworks)[number]; url: string };

// Only https links are stored, so public pages never render javascript: or data: URLs.
export function httpsUrl(value: unknown, name: string, required = false) {
  const raw = string(value ?? "", name, 200, required ? 1 : 0);
  if (!raw) return "";
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : "https://" + raw);
  } catch {
    throw new ApiError(`Enter a valid web address for ${name}.`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new ApiError(`Enter a valid web address for ${name}.`);
  if (!url.hostname.includes(".")) throw new ApiError(`Enter a valid web address for ${name}.`);
  url.protocol = "https:";
  return url.toString().slice(0, 200);
}

export function profileDetails(input: Record<string, unknown>) {
  const links = Array.isArray(input.social_links) ? input.social_links : [];
  if (links.length > 6) throw new ApiError("Add up to six links.");
  const social: SocialLink[] = links.map((l) => {
    const network = (l as { network?: unknown })?.network;
    if (!socialNetworks.includes(network as SocialLink["network"])) throw new ApiError("Choose a valid link type.");
    return { network: network as SocialLink["network"], url: httpsUrl((l as { url?: unknown }).url, String(network), true) };
  });
  const industry = String(input.industry ?? "general");
  if (!industries.some((i) => i.id === industry)) throw new ApiError("Choose a valid business type.");
  return {
    website: httpsUrl(input.website, "website"),
    location: string(input.location ?? "", "location", 120, 0),
    booking_instructions: string(input.booking_instructions ?? "", "booking instructions", 1000, 0),
    social_links: social,
    industry,
  };
}
