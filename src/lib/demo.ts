import type { WorkspaceData } from "./types";
export const DEMO_KEY = "zenvio-demo-v1";
export function demoData(): WorkspaceData {
  const today = new Date();
  function at(offset: number, hour: number, minute = 0) {
    const d = new Date(today);
    d.setDate(d.getDate() + offset);
    d.setHours(hour, minute, 0, 0);
    return d.toISOString();
  }
  return {
    profile: {
      id: "demo",
      name: "Jamie Davis",
      slug: "demo",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      bio: "Good conversations make great things happen. Find a time and let’s connect.",
    },
    events: [
      {
        id: "discovery",
        user_id: "demo",
        title: "Discovery call",
        slug: "discovery-call",
        description:
          "A little time to connect, talk through your goals, and see how we can help.",
        duration: 30,
        buffer: 15,
        location: "Video call — link to be shared by your host",
        color: "#365CFF",
        active: true,
      },
      {
        id: "coffee",
        user_id: "demo",
        title: "Virtual coffee",
        slug: "virtual-coffee",
        description:
          "Bring your favorite drink. Let’s swap ideas and see where the conversation takes us.",
        duration: 15,
        buffer: 15,
        location: "Phone call",
        color: "#087C96",
        active: true,
      },
      {
        id: "strategy",
        user_id: "demo",
        title: "Strategy session",
        slug: "strategy-session",
        description:
          "An hour to think big, work through a challenge, and leave with a clearer next step.",
        duration: 60,
        buffer: 15,
        location: "Phone call",
        color: "#7655C7",
        active: false,
      },
    ],
    availability: Array.from({ length: 7 }, (_, day) => ({
      day,
      enabled: day > 0 && day < 6,
      start_time: "09:00",
      end_time: "17:00",
    })),
    bookings: [
      {
        id: "b1",
        event_id: "discovery",
        guest_name: "Alex Morgan",
        guest_email: "alex@example.com",
        notes: "Looking forward to talking about a new brand launch.",
        starts_at: at(1, 10, 30),
        ends_at: at(1, 11),
        status: "confirmed",
      },
      {
        id: "b2",
        event_id: "coffee",
        guest_name: "Sam Rivera",
        guest_email: "sam@example.com",
        notes: "A quick hello and a few ideas.",
        starts_at: at(1, 14),
        ends_at: at(1, 14, 15),
        status: "confirmed",
      },
      {
        id: "b3",
        event_id: "discovery",
        guest_name: "Taylor Brooks",
        guest_email: "taylor@example.com",
        notes: "Website project kickoff.",
        starts_at: at(3, 11),
        ends_at: at(3, 11, 30),
        status: "confirmed",
      },
      {
        id: "b4",
        event_id: "strategy",
        guest_name: "Jordan Lee",
        guest_email: "jordan@example.com",
        notes: "Quarterly planning.",
        starts_at: at(-2, 13),
        ends_at: at(-2, 14),
        status: "confirmed",
      },
    ],
    contacts: [
      ["Alex Morgan", "alex@example.com", "Studio North"],
      ["Sam Rivera", "sam@example.com", "Independent"],
      ["Taylor Brooks", "taylor@example.com", "Brook & Co."],
      ["Jordan Lee", "jordan@example.com", "Sunday Studio"],
    ].map(([name, email, company], i) => ({
      id: `c${i}`,
      name,
      email,
      company,
      notes: "",
      created_at: at(-i - 1, 9),
    })),
  };
}
export function readDemo() {
  try {
    const stored = localStorage.getItem(DEMO_KEY);
    if (stored) {
      const value = JSON.parse(stored);
      if (
        value.profile &&
        Array.isArray(value.events) &&
        Array.isArray(value.bookings) &&
        Array.isArray(value.contacts) &&
        Array.isArray(value.availability)
      )
        return value as WorkspaceData;
    }
  } catch {}
  return demoData();
}
