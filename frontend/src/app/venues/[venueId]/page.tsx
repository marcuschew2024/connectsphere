"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiError, apiRequest } from "@/lib/api";
import { useActingRole } from "@/lib/use-acting-role";
import { AppShell } from "@/components/app-shell";
import { weekStartMs, type CalendarBooking } from "@/lib/availability";
import type { Venue } from "@/lib/venues";
import VenueAvailabilityCalendar from "./venue-availability-calendar";

const DAY_MS = 24 * 60 * 60 * 1000;
const INTERNAL_ROLES = ["Coordinator", "Venue Staff"];

// SCRUM-30: venue detail + read-only availability calendar for internal users.
// Read contract (mocked until SCRUM-31 lands):
//   GET /venues/{id}                         -> { venue }
//   GET /venues/{id}/bookings?from=&to=      -> { bookings: [{ start_at, end_at, status }] }
// Overlap/suitability logic is NOT computed here — this only displays the returned bookings.
export default function VenueDetailPage() {
  const params = useParams<{ venueId: string }>();
  const [actingRole] = useActingRole();
  const [venue, setVenue] = useState<Venue | null>(null);
  const [bookings, setBookings] = useState<CalendarBooking[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const weekStart = weekStartMs(new Date());

  useEffect(() => {
    const controller = new AbortController();
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 8000);

    const from = new Date(weekStart).toISOString();
    const to = new Date(weekStart + 7 * DAY_MS).toISOString();

    Promise.all([
      apiRequest<{ venue: Venue }>(`/venues/${params.venueId}`, { signal: controller.signal }),
      apiRequest<{ bookings: CalendarBooking[] }>(
        `/venues/${params.venueId}/bookings?from=${from}&to=${to}`,
        { signal: controller.signal },
      ),
    ])
      .then(([venueResult, bookingsResult]) => {
        setVenue(venueResult.venue);
        setBookings(bookingsResult.bookings);
        setLoading(false);
      })
      .catch((requestError) => {
        if (controller.signal.aborted && !timedOut) return;
        if (timedOut) {
          setError("The calendar timed out. Check that the API is running.");
        } else if (requestError instanceof ApiError && requestError.status === 401) {
          setError("Please select a demo user before viewing this venue.");
        } else {
          setError(
            requestError instanceof ApiError ? requestError.message : "Could not load this venue.",
          );
        }
        setLoading(false);
      });

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [params.venueId, weekStart]);

  const canView = actingRole !== null && INTERNAL_ROLES.includes(actingRole);

  return (
    <AppShell actingRole={actingRole}>
      <div className="mx-auto max-w-6xl space-y-6 px-5 py-8 sm:px-8 sm:py-10">
        {error && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</p>}
        {loading && <p className="text-muted-foreground">Loading venue...</p>}

        {!loading && !canView && (
          <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            The availability calendar is available to Coordinators and Venue Staff.
          </p>
        )}

        {venue && canView && <>
          <header>
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-primary">Venue</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">{venue.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{venue.location} · capacity {venue.capacity}</p>
          </header>

          <VenueAvailabilityCalendar hours={venue.operating_hours} bookings={bookings} weekStart={weekStart} />
        </>}
      </div>
    </AppShell>
  );
}
