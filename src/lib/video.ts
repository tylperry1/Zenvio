import { dailyConfigured } from "./launch/daily";
// Video meeting provider adapter.
//
// Zenvio does not ship a video provider yet. Providers register here once real credentials and
// an approved integration exist (meeting creation through a calendar provider is owned by the
// calendar-integration workstream). Until then `videoStatus()` reports activation as blocked so
// no screen presents a video button as ready. External meeting links (Zoom, Meet, Teams URLs)
// entered as an appointment location keep working and are unaffected.
export type VideoMeeting = { joinUrl: string; hostUrl?: string; provider: string };
export interface VideoProvider {
  id: string;
  name: string;
  configured(): Promise<boolean>;
  createMeeting(input: { title: string; startsAt: string; endsAt: string; hostId: string }): Promise<VideoMeeting>;
}

const providers: VideoProvider[] = [];
export function registerVideoProvider(provider: VideoProvider) {
  if (!providers.some((p) => p.id === provider.id)) providers.push(provider);
}
export function _resetVideoProviders() {
  providers.length = 0;
}

export async function videoStatus() {
  if (await dailyConfigured()) return {available:true as const,provider:"daily",name:"Daily",appointmentAccessPath:"/api/video/meetings"};
  for (const p of providers)
    if (await p.configured().catch(() => false)) return { available: true as const, provider: p.id, name: p.name };
  return {
    available: false as const,
    reason: "No video provider is connected. Built-in video meetings are not available yet; add a meeting link as the appointment location instead.",
  };
}

export async function createVideoMeeting(input: { title: string; startsAt: string; endsAt: string; hostId: string }) {
  for (const p of providers) if (await p.configured().catch(() => false)) return p.createMeeting(input);
  throw new Error("video_provider_unavailable");
}

// Locations that are already meeting links are passed through untouched.
export function externalMeetingLink(location: string) {
  const match = location.match(/https:\/\/[^\s]+/);
  if (!match) return null;
  try {
    const url = new URL(match[0]);
    return /(^|\.)(zoom\.us|meet\.google\.com|teams\.microsoft\.com|teams\.live\.com|webex\.com|whereby\.com)$/.test(url.hostname)
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
