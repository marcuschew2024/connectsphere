"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError, apiRequest } from "@/lib/api";
import { BookingStatusBadge, formatSlot, type BookingRecord } from "@/lib/bookings";
import { AppShell } from "@/components/app-shell";
import { useActingRole } from "@/lib/use-acting-role";

export default function BookingQueuePage() {
  const [role] = useActingRole();
  const [bookings, setBookings] = useState<BookingRecord[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    apiRequest<{ bookings: BookingRecord[] }>("/venues/bookings", { signal: controller.signal })
      .then((result) => setBookings(result.bookings))
      .catch((requestError) => {
        if (!controller.signal.aborted) setError(requestError instanceof ApiError ? requestError.message : "Could not load booking requests.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  return <AppShell actingRole={role}>
    <main className="mx-auto max-w-6xl space-y-6 px-5 py-8 sm:px-8 sm:py-10">
      <header><p className="text-xs font-medium uppercase tracking-[0.16em] text-primary">Venue Staff workspace</p><h1 className="mt-2 text-3xl font-semibold">Booking requests</h1><p className="mt-2 text-sm text-muted-foreground">Review requested venue bookings routed to Venue Staff.</p></header>
      {error && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</p>}
      {loading && <p className="text-muted-foreground">Loading booking requests...</p>}
      {!loading && !error && bookings.length === 0 && <section className="rounded-2xl border border-dashed border-border px-6 py-12 text-center text-muted-foreground">There are no requested venue bookings.</section>}
      {!loading && !error && bookings.length > 0 && <ul className="grid gap-4 sm:grid-cols-2">{bookings.map((booking) => <li key={booking.id}><Link href={`/venues/bookings/${booking.id}`} className="block rounded-2xl border border-border bg-card p-5 shadow-sm transition hover:border-primary/40 hover:shadow-md"><div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold">{booking.venue?.name ?? "Venue booking"}</h2><p className="mt-1 text-sm text-muted-foreground">{booking.event?.title ?? "Event"}</p></div><BookingStatusBadge status={booking.status} /></div><p className="mt-4 text-sm text-muted-foreground">{formatSlot(booking.start_at, booking.end_at)}</p><p className="mt-3 text-sm text-primary">Open request →</p></Link></li>)}</ul>}
    </main>
  </AppShell>;
}
