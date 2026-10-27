export type Profile = {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  bio: string;
  headline?: string;
  company?: string;
  accent_color?: string;
};
export type EventType = {
  id: string;
  user_id: string;
  title: string;
  slug: string;
  description: string;
  duration: number;
  buffer: number;
  location: string;
  color: string;
  active: boolean;
  deleted_at?: string | null;
};
export type Availability = {
  day: number;
  enabled: boolean;
  start_time: string;
  end_time: string;
};
export type Booking = {
  id: string;
  event_id: string;
  guest_name: string;
  guest_email: string;
  guest_phone?: string;
  guest_company?: string;
  meeting_purpose?: string;
  notes: string;
  starts_at: string;
  ends_at: string;
  status: "confirmed" | "cancelled";
  title?: string;
  location?: string;
};
export type Contact = {
  id: string;
  name: string;
  email: string;
  company: string;
  notes: string;
  created_at: string;
};
export type WorkspaceData = {
  platformRole?: "master_admin" | "member";
  profile: Profile;
  events: EventType[];
  availability: Availability[];
  bookings: Booking[];
  contacts: Contact[];
};
export type PublicEvent = {
  host: string;
  host_slug: string;
  timezone: string;
  bio: string;
  title: string;
  description: string;
  duration: number;
  location: string;
  color: string;
};

export type PublicProfileData = {
  profile: Omit<Profile, "id">;
  events: Pick<
    EventType,
    "slug" | "title" | "description" | "duration" | "location" | "color"
  >[];
};
