"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiError, apiRequest } from "@/lib/api";
import type { BookingRecord } from "@/lib/bookings";
import type { Venue } from "@/lib/venues";
import { AppShell } from "@/components/app-shell";
import { useActingRole } from "@/lib/use-acting-role";

const INPUT = "w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30";

function localValue(iso: string) {
  const date = new Date(iso);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return Number.isNaN(date.getTime()) ? "" : local.toISOString().slice(0, 16);
}

export default function EditBookingPage() {
  const params = useParams<{ bookingId: string }>();
  const router = useRouter();
  const [role] = useActingRole();
  const [booking, setBooking] = useState<BookingRecord | null>(null);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [venueId, setVenueId] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [attendance, setAttendance] = useState("");
  const [layout, setLayout] = useState("");
  const [special, setSpecial] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([
      apiRequest<{ booking: BookingRecord }>(`/venues/bookings/${params.bookingId}`),
      apiRequest<{ venues: Venue[] }>("/venues?page=1"),
    ]).then(([bookingResult, venueResult]) => {
      const value = bookingResult.booking;
      setBooking(value);
      setVenues(venueResult.venues);
      setVenueId(value.venue_id);
      setStart(localValue(value.start_at));
      setEnd(localValue(value.end_at));
      setAttendance(String(value.expected_attendance));
      setLayout(value.layout);
      setSpecial(value.special_requirements ?? "");
    }).catch((requestError) => setError(requestError instanceof ApiError ? requestError.message : "Could not load this booking."));
  }, [params.bookingId]);

  async function save() {
    if (!booking || busy) return;
    setBusy(true); setError("");
    const selectedVenue = venues.find((venue) => venue.id === venueId);
    const startDate = new Date(start);
    const endDate = new Date(end);
    if (!selectedVenue || Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      setError("Choose a venue and valid start and end times."); setBusy(false); return;
    }
    if (endDate <= startDate) { setError("The end date and time must be after the start date and time."); setBusy(false); return; }
    const count = Number(attendance);
    if (!Number.isInteger(count) || count < 1 || count > selectedVenue.capacity) { setError(`Expected attendance must be between 1 and ${selectedVenue.capacity}.`); setBusy(false); return; }
    try {
      await apiRequest<{ booking: BookingRecord }>(`/venues/bookings/${booking.id}`, { method: "PATCH", body: JSON.stringify({ venue_id: venueId, start_at: startDate.toISOString(), end_at: endDate.toISOString(), expected_attendance: count, layout, special_requirements: special }) });
      router.push(`/events/${booking.event_id}`);
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : "Could not change this booking.");
    } finally { setBusy(false); }
  }

  return <AppShell actingRole={role}><main className="mx-auto max-w-3xl space-y-6 px-5 py-8 sm:px-8 sm:py-10"><header><p className="text-xs font-medium uppercase tracking-[0.16em] text-primary">Coordinator workspace</p><h1 className="mt-2 text-3xl font-semibold">Change venue booking</h1><p className="mt-2 text-sm text-muted-foreground">Only this booking changes; the event and sibling bookings remain intact.</p></header>{error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}{booking && <form onSubmit={(event) => { event.preventDefault(); void save(); }} className="space-y-5 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-7"><label className="block text-sm font-medium">Venue<select value={venueId} onChange={(event) => setVenueId(event.target.value)} className={`${INPUT} mt-2`}>{venues.map((venue) => <option key={venue.id} value={venue.id}>{venue.name} · capacity {venue.capacity}</option>)}</select></label><div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-medium">Start<input type="datetime-local" value={start} onChange={(event) => setStart(event.target.value)} className={`${INPUT} mt-2`} /></label><label className="block text-sm font-medium">End<input type="datetime-local" value={end} onChange={(event) => setEnd(event.target.value)} className={`${INPUT} mt-2`} /></label></div><div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-medium">Expected attendance<input type="number" min="1" value={attendance} onChange={(event) => setAttendance(event.target.value)} className={`${INPUT} mt-2`} /></label><label className="block text-sm font-medium">Layout<input value={layout} onChange={(event) => setLayout(event.target.value)} maxLength={100} className={`${INPUT} mt-2`} /></label></div><label className="block text-sm font-medium">Special requirements<textarea value={special} onChange={(event) => setSpecial(event.target.value)} maxLength={2000} rows={5} className={`${INPUT} mt-2`} /></label><div className="flex gap-3"><button type="submit" disabled={busy} className="rounded-md bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50">{busy ? "Saving..." : "Save booking change"}</button><Link href={`/events/${booking.event_id}`} className="rounded-md border border-border px-5 py-3 text-sm">Cancel</Link></div></form>}</main></AppShell>;
}
