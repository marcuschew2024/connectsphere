"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiError, apiRequest } from "@/lib/api";
import { BookingStatusBadge, formatSlot, type BookingRecord } from "@/lib/bookings";
import { useActingRole } from "@/lib/use-acting-role";
import { AppShell } from "@/components/app-shell";
import BookingDecisionForm from "./booking-decision-form";

// A small stage timeline: Requested -> Under review -> Confirmed/Rejected.
function BookingTimeline({ booking }: { booking: BookingRecord }) {
  const decided = booking.status === "Confirmed" || booking.status === "Rejected";
  const rejected = booking.status === "Rejected";
  const steps = [
    { label: "Requested", sub: booking.requested_at ? new Date(booking.requested_at).toLocaleDateString() : "", tone: "done" },
    { label: "Under review", sub: "Venue Staff", tone: decided ? "done" : "active" },
    {
      label: decided ? (rejected ? "Rejected" : "Confirmed") : "Decision",
      sub: booking.decision_at ? new Date(booking.decision_at).toLocaleDateString() : "Pending",
      tone: decided ? (rejected ? "rejected" : "done") : "upcoming",
    },
  ];
  const circle: Record<string, string> = {
    done: "bg-emerald-500 border-emerald-500 text-white",
    active: "bg-primary border-primary text-primary-foreground",
    rejected: "bg-destructive border-destructive text-white",
    upcoming: "bg-card border-border text-muted-foreground",
  };
  const glyph: Record<string, string> = { done: "✓", active: "•", rejected: "✕", upcoming: "•" };
  return (
    <ol className="flex items-start rounded-2xl border border-border bg-card px-4 py-5 shadow-sm">
      {steps.map((step, index) => (
        <li key={step.label} className="relative flex flex-1 flex-col items-center text-center">
          {index > 0 && (
            <span aria-hidden="true" className={`absolute right-1/2 top-4 h-0.5 w-full ${["done", "rejected"].includes(steps[index - 1].tone) ? "bg-emerald-500" : "bg-border"}`} />
          )}
          <span className={`relative z-10 grid size-8 place-items-center rounded-full border text-sm font-semibold ${circle[step.tone]}`}>{glyph[step.tone]}</span>
          <span className="mt-2 text-xs font-semibold text-foreground">{step.label}</span>
          <span className="text-[11px] text-muted-foreground">{step.sub}</span>
        </li>
      ))}
    </ol>
  );
}

// SCRUM-122: Venue Staff review one submitted booking request and decide on it.
// The pending-bookings queue/list is SCRUM-31's; this page is the per-booking decision
// surface, reachable from that queue (or by direct link).
export default function BookingDecisionPage() {
  const params = useParams<{ bookingId: string }>();
  const [actingRole] = useActingRole();
  const [booking, setBooking] = useState<BookingRecord | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 8000);

    apiRequest<{ booking: BookingRecord }>(`/venues/bookings/${params.bookingId}`, {
      signal: controller.signal,
    })
      .then((result) => {
        setBooking(result.booking);
        setLoading(false);
      })
      .catch((requestError) => {
        if (controller.signal.aborted && !timedOut) return;
        if (timedOut) {
          setError("The booking request timed out. Check that the API is running.");
        } else if (requestError instanceof ApiError && requestError.status === 401) {
          setError("Please select a demo user before viewing this booking.");
        } else if (requestError instanceof ApiError && requestError.status === 403) {
          setError("You do not have access to this booking.");
        } else {
          setError(
            requestError instanceof ApiError
              ? requestError.message
              : "Could not load this booking.",
          );
        }
        setLoading(false);
      });

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [params.bookingId]);

  const canReview = actingRole === "Venue Staff" && (booking?.status === "Requested" || booking?.status === "Pending");

  return (
    <AppShell actingRole={actingRole}>
      <div className="mx-auto max-w-6xl space-y-6 px-5 py-8 sm:px-8 sm:py-10">
        {error && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</p>}
        {loading && <p className="text-muted-foreground">Loading booking request...</p>}
        {booking && <>
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-primary">Booking request</p>
              <h1 className="mt-2 break-words text-2xl font-semibold tracking-tight sm:text-3xl">
                {booking.venue?.name ?? "Venue booking"}
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">{formatSlot(booking.start_at, booking.end_at)}</p>
            </div>
            <div className="space-y-2 text-right">
              <p className="text-xs text-muted-foreground">Current status</p>
              <BookingStatusBadge status={booking.status} />
            </div>
          </header>

          <BookingTimeline booking={booking} />

          {booking.status === "Confirmed" && (
            <section aria-labelledby="confirmed-heading" className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5">
              <h2 id="confirmed-heading" className="font-semibold text-emerald-700 dark:text-emerald-400">Booking confirmed</h2>
              <p role="status" className="mt-1 text-sm text-muted-foreground">
                The venue is confirmed for this slot{booking.decision_at ? ` (${new Date(booking.decision_at).toLocaleString()})` : ""}.
              </p>
            </section>
          )}
          {booking.status === "Rejected" && (
            <section aria-labelledby="rejected-heading" className="space-y-2 rounded-2xl border border-destructive/30 bg-destructive/5 p-5">
              <h2 id="rejected-heading" className="font-semibold text-destructive">Booking rejected</h2>
              <p className="whitespace-pre-wrap break-words text-sm text-foreground">{booking.decision_reason || "No rejection reason was recorded."}</p>
              {booking.suggested_alternative && (
                <p className="text-sm text-muted-foreground">Suggested alternative: {booking.suggested_alternative}</p>
              )}
            </section>
          )}

          <div className={`grid items-start gap-6 ${canReview ? "lg:grid-cols-[minmax(0,1fr)_360px]" : ""}`}>
            <section aria-labelledby="booking-details-heading" className="min-w-0 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
              <h2 id="booking-details-heading" className="mb-5 font-semibold">Booking details</h2>
              <dl className="grid gap-x-6 gap-y-5 text-sm sm:grid-cols-2">
                <div><dt className="mb-1 text-xs text-muted-foreground">Venue</dt><dd className="break-words">{booking.venue?.name ?? "Not provided"}</dd></div>
                <div><dt className="mb-1 text-xs text-muted-foreground">Location</dt><dd className="break-words">{booking.venue?.location ?? "Not provided"}</dd></div>
                <div><dt className="mb-1 text-xs text-muted-foreground">Event</dt><dd className="break-words">{booking.event?.title ?? "Not provided"}</dd></div>
                <div><dt className="mb-1 text-xs text-muted-foreground">Time slot</dt><dd>{formatSlot(booking.start_at, booking.end_at)}</dd></div>
                <div className="border-t border-border pt-4 sm:col-span-2"><dt className="mb-1 text-xs text-muted-foreground">Booking reference</dt><dd className="break-all font-mono text-xs text-muted-foreground">{booking.id}</dd></div>
              </dl>
            </section>

            {canReview && <aside aria-label="Review actions" className="lg:sticky lg:top-6">
              <BookingDecisionForm booking={booking} onSaved={setBooking} />
            </aside>}
          </div>
        </>}
      </div>
    </AppShell>
  );
}
