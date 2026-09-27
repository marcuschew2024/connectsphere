// Shared booking types for the venue-staff decision screen (SCRUM-32 / SCRUM-122).
// Column names match ADR-0001 (docs/adr/ADR-0001-venue-bookings-schema.md) and the
// proposed POST /venues/bookings/{id}/decision contract. The venue_bookings table is
// owned by SCRUM-31; until it lands the frontend is exercised against mocked responses.
import { createElement } from "react";

export type BookingStatus = "Pending" | "Confirmed" | "Rejected" | "Cancelled";

export type BookingRecord = {
  id: string;
  event_id: string;
  venue_id: string;
  start_at: string;
  end_at: string;
  status: BookingStatus;
  decision_reason: string | null;
  suggested_alternative: string | null;
  decided_by: number | null;
  decision_at: string | null;
  requested_by: number;
  created_at: string;
  // Optional joins the GET may include for display, mirroring venues' creator join.
  venue?: { name: string; location: string } | null;
  event?: { title: string | null } | null;
};

const statusStyles: Record<BookingStatus, string> = {
  Pending: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-400/30",
  Confirmed: "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-400/30",
  Rejected: "bg-red-100 text-red-700 border-red-200 dark:bg-red-500/15 dark:text-red-300 dark:border-red-400/30",
  Cancelled: "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-500/15 dark:text-slate-300 dark:border-slate-400/30",
};

export function BookingStatusBadge({ status }: { status: BookingStatus }) {
  return createElement(
    "span",
    {
      className: `inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${statusStyles[status] ?? statusStyles.Cancelled}`,
    },
    status,
  );
}

// Asia/Singapore-friendly slot label, e.g. "20 Oct 2026, 2:00 pm – 4:00 pm".
export function formatSlot(startAt: string, endAt: string): string {
  const start = new Date(startAt);
  const end = new Date(endAt);
  const date = start.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  const time = (value: Date) => value.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${date}, ${time(start)} – ${time(end)}`;
}
