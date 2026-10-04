export const VENUE_DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
export const VENUE_LAYOUTS = ["Theatre", "Classroom", "Boardroom", "U-shape", "Banquet", "Standing"];
export type VenueDay = typeof VENUE_DAYS[number];
export type OpeningHours = Record<VenueDay, { opens: string; closes: string } | null>;

export type Venue = {
  id: string;
  name: string;
  location: string;
  capacity: number;
  facilities: string[];
  accessibility: string[];
  supported_layouts: string[];
  operating_hours: OpeningHours;
  timezone: string;
  created_by: number;
  created_at: string;
  revision?: number;
  updated_at?: string | null;
  creator?: { display_name: string } | null;
  is_retired?: boolean;
  search_availability?: "not_checked" | "available" | "retired" | "closed" | "blocked" | "booked";
};

export function defaultOpeningHours(): OpeningHours {
  return Object.fromEntries(VENUE_DAYS.map((day, index) => [day, index < 5 ? { opens: "09:00", closes: "18:00" } : null])) as OpeningHours;
}
