"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { ChevronDown } from "lucide-react";
import { ApiError, apiRequest } from "@/lib/api";
import type { EventRecord } from "@/lib/events";
import type { Venue } from "@/lib/venues";
import { AppShell } from "@/components/app-shell";
import { useActingRole } from "@/lib/use-acting-role";

const INPUT =
  "w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30";
const SELECT = `${INPUT} appearance-none cursor-pointer pr-9`;

// A native <select> wrapped so it gets a consistent chevron across browsers.
function SelectField({
  label,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm font-medium">
      {label}
      <div className="relative mt-2">
        <select {...props} className={SELECT}>
          {children}
        </select>
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
      </div>
    </label>
  );
}

export default function NewBookingPage() {
  const [role] = useActingRole();
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [selectedVenueId, setSelectedVenueId] = useState("");
  const [attendance, setAttendance] = useState("");
  const [error, setError] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    async function loadOptions() {
      const eventResult = await apiRequest<{ events: EventRecord[] }>("/events");
      const allVenues: Venue[] = [];
      let page = 1;
      let hasMore = true;
      while (hasMore) {
        const venueResult = await apiRequest<{ venues: Venue[]; has_more: boolean }>(`/venues?page=${page}`);
        allVenues.push(...venueResult.venues);
        hasMore = venueResult.has_more;
        page += 1;
      }
      const planning = eventResult.events.filter((event) => event.status === "Planning");
      setEvents(planning);
      setVenues(allVenues);
      setSelectedEventId(planning[0]?.id ?? "");
      // Default the attendance to the chosen event's expected headcount.
      setAttendance(planning[0]?.expected_attendance != null ? String(planning[0].expected_attendance) : "");
      setSelectedVenueId(allVenues[0]?.id ?? "");
    }
    loadOptions().catch((requestError) =>
      setError(requestError instanceof ApiError ? requestError.message : "Could not load booking options."),
    );
  }, []);

  function onEventChange(eventId: string) {
    setSelectedEventId(eventId);
    const chosen = events.find((event) => event.id === eventId);
    if (chosen?.expected_attendance != null) setAttendance(String(chosen.expected_attendance));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setFields({});
    const data = new FormData(event.currentTarget);
    const start = new Date(String(data.get("start_at") ?? ""));
    const end = new Date(String(data.get("end_at") ?? ""));
    const selectedVenue = venues.find((venue) => venue.id === data.get("venue_id"));
    if (!selectedVenue) {
      setError("Choose a venue.");
      setBusy(false);
      return;
    }
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      setError("Enter a valid start and end date and time.");
      setBusy(false);
      return;
    }
    if (end <= start) {
      setError("The end date and time must be after the start date and time.");
      setBusy(false);
      return;
    }
    const attendanceValue = Number(data.get("expected_attendance"));
    if (!Number.isInteger(attendanceValue) || attendanceValue < 1) {
      setError("Enter a positive whole-number attendance.");
      setBusy(false);
      return;
    }
    if (attendanceValue > selectedVenue.capacity) {
      setError(`Expected attendance cannot exceed this venue's capacity of ${selectedVenue.capacity}.`);
      setBusy(false);
      return;
    }
    try {
      const result = await apiRequest<{ booking: { id: string } }>("/venues/bookings", {
        method: "POST",
        body: JSON.stringify({
          event_id: data.get("event_id"),
          venue_id: data.get("venue_id"),
          start_at: start.toISOString(),
          end_at: end.toISOString(),
          expected_attendance: attendanceValue,
          layout: data.get("layout"),
          special_requirements: data.get("special_requirements"),
        }),
      });
      if (result.booking.id) setSaved(true);
    } catch (requestError) {
      if (requestError instanceof ApiError) {
        setError(requestError.message);
        setFields(requestError.fields);
      } else {
        setError("Could not submit the booking request.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell actingRole={role}>
      <main className="mx-auto max-w-4xl space-y-6 px-5 py-8 sm:px-8 sm:py-10">
        <header>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-primary">Coordinator workspace</p>
          <h1 className="mt-2 text-3xl font-semibold">Request a venue</h1>
          <p className="mt-2 text-sm text-muted-foreground">Submit event timing and requirements to Venue Staff.</p>
        </header>
        {saved ? (
          <section role="status" className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-6">
            <h2 className="text-xl font-semibold text-emerald-700 dark:text-emerald-400">Booking request submitted</h2>
            <p className="mt-2 text-sm text-muted-foreground">Venue Staff have been notified and will review the Requested booking.</p>
            <Link href="/" className="mt-5 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">Return home</Link>
          </section>
        ) : (
          <form onSubmit={submit} className="space-y-5 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-7">
            {error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
            {events.length === 0 && (
              <p className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-400">
                No events are in Planning yet. A Coordinator must approve an event request before a venue can be booked for it.
              </p>
            )}

            <SelectField label="Event" name="event_id" required value={selectedEventId} onChange={(e) => onEventChange(e.target.value)}>
              {events.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.title} · {event.event_datetime ? new Date(event.event_datetime).toLocaleString() : ""}
                </option>
              ))}
            </SelectField>
            {fields.event_id && <p className="text-xs text-destructive">{fields.event_id}</p>}

            <SelectField label="Venue" name="venue_id" required value={selectedVenueId} onChange={(e) => setSelectedVenueId(e.target.value)}>
              {venues.length === 0 && <option value="">No venues available</option>}
              {venues.map((venue) => (
                <option key={venue.id} value={venue.id}>{venue.name} · capacity {venue.capacity}</option>
              ))}
            </SelectField>
            <p className="text-xs text-muted-foreground">Selected venue capacity: {venues.find((venue) => venue.id === selectedVenueId)?.capacity ?? "—"}</p>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-medium">Start<input name="start_at" type="datetime-local" required className={`${INPUT} mt-2`} /></label>
              <label className="block text-sm font-medium">End<input name="end_at" type="datetime-local" required className={`${INPUT} mt-2`} /></label>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-medium">
                Expected attendance <span className="font-normal text-muted-foreground">(from the event — editable)</span>
                <input name="expected_attendance" type="number" min="1" required value={attendance} onChange={(e) => setAttendance(e.target.value)} className={`${INPUT} mt-2`} />
              </label>
              <label className="block text-sm font-medium">Layout<input name="layout" required maxLength={100} placeholder="Theatre, Classroom..." className={`${INPUT} mt-2`} /></label>
            </div>
            <label className="block text-sm font-medium">Special requirements<textarea name="special_requirements" maxLength={2000} rows={5} className={`${INPUT} mt-2`} placeholder="Accessibility, equipment, setup, or other requirements" /></label>

            <div className="flex flex-wrap gap-3">
              <button type="submit" disabled={busy} className="rounded-md bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50">{busy ? "Submitting..." : "Submit booking request"}</button>
              <Link href="/venues" className="rounded-md border border-border px-5 py-3 text-sm">Cancel</Link>
            </div>
          </form>
        )}
      </main>
    </AppShell>
  );
}
