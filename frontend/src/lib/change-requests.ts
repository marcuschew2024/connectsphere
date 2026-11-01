import type { EventChangeRequest, EventRecord } from "@/lib/events";

// SCRUM-138/SCRUM-48: event details an Organiser can propose new values for, including
// the date and time (rescheduling). "datetime" fields render as a datetime-local input
// and are sent as ISO; everything else is plain text, attendance a number.
export const CHANGE_FIELDS = [
  { name: "title", label: "Title" },
  { name: "event_datetime", label: "Date and time", kind: "datetime" },
  { name: "expected_attendance", label: "Expected attendance", kind: "number" },
  { name: "venue_requirements", label: "Venue requirements" },
  { name: "facility_requirements", label: "Facility requirements" },
  { name: "category", label: "Category" },
  { name: "purpose", label: "Purpose" },
  { name: "description", label: "Event description" },
  { name: "equipment_requirements", label: "Equipment requirements" },
  { name: "accessibility_requirements", label: "Accessibility requirements" },
  { name: "registration_requirements", label: "Registration requirements" },
] as const;

export type ChangeField = typeof CHANGE_FIELDS[number]["name"];

// Number of pax, venue, or date/time (S1 Q7, Q11; SCRUM-48): approving one flags a re-review.
export const SIGNIFICANT_FIELDS: ReadonlySet<string> = new Set([
  "expected_attendance", "venue_requirements", "event_datetime",
]);

export type ChangeApprovalResult = {
  change_request: EventChangeRequest;
  event?: EventRecord;
  affected?: {
    venue_bookings: number;
    equipment_reservations: number;
    // SCRUM-152: active bookings whose venue is below the new expected attendance.
    over_capacity?: { booking_id: string; venue_name: string; capacity: number }[];
  };
};

export function changeFieldLabel(name: string) {
  return CHANGE_FIELDS.find((field) => field.name === name)?.label ?? name;
}

export function changeValue(value: string | number | null | undefined) {
  return value === null || value === undefined || value === "" ? "(none)" : String(value);
}

// The drafted values to send: blank inputs mean "no change"; attendance is a number;
// a date/time (datetime-local, in the browser's zone) is sent as an ISO instant so the
// server stores the same moment the Organiser picked (SCRUM-48).
export function proposedChanges(drafts: Partial<Record<ChangeField, string>>) {
  const changes: Record<string, string | number> = {};
  for (const { name } of CHANGE_FIELDS) {
    const value = drafts[name]?.trim();
    if (!value) continue;
    if (name === "expected_attendance") {
      changes[name] = /^\d+$/.test(value) ? Number(value) : value;
    } else if (name === "event_datetime") {
      changes[name] = Number.isNaN(Date.parse(value)) ? value : new Date(value).toISOString();
    } else {
      changes[name] = value;
    }
  }
  return Object.keys(changes).length ? changes : null;
}

// An approved significant change stays flagged until the Coordinator marks it Implemented.
export function needsReReview(request: EventChangeRequest) {
  return request.status === "Approved" && request.significant === true;
}
