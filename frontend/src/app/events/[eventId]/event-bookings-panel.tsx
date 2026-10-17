"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError, apiRequest } from "@/lib/api";
import { BookingStatusBadge, formatSlot, type BookingRecord } from "@/lib/bookings";

export default function EventBookingsPanel({
  eventId,
  canManage,
}: {
  eventId: string;
  canManage: boolean;
}) {
  const [bookings, setBookings] = useState<BookingRecord[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    apiRequest<{ bookings: BookingRecord[] }>(`/venues/bookings/event/${eventId}`, { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setBookings(result.bookings);
      })
      .catch((requestError) => {
        if (!controller.signal.aborted) setError(requestError instanceof ApiError ? requestError.message : "Could not load venue bookings.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [eventId]);

  async function cancelBooking(bookingId: string) {
    setBusyId(bookingId);
    setError("");
    try {
      const result = await apiRequest<{ booking: BookingRecord }>(`/venues/bookings/${bookingId}/cancel`, { method: "POST" });
      setBookings((current) => current.map((booking) => booking.id === bookingId ? result.booking : booking));
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : "Could not cancel this booking.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section aria-labelledby="venue-bookings-heading" className="space-y-4 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="venue-bookings-heading" className="font-semibold">Venue bookings</h2>
          <p className="mt-1 text-sm text-muted-foreground">Each venue arrangement is managed independently.</p>
        </div>
        {canManage && <Link href={`/venues/bookings/new?eventId=${eventId}`} className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground">Add another venue</Link>}
      </div>
      {error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
      {loading && <p className="text-sm text-muted-foreground">Loading venue bookings...</p>}
      {!loading && !error && bookings.length === 0 && <p className="text-sm text-muted-foreground">No venue bookings have been requested for this event.</p>}
      {!loading && bookings.length > 0 && <ul className="grid gap-3 sm:grid-cols-2">{bookings.map((booking) => <li key={booking.id} className="rounded-xl border border-border p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="font-medium">{booking.venue?.name ?? "Venue booking"}</h3><p className="mt-1 text-sm text-muted-foreground">{formatSlot(booking.start_at, booking.end_at)}</p></div><BookingStatusBadge status={booking.status} /></div><p className="mt-2 text-sm text-muted-foreground">{booking.layout} · {booking.expected_attendance} people</p>{canManage && (booking.status === "Requested" || booking.status === "Confirmed") && <div className="mt-3 flex gap-3"><Link href={`/venues/bookings/${booking.id}/edit`} className="text-sm text-primary hover:underline">Change</Link><button type="button" disabled={busyId === booking.id} onClick={() => void cancelBooking(booking.id)} className="text-sm text-destructive hover:underline disabled:opacity-50">{busyId === booking.id ? "Cancelling..." : "Cancel"}</button></div>}</li>)}</ul>}
    </section>
  );
}
