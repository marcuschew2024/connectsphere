// Shared event types and status badges for the request and review screens.
// Column names match supabase/create_events.sql and the Flask API.
import { createElement } from "react";

export type EventRecord = {
  id: string;
  reference?: string;
  title: string | null;
  description: string | null;
  purpose: string | null;
  category: string | null;
  event_datetime: string | null;
  expected_attendance: number | null;
  // Optional while older deployments are upgraded; null keeps signup closed.
  registration_capacity?: number | null;
  registered_count?: number;
  withdrawal_closes_at?: string | null;
  venue_requirements: string | null;
  accessibility_requirements: string | null;
  equipment_requirements: string | null;
  registration_requirements: string | null;
  status: "Draft" | "Submitted" | "Planning" | "Confirmed" | "Preparation" | "Completed" | "Rejected" | "Cancelled";
  // GET responses keep the existing display status and also expose the stored state.
  request_status?: string;
  organiser_id: number;
  coordinator_id: number | null;
  coordinator_assigned_at: string | null;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
  last_status_changed_by: number | null;
  last_status_changed_at: string | null;
  decision_reason: string | null;
  decision_by: number | null;
  decision_at: string | null;
};

// SCRUM-54: the Coordinator events list augments each record with whether it is the
// acting Coordinator's own event (organised or assigned) — surfaced first and actionable,
// others view-only. Kept off EventRecord so forms that index EventRecord by key are
// unaffected by the extra boolean field.
export type CoordinatorEventRecord = EventRecord & { is_mine?: boolean };

export type EventStatusHistory = {
  id: number;
  event_id: string;
  old_status: string | null;
  new_status: string;
  changed_by: number;
  changed_at: string;
  action?: string | null;
  note?: string | null;
};

// POST /events/<id>/complete (SCRUM-132): the closed event and the holds it released.
export type EventCompletionResult = {
  event: EventRecord;
  released: { equipment_reservations: number; venue_bookings: number };
};

// POST /events/<id>/cancel (SCRUM-69): the cancelled event, released holds and notices sent.
export type EventCancellationResult = EventCompletionResult & {
  notified_attendees: number;
};

export type EventClarification = {
  id: number;
  event_id: string;
  note: string;
  requested_by: number;
  requested_at: string;
  status: "Pending" | "Resubmitted";
  responded_by: number | null;
  responded_at: string | null;
};

export type EventChangeRequest = {
  id: number;
  event_id: string;
  requested_by: number;
  description: string;
  status: "Pending" | "Under Review" | "Approved" | "Rejected" | "Implemented";
  reviewed_by: number | null;
  review_note: string | null;
  requested_at: string;
  reviewed_at: string | null;
  // SCRUM-138: proposed values, and what approval actually changed.
  requested_changes?: Record<string, string | number | null> | null;
  applied_changes?: Record<string, { from: string | number | null; to: string | number | null }> | null;
  significant?: boolean | null;
};


type VisibleStatus = "Planning" | "Confirmed" | "Preparation" | "Completed" | "Rejected" | "Cancelled";

const statusStyles: Record<VisibleStatus, string> = {
  Planning: "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-400/30",
  Confirmed: "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-400/30",
  Preparation: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-400/30",
  Completed: "bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:border-violet-400/30",
  Rejected: "bg-red-100 text-red-700 border-red-200 dark:bg-red-500/15 dark:text-red-300 dark:border-red-400/30",
  Cancelled: "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-500/15 dark:text-slate-300 dark:border-slate-400/30",
};

const fallbackStyle = statusStyles.Cancelled;

export function StatusBadge({ status }: { status: string }) {
  const safeStatus = (status as VisibleStatus) ?? "Planning";

  return createElement(
    "span",
    {
      "data-testid": "event-status-badge",
      className: `inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${statusStyles[safeStatus] ?? fallbackStyle}`,
    },
    safeStatus,
  );
}

const changeRequestStatusStyles: Record<EventChangeRequest["status"], string> = {
  Pending: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-400/30",
  "Under Review": "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-400/30",
  Approved: "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-400/30",
  Rejected: "bg-red-100 text-red-700 border-red-200 dark:bg-red-500/15 dark:text-red-300 dark:border-red-400/30",
  Implemented: "bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:border-violet-400/30",
};

// SCRUM-156: an approved significant change stays "in re-review" until implemented.
const RE_REVIEW_STYLE = changeRequestStatusStyles.Pending;

export function ChangeRequestStatusBadge({ status, reReview = false }: {
  status: EventChangeRequest["status"];
  reReview?: boolean;
}) {
  return createElement(
    "span",
    {
      "data-testid": "change-request-status-badge",
      className: `inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${reReview ? RE_REVIEW_STYLE : changeRequestStatusStyles[status]}`,
    },
    reReview ? "Approved · Re-review in progress" : status,
  );
}
