"use client";

import { useEffect, useState } from "react";
import { ApiError, apiRequest } from "@/lib/api";
import { BookingStatusBadge, formatSlot, type BookingRecord } from "@/lib/bookings";

// SCRUM-145 (R16): the read-only venue + technical detail a Safety Officer needs to make an
// informed operational safety decision (SCRUM-128). Fed by GET /events/<id>/safety-review-details,
// which is event-scoped — no catalogue access, no management.
type SafetyVenue = {
  id: string;
  name: string;
  location: string | null;
  capacity: number | null;
  supported_layouts: string[] | null;
  accessibility: string[] | null;
  facilities: string[] | null;
};

type SafetyReservation = {
  id: string;
  quantity: number | null;
  status: string;
  equipment?: { equipment_type: string; location: string | null } | null;
};

type SafetyReviewDetail = {
  bookings: BookingRecord[];
  venues: SafetyVenue[];
  equipment: { reservations: SafetyReservation[] };
};

function listOrNone(values: string[] | null | undefined): string {
  return values && values.length > 0 ? values.join(", ") : "None recorded";
}

export default function EventSafetyReviewDetail({ eventId }: { eventId: string }) {
  const [detail, setDetail] = useState<SafetyReviewDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    apiRequest<SafetyReviewDetail>(`/events/${eventId}/safety-review-details`, { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setDetail(result); })
      .catch((requestError) => {
        if (!controller.signal.aborted) {
          setError(requestError instanceof ApiError ? requestError.message : "Could not load the venue and technical detail.");
        }
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [eventId]);

  return (
    <section aria-labelledby="safety-detail-heading" className="space-y-5 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
      <div>
        <h2 id="safety-detail-heading" className="font-semibold">Venue &amp; technical detail</h2>
        <p className="mt-1 text-sm text-muted-foreground">Read-only, for your safety assessment. You cannot change these arrangements.</p>
      </div>
      {error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
      {loading && <p className="text-sm text-muted-foreground">Loading venue and technical detail...</p>}
      {detail && <>
        <div className="space-y-3">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Venues</h3>
          {detail.venues.length === 0
            ? <p className="text-sm text-muted-foreground">No venue has been booked for this event yet.</p>
            : <ul className="grid gap-3 sm:grid-cols-2">{detail.venues.map((venue) => (
              <li key={venue.id} className="rounded-xl border border-border p-4">
                <h4 className="font-medium">{venue.name}</h4>
                {venue.location && <p className="text-sm text-muted-foreground">{venue.location}</p>}
                <dl className="mt-2 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
                  <dt className="text-muted-foreground">Capacity</dt><dd>{venue.capacity ?? "Not recorded"}</dd>
                  <dt className="text-muted-foreground">Layouts</dt><dd>{listOrNone(venue.supported_layouts)}</dd>
                  <dt className="text-muted-foreground">Accessibility</dt><dd>{listOrNone(venue.accessibility)}</dd>
                  <dt className="text-muted-foreground">Facilities</dt><dd>{listOrNone(venue.facilities)}</dd>
                </dl>
              </li>
            ))}</ul>}
        </div>

        <div className="space-y-3">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Venue bookings</h3>
          {detail.bookings.length === 0
            ? <p className="text-sm text-muted-foreground">No venue bookings for this event.</p>
            : <ul className="grid gap-3 sm:grid-cols-2">{detail.bookings.map((booking) => (
              <li key={booking.id} className="rounded-xl border border-border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h4 className="font-medium">{booking.venue?.name ?? "Venue booking"}</h4>
                    <p className="mt-1 text-sm text-muted-foreground">{formatSlot(booking.start_at, booking.end_at)}</p>
                  </div>
                  <BookingStatusBadge status={booking.status} />
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{booking.layout} · {booking.expected_attendance} people</p>
              </li>
            ))}</ul>}
        </div>

        <div className="space-y-3">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Equipment</h3>
          {detail.equipment.reservations.length === 0
            ? <p className="text-sm text-muted-foreground">No equipment is reserved for this event.</p>
            : <ul className="grid gap-3 sm:grid-cols-2">{detail.equipment.reservations.map((reservation) => (
              <li key={reservation.id} className="rounded-xl border border-border p-4">
                <div className="flex items-start justify-between gap-3">
                  <h4 className="font-medium">{reservation.equipment?.equipment_type ?? "Equipment"}</h4>
                  <span className="text-xs text-muted-foreground">{reservation.status}</span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {reservation.quantity != null ? `${reservation.quantity} unit(s)` : ""}
                  {reservation.equipment?.location ? ` · ${reservation.equipment.location}` : ""}
                </p>
              </li>
            ))}</ul>}
        </div>
      </>}
    </section>
  );
}
