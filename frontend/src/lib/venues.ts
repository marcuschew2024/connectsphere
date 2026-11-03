export const VENUE_DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
export const VENUE_LAYOUTS = ["Theatre", "Classroom", "Boardroom", "U-shape", "Banquet", "Standing"];
export const VENUE_FACILITIES = ["Projector", "Stage", "Sound system", "Microphone", "Wi-Fi", "Whiteboard", "Podium"];
export const VENUE_ACCESSIBILITY_FEATURES = ["Wheelchair", "Elevator", "Ramp", "Accessible toilet", "Hearing loop"];
export type VenueDay = typeof VENUE_DAYS[number];
export type OpeningHours = Record<VenueDay, { opens: string; closes: string } | null>;

export type Venue = {
  id: string;
  reference?: string;
  name: string;
  location: string;
  capacity: number;
  facilities: string[];
  accessibility: string[];
  supported_layouts: string[];
  operating_hours: OpeningHours;
  timezone: string;
  setup_time_minutes?: number;
  turnaround_time_minutes?: number;
  created_by: number;
  created_at: string;
  revision?: number;
  updated_at?: string | null;
  creator?: { display_name: string } | null;
  is_retired?: boolean;
  // SCRUM-26: who retired the venue and when (null while it is active).
  retired_at?: string | null;
  retired_by?: number | null;
  retired_by_name?: string | null;
  search_availability?: "not_checked" | "available" | "retired" | "closed" | "blocked" | "booked";
};

// SCRUM-129 AC3: one booking a venue's setup/turnaround buffers made conflicting. The
// bookings are reported for a human to resolve, never changed or removed by the system.
export type BufferConflictSlot = {
  booking_id: string;
  reference?: string | null;
  event_id: string | null;
  event_title?: string | null;
  status: string;
  start_at: string;
  end_at: string;
  occupied_start: string;
  occupied_end: string;
};

export type BufferConflict = BufferConflictSlot & {
  reason: string;
  conflicts_with: BufferConflictSlot[];
};

/** Heading for the conflict report, e.g. "2 existing bookings now conflict". */
export function conflictCountLabel(count: number): string {
  return `${count} existing ${count === 1 ? "booking" : "bookings"} now conflict`;
}

/** A booking's event name, or a stated stand-in when the record does not name one. */
export function conflictEventLabel(title: string | null | undefined, fallback: string): string {
  return title ?? fallback;
}

export function defaultOpeningHours(): OpeningHours {
  return Object.fromEntries(VENUE_DAYS.map((day, index) => [day, index < 5 ? { opens: "09:00", closes: "18:00" } : null])) as OpeningHours;
}

// SCRUM-27: a venue's closures and the status a Coordinator reads before booking.
export type VenueBlock = {
  id: string;
  start_at: string;
  end_at: string;
  reason: string;
  note?: string | null;
};

export function venueMoment(value: string) {
  return new Date(value).toLocaleString("en-SG", {
    timeZone: "Asia/Singapore", dateStyle: "medium", timeStyle: "short",
  });
}

/** The closure running at `now`, if any. Half-open: a closure ending now is over. */
export function activeClosure(closures: VenueBlock[], now: number): VenueBlock | null {
  return closures.find(
    (closure) => Date.parse(closure.start_at) <= now && Date.parse(closure.end_at) > now,
  ) ?? null;
}

/** Retired wins over blocked: a retired venue takes no bookings whatever its calendar says. */
export function venueStatus(venue: Venue, current: VenueBlock | null) {
  if (venue.is_retired) return "Retired";
  return current ? `Blocked — ${current.reason} until ${venueMoment(current.end_at)}` : "Active";
}
