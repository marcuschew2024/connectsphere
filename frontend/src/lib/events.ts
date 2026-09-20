// Shared with future draft, coordinator and status screens.
// Column names match supabase/create_events.sql and the Flask API.
export type EventRecord = {
  id: string;
  title: string | null;
  description: string | null;
  purpose: string | null;
  category: string | null;
  event_datetime: string | null;
  expected_attendance: number | null;
  venue_requirements: string | null;
  accessibility_requirements: string | null;
  equipment_requirements: string | null;
  registration_requirements: string | null;
  status: "Draft" | "Submitted" | "Planning" | "Confirmed" | "Completed" | "Rejected" | "Cancelled";
  organiser_id: number;
  coordinator_id: number | null;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
};
