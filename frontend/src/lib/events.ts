// Shared event types and status badges for the request and review screens.
// Column names match supabase/create_events.sql and the Flask API.
import { createElement } from "react";

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


type VisibleStatus = "Planning" | "Confirmed" | "Completed" | "Rejected" | "Cancelled";

const statusStyles: Record<VisibleStatus, string> = {
  Planning: "bg-blue-500/20 text-blue-200 border-blue-400/50",
  Confirmed: "bg-emerald-500/20 text-emerald-200 border-emerald-400/50",
  Completed: "bg-violet-500/20 text-violet-200 border-violet-400/50",
  Rejected: "bg-red-500/20 text-red-200 border-red-400/50",
  Cancelled: "bg-slate-500/20 text-slate-200 border-slate-400/50",
};

export function StatusBadge({ status }: { status: string }) {
  const safeStatus = (status as VisibleStatus) ?? "Planning";

  return createElement(
    "span",
    {
      className: `inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${statusStyles[safeStatus] ?? "bg-slate-500/20 text-slate-200 border-slate-400/50"}`,
    },
    safeStatus,
  );
}
