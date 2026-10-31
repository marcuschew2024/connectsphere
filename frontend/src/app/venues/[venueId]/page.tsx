"use client";

import { recordReference } from "@/lib/record-reference";

import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { ApiError, apiRequest } from "@/lib/api";
import { useActingRole } from "@/lib/use-acting-role";
import { AppShell } from "@/components/app-shell";
import { weekStartMs, type CalendarBooking } from "@/lib/availability";
import type { Venue } from "@/lib/venues";
import VenueAvailabilityCalendar from "./venue-availability-calendar";
import VenueRetirePanel from "./venue-retire-panel";

type Suitability = {
  is_suitable: boolean;
  flags: string[];
  checked_rules_count: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const INTERNAL_ROLES = ["Coordinator", "Venue Staff"];
const BLOCK_REASONS = [
  "Maintenance",
  "Renovation",
  "Safety",
  "Failure",
  "Emergency",
  "Internal activity",
] as const;

type VenueBlock = {
  id: string;
  start_at: string;
  end_at: string;
  reason: string;
  note?: string | null;
};

async function loadVenueData(venueId: string, weekStart: number, controller?: AbortController) {
  const from = new Date(weekStart).toISOString();
  const to = new Date(weekStart + 7 * DAY_MS).toISOString();
  const [venueResult, bookingsResult, blocksResult] = await Promise.all([
    apiRequest<{ venue: Venue }>(`/venues/${venueId}`, { signal: controller?.signal }),
    apiRequest<{ bookings: CalendarBooking[] }>(
      `/venues/${venueId}/bookings?from=${from}&to=${to}`,
      { signal: controller?.signal },
    ),
    apiRequest<{ blocks: VenueBlock[] }>(
      `/venues/${venueId}/unavailability?from=${from}&to=${to}`,
      { signal: controller?.signal },
    ),
  ]);
  return { venue: venueResult.venue, bookings: bookingsResult.bookings, blocks: blocksResult.blocks };
}

// SCRUM-30: venue detail + read-only availability calendar for internal users.
// Read contract (mocked until SCRUM-31 lands):
//   GET /venues/{id}                         -> { venue }
//   GET /venues/{id}/bookings?from=&to=      -> { bookings: [{ start_at, end_at, status }] }
// Overlap/suitability logic is NOT computed here — this only displays the returned bookings.
export default function VenueDetailPage() {
  const params = useParams<{ venueId: string }>();
  const searchParams = useSearchParams();
  const eventId = searchParams.get("eventId");
  const [actingRole] = useActingRole();
  const [venue, setVenue] = useState<Venue | null>(null);
  const [bookings, setBookings] = useState<CalendarBooking[]>([]);
  const [blocks, setBlocks] = useState<VenueBlock[]>([]);
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [reason, setReason] = useState<(typeof BLOCK_REASONS)[number]>("Maintenance");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [keptBookings, setKeptBookings] = useState<number | null>(null);
  const [suitability, setSuitability] = useState<Suitability | null>(null);

  const weekStart = weekStartMs(new Date());

  useEffect(() => {
    const controller = new AbortController();
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 8000);

    loadVenueData(params.venueId, weekStart, controller)
      .then((loaded) => {
        setVenue(loaded.venue);
        setBookings(loaded.bookings);
        setBlocks(loaded.blocks);
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
  useEffect(() => {
    if (!eventId) return;
    const controller = new AbortController();
    apiRequest<{ suitability: Suitability }>(`/venues/${params.venueId}/suitability/${eventId}`, { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setSuitability(result.suitability); })
      .catch(() => { if (!controller.signal.aborted) setSuitability(null); });
    return () => controller.abort();
  }, [eventId, params.venueId]);

  async function blockVenue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const start = new Date(`${startAt}:00+08:00`).toISOString();
      const end = new Date(`${endAt}:00+08:00`).toISOString();
      await apiRequest(`/venues/${params.venueId}/unavailability`, {
        method: "POST",
        body: JSON.stringify({ start_at: start, end_at: end, reason, note }),
      });
      const loaded = await loadVenueData(params.venueId, weekStart);
      setVenue(loaded.venue);
      setBookings(loaded.bookings);
      setBlocks(loaded.blocks);
      setStartAt("");
      setEndAt("");
      setNote("");
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : "Could not block this venue.");
    } finally {
      setSaving(false);
    }
  }

  async function unblockVenue(blockId: string) {
    setError("");
    try {
      await apiRequest(`/venues/${params.venueId}/unavailability/${blockId}`, { method: "DELETE" });
      const loaded = await loadVenueData(params.venueId, weekStart);
      setVenue(loaded.venue);
      setBookings(loaded.bookings);
      setBlocks(loaded.blocks);
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : "Could not unblock this venue.");
    }
  }

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
          {venue.reference && <p className="text-xs text-muted-foreground">{recordReference(venue, venue.created_at)}</p>}
            <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">{venue.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{venue.location} · capacity {venue.capacity}</p>
          </header>

          {suitability && !suitability.is_suitable && (
            <section aria-label="Venue suitability advisory" className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
              <h2 className="font-semibold text-amber-700 dark:text-amber-400">Suitability advisory</h2>
              <p className="mt-1 text-sm text-muted-foreground">This venue may not meet every requirement. It remains available to request.</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                {suitability.flags.map((flag) => <li key={flag}>{flag}</li>)}
              </ul>
            </section>
          )}

          {/* SCRUM-26: retirement banner and the Venue Staff retire action. */}
          {venue.is_retired ? (
            <div role="status" className="rounded-xl border border-border bg-muted/40 p-4 text-sm">
              <p className="font-semibold">Venue retired</p>
              <p className="mt-1 text-muted-foreground">
                {venue.retired_at ? `Retired ${new Date(venue.retired_at).toLocaleString("en-SG", { timeZone: "Asia/Singapore", dateStyle: "medium", timeStyle: "short" })} (Singapore)` : "Retired"}
                {venue.retired_by_name ? ` by ${venue.retired_by_name}` : ""}. It is no longer offered for new bookings; its existing bookings and history are kept.
              </p>
              {keptBookings !== null && <p className="mt-1 text-muted-foreground">{keptBookings} upcoming confirmed {keptBookings === 1 ? "booking was" : "bookings were"} kept.</p>}
            </div>
          ) : actingRole === "Venue Staff" && (
            <VenueRetirePanel venue={venue} onRetired={(result) => { setVenue(result.venue); setKeptBookings(result.kept_confirmed_bookings); }} />
          )}

          <VenueAvailabilityCalendar hours={venue.operating_hours} bookings={bookings} weekStart={weekStart} />

          {actingRole === "Venue Staff" && (
            <section aria-labelledby="venue-block-heading" className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <h2 id="venue-block-heading" className="font-semibold">Block venue period</h2>
              <form className="mt-4 grid gap-4 sm:grid-cols-2" onSubmit={blockVenue}>
                <label className="text-sm font-medium">Start
                  <input type="datetime-local" value={startAt} onChange={(event) => setStartAt(event.target.value)} required
                    className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2" />
                </label>
                <label className="text-sm font-medium">End
                  <input type="datetime-local" value={endAt} onChange={(event) => setEndAt(event.target.value)} required
                    className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2" />
                </label>
                <label className="text-sm font-medium">Reason
                  <select value={reason} onChange={(event) => setReason(event.target.value as typeof reason)}
                    className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2">
                    {BLOCK_REASONS.map((option) => <option key={option}>{option}</option>)}
                  </select>
                </label>
                <label className="text-sm font-medium">Note
                  <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000}
                    className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2" />
                </label>
                <button type="submit" disabled={saving} className="sm:col-span-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
                  {saving ? "Blocking venue…" : "Block venue"}
                </button>
              </form>

              {blocks.length > 0 && (
                <div className="mt-6 space-y-3">
                  <h3 className="text-sm font-semibold">Active blocks</h3>
                  {blocks.map((block) => (
                    <div key={block.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
                      <p className="text-sm"><strong>{block.reason}</strong> · {new Date(block.start_at).toLocaleString()} – {new Date(block.end_at).toLocaleString()}</p>
                      <button type="button" onClick={() => unblockVenue(block.id)} className="rounded-md border border-border px-3 py-1.5 text-sm">Unblock</button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </>}
      </div>
    </AppShell>
  );
}
