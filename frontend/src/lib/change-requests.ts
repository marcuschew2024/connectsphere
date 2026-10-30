import type { EventChangeRequest, EventRecord } from "@/lib/events";

// SCRUM-138: event details an Organiser can propose new values for. Date and time are
// rescheduling (SCRUM-48), so they are described in the request text instead.
export const CHANGE_FIELDS = [
  { name: "title", label: "Title" },
  { name: "expected_attendance", label: "Expected attendance" },
  { name: "venue_requirements", label: "Venue requirements" },
  { name: "category", label: "Category" },
  { name: "purpose", label: "Purpose" },
  { name: "description", label: "Event description" },
  { name: "equipment_requirements", label: "Equipment requirements" },
  { name: "accessibility_requirements", label: "Accessibility requirements" },
  { name: "registration_requirements", label: "Registration requirements" },
] as const;

export type ChangeField = typeof CHANGE_FIELDS[number]["name"];

// Number of pax or venue (S1 Q7, Q11): approving one of these flags a re-review.
export const SIGNIFICANT_FIELDS: ReadonlySet<string> = new Set(["expected_attendance", "venue_requirements"]);

export type ChangeApprovalResult = {
  change_request: EventChangeRequest;
  event?: EventRecord;
  affected?: { venue_bookings: number; equipment_reservations: number };
};

export function changeFieldLabel(name: string) {
  return CHANGE_FIELDS.find((field) => field.name === name)?.label ?? name;
}

export function changeValue(value: string | number | null | undefined) {
  return value === null || value === undefined || value === "" ? "(none)" : String(value);
}

// The drafted values to send: blank inputs mean "no change"; attendance is a number.
export function proposedChanges(drafts: Partial<Record<ChangeField, string>>) {
  const changes: Record<string, string | number> = {};
  for (const { name } of CHANGE_FIELDS) {
    const value = drafts[name]?.trim();
    if (!value) continue;
    changes[name] = name === "expected_attendance" && /^\d+$/.test(value) ? Number(value) : value;
  }
  return Object.keys(changes).length ? changes : null;
}

// An approved significant change stays flagged until the Coordinator marks it Implemented.
export function needsReReview(request: EventChangeRequest) {
  return request.status === "Approved" && request.significant === true;
}
