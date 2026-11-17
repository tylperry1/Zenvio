export type AvailabilityRules = {noticeMinutes:number;horizonDays:number;intervalMinutes:number;exceptions:{date:string;periods:{start:string;end:string}[]}[]};
export type Profile = {
  availability_rules?: AvailabilityRules;
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
  intake_questions?: import("./intake").Question[];
  id: string;
  user_id: string;
  title: string;
  slug: string;
  description: string;
  duration: number;
  buffer: number;
  location: string;
  location_mode?: import("./addresses").LocationMode;
  allowed_location_modes?: import("./addresses").LocationMode[];
  virtual_instructions?: string;
  custom_location_prompt?: string;
  color: string;
  active: boolean;
  deleted_at?: string | null;
};
export type Availability = {
  periods?: {start:string;end:string}[] | null;
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
  location_mode?: import("./addresses").LocationMode | null;
  service_address?: import("./addresses").StructuredAddress | null;
  access_instructions?: string;
  contact_id?: string | null;
  intake_snapshot?: (import("./intake").Question & { answer: unknown })[];
};
export type Contact = {
  id: string;
  name: string;
  email: string;
  company: string;
  notes: string;
  phone?: string;
  address?: string;
  created_at: string;
};
export type WorkspaceData = {
  marketplaceVisible?: boolean;
  platformRole?: "master_admin" | "member";
  profile: Profile;
  events: EventType[];
  availability: Availability[];
  bookings: Booking[];
  contacts: Contact[];
  businessAddress?: import("./addresses").StructuredAddress | null;
  // Totals across the whole account; the arrays above are bounded.
  bookingCount?: number;
  contactCount?: number;
};
export type PublicEvent = {
  booking_window_days?: number;
  minimum_notice_minutes?: number;
  payment?: {
    payment_mode: string;
    price_cents: number;
    deposit_cents: number;
    refund_policy: string;
  };
  questions?: import("./intake").Question[];
  instructions?: string;
  host: string;
  host_slug: string;
  timezone: string;
  bio: string;
  title: string;
  description: string;
  duration: number;
  location: string;
  location_mode?: import("./addresses").LocationMode;
  allowed_location_modes?: import("./addresses").LocationMode[];
  virtual_instructions?: string;
  custom_location_prompt?: string;
  business_address?: import("./addresses").StructuredAddress | null;
  saved_addresses?: import("./addresses").StructuredAddress[];
  color: string;
};

export type ProfileExtras = {
  website?: string;
  location?: string;
  social_links?: { network: string; url: string }[];
  booking_instructions?: string;
  has_cover?: boolean;
  has_logo?: boolean;
};
export type PublicProfileData = {
  design?: import("./profile-design").ProfileDesign | null;
  profile: Omit<Profile, "id"> & ProfileExtras;
  events: (Pick<
    EventType,
    "slug" | "title" | "description" | "duration" | "location" | "color"
  > & { location_mode?: import("./addresses").LocationMode | null })[];
};
