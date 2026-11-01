"use client";

import { singaporeDateTime } from "@/lib/event-venue-requirements";
import { recordReference } from "@/lib/record-reference";

import Link from "next/link";
import { Building2, CheckCircle2, CircleHelp, CircleX, MapPin, TriangleAlert, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/api";
import { VENUE_DAYS, type Venue } from "@/lib/venues";
import { eventVenueRequirements } from "@/lib/event-venue-requirements";
import type { CoordinatorEventRecord } from "@/lib/events";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import VenueWorkspace from "./venue-workspace";
import VenueSearchForm from "./venue-search-form";

const AVAILABILITY_LABELS = {
  not_checked: "Choose a date and times to check availability",
  available: "Available for selected time",
  retired: "Unavailable — retired venue",
  closed: "Unavailable — outside opening hours",
  blocked: "Unavailable — blocked for selected time",
  booked: "Unavailable — confirmed booking",
};

const FILTER_LABELS: Record<string, string> = {
  attendance: "People", capacity: "Min. capacity", location: "Location", layout: "Layout",
  facilities: "Facilities", accessibility: "Accessibility", date: "Date",
  start_time: "From", end_time: "Until", available_only: "Available venues only",
};

type Suitability = {
  is_suitable: boolean;
  flags: string[];
  checked_rules_count: number;
};

type PlanningEvent = {
  id: string;
  title: string;
  status: string;
  expected_attendance: number | null;
  event_datetime: string | null;
  venue_requirements: string | null;
  accessibility_requirements: string | null;
};

type SearchValues = {
  attendance: string;
  layout: string;
  facilities: string;
  accessibility: string;
  date: string;
  start_time: string;
  end_time: string;
};

function requirementsForEvent(event: PlanningEvent | undefined): SearchValues {
  const requirements = eventVenueRequirements(event as CoordinatorEventRecord | undefined);
  const timing = singaporeDateTime(event?.event_datetime);
  return {
    attendance: event?.expected_attendance != null ? String(event.expected_attendance) : "",
    layout: [...requirements.layouts, ...requirements.customLayouts].join(", "),
    facilities: [...requirements.facilities, ...requirements.customFacilities].join(", "),
    accessibility: event?.accessibility_requirements ?? "",
    date: timing.date,
    start_time: timing.time,
    end_time: "",
  };
}

function Catalogue({ canCreate }: { canCreate: boolean }) {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [filters, setFilters] = useState("");
  const [planningEvents, setPlanningEvents] = useState<PlanningEvent[]>([]);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [searchValues, setSearchValues] = useState<SearchValues>(requirementsForEvent(undefined));
  const [suitabilityByVenue, setSuitabilityByVenue] = useState<Record<string, Suitability>>({});
  const [checkingSuitability, setCheckingSuitability] = useState(false);
  const top = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    apiRequest<{ events: PlanningEvent[] }>("/events", { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        const planning = result.events.filter((event) => event.status === "Planning");
        setPlanningEvents(planning);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    apiRequest<{ venues: Venue[]; has_more: boolean }>(`/venues?page=${page}${filters ? `&${filters}` : ""}`, { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) { setVenues(result.venues); setHasMore(result.has_more); } })
      .catch((error: unknown) => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Could not load the venue catalogue."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [page, attempt, filters]);
  useEffect(() => {
    if (!selectedEventId || venues.length === 0) {
      return;
    }
    const controller = new AbortController();
    void Promise.resolve().then(() => {
      if (!controller.signal.aborted) setCheckingSuitability(true);
    });
    Promise.all(venues.map(async (venue) => {
      const result = await apiRequest<{ suitability: Suitability }>(
        `/venues/${venue.id}/suitability/${selectedEventId}`,
        { signal: controller.signal },
      );
      return [venue.id, result.suitability] as const;
    }))
      .then((results) => {
        if (!controller.signal.aborted) setSuitabilityByVenue(Object.fromEntries(results));
      })
      .catch(() => {
        if (!controller.signal.aborted) setSuitabilityByVenue({});
      })
      .finally(() => {
        if (!controller.signal.aborted) setCheckingSuitability(false);
      });
    return () => controller.abort();
  }, [selectedEventId, venues]);
  function search(query: string) {
    setFilters(query); setPage(1); setLoading(true); setError(""); setAttempt((value) => value + 1);
  }
  function navigate(next: number) {
    setLoading(true); setError(""); setPage(next); setAttempt(attempt + 1);
    top.current?.scrollIntoView({ block: "start" });
  }
  return <div ref={top} className="scroll-mt-6 space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">Shared with Venue Staff and Coordinators</p>
      {canCreate && <Button asChild><Link href="/venues/new">Add a venue <span aria-hidden="true">＋</span></Link></Button>}
    </div>
    <VenueSearchForm key={selectedEventId || "venue-search"} initialValues={searchValues} onSearch={search} busy={loading} />
    <div className="rounded-xl border border-border bg-card p-4">
      <label className="grid gap-2 text-sm font-medium" htmlFor="suitability-event">
        Check suitability for event
        <select
          id="suitability-event"
          className="h-10 rounded-lg border border-input bg-background px-3"
          value={selectedEventId}
          onChange={(event) => {
            setSelectedEventId(event.target.value);
            setSuitabilityByVenue({});
            const chosen = planningEvents.find((item) => item.id === event.target.value);
            setSearchValues(requirementsForEvent(chosen));
          }}
        >
          <option value="">Choose an event to see advisory flags</option>
          {planningEvents.map((event) => <option key={event.id} value={event.id}>{event.title}</option>)}
        </select>
      </label>
      {checkingSuitability && <p role="status" className="mt-2 text-xs text-muted-foreground">Checking venue suitability…</p>}
    </div>
    {loading && <p role="status" className="p-6 text-sm text-muted-foreground">Loading venues…</p>}
    {error && <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5">
      <p role="alert" className="text-sm text-destructive">{error}</p>
      <Button type="button" variant="outline" size="sm" onClick={() => navigate(page)} className="mt-4">Try again</Button>
    </div>}
    {!loading && !error && <>
      <section aria-label="Search results summary" className="space-y-4 border-t-2 border-primary/20 pt-7 mt-10">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary"><Building2 className="size-4" aria-hidden="true" />Venue results</p>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div><h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{filters ? "Venues matching your requirements" : "Explore the catalogue"}</h2>
            <p role="status" className="mt-1 text-sm text-muted-foreground">{venues.length} {venues.length === 1 ? "venue" : "venues"} on this page{hasMore ? " · More results on the next page" : ""}</p>
          </div>
          <p className="text-xs text-muted-foreground">Availability is a time-slot check, not a booking confirmation.</p>
        </div>
        {filters && <div className="flex flex-wrap gap-2" aria-label="Applied filters">
          {Array.from(new URLSearchParams(filters)).map(([key, value]) => <Badge key={key} variant="secondary" className="max-w-full whitespace-normal break-words">
            {key === "available_only" ? FILTER_LABELS[key] : `${FILTER_LABELS[key] ?? key}: ${value}`}
          </Badge>)}
        </div>}
      </section>
      {venues.length === 0 ? <div className="rounded-2xl border border-dashed border-border px-6 py-12 text-center">
        <h2 className="text-lg font-medium">{filters ? "No venues match" : page === 1 ? "No venues yet" : "No more venues"}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{filters ? "Try another time, remove a facility requirement, or clear the filters to explore all venues." : canCreate ? "Add your first venue to make it available for event planning." : "Venues will appear here when Venue Staff add them."}</p>
        {filters && <Button type="reset" form="venue-search" variant="outline" className="mt-4">Reset search</Button>}
      </div> : <ul className="grid gap-6 lg:grid-cols-2">
        {venues.map((venue) => {
          const state = venue.is_retired ? "retired" : venue.search_availability ?? "not_checked";
          const StatusIcon = state === "available" ? CheckCircle2 : state === "not_checked" ? CircleHelp : CircleX;
          const suitability = suitabilityByVenue[venue.id];
          return <li key={venue.id} className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-md transition-shadow hover:shadow-lg">
          <div className="border-b border-border bg-primary/5 p-5 sm:p-6">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div className="flex size-11 items-center justify-center rounded-xl border border-primary/15 bg-background text-primary"><Building2 className="size-6" aria-hidden="true" /></div>
              <span className="flex items-center gap-1.5 rounded-full bg-background px-3 py-1.5 text-sm font-semibold text-foreground"><Users className="size-4 text-primary" aria-hidden="true" />{venue.capacity} people</span>
            </div>
          {venue.reference && <p className="text-xs text-muted-foreground">{recordReference(venue, venue.created_at)}</p>}
            <h2 className="break-words text-xl font-semibold tracking-tight sm:text-2xl">{venue.name}</h2>
            <p className="mt-2 flex items-start gap-1.5 text-sm text-muted-foreground"><MapPin className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><span className="break-words">{venue.location}</span></p>
          </div>
          <div className="flex flex-1 flex-col px-5 pb-5 sm:px-6 sm:pb-6">
          <div className={`mt-4 flex items-start gap-2 rounded-lg border p-3 text-sm font-medium ${state === "available" ? "border-primary/20 bg-primary/5 text-primary" : state === "not_checked" ? "border-border bg-muted/30 text-muted-foreground" : "border-destructive/20 bg-destructive/5 text-destructive"}`}>
            <StatusIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{AVAILABILITY_LABELS[state]}</span>
          </div>
          <dl className="mt-5 grid gap-4 text-sm">
            <div><dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Layouts</dt><dd className="mt-1 break-words text-foreground">{venue.supported_layouts.join(" · ")}</dd></div>
            <div><dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Facilities</dt><dd className="mt-1 break-words text-foreground">{venue.facilities.join(" · ") || "None listed"}</dd></div>
            <div><dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Accessibility</dt><dd className="mt-1 break-words text-foreground">{venue.accessibility.join(" · ") || "None listed"}</dd></div>
          </dl>
          {suitability && !suitability.is_suitable && (
            <section aria-label={`Venue suitability advisory for ${venue.name}`} className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
              <p className="flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-400">
                <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
                Suitability advisory
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                {suitability.flags.map((flag) => <li key={flag}>{flag}</li>)}
              </ul>
            </section>
          )}
          <details className="mt-5 border-t border-border pt-4">
            <summary className="cursor-pointer text-sm font-medium text-primary">Opening hours <span className="ml-1 text-xs font-normal text-muted-foreground">(Singapore time)</span></summary>
            <dl className="mt-3 space-y-2 text-xs text-muted-foreground">{VENUE_DAYS.map((day) => <div key={day} className="flex justify-between gap-3"><dt className="capitalize">{day}</dt><dd>{venue.operating_hours[day] ? `${venue.operating_hours[day]!.opens} – ${venue.operating_hours[day]!.closes}` : "Closed"}</dd></div>)}</dl>
          </details>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <p className="text-xs text-muted-foreground">Added {new Date(venue.created_at).toLocaleDateString()}{venue.creator?.display_name ? ` by ${venue.creator.display_name}` : ""}</p>
            {canCreate && !venue.is_retired && <Link href={`/venues/${venue.id}/edit`} className="inline-flex min-h-10 items-center rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted">Edit venue</Link>}
            {(() => {
              const query = new URLSearchParams();
              if (selectedEventId) query.set("eventId", selectedEventId);
              if (filters) {
                const searchDate = new URLSearchParams(filters).get("date");
                if (searchDate) query.set("date", searchDate);
              }
              const qs = query.toString();
              return (
                <Link
                  href={`/venues/${venue.id}${qs ? `?${qs}` : ""}`}
                  className="inline-flex min-h-10 shrink-0 items-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  View availability →
                </Link>
              );
            })()}
          </div>
          </div>
        </li>; })}
      </ul>}
      {(page > 1 || hasMore) && <nav aria-label="Catalogue pages" className="flex items-center justify-center gap-4">
        <Button type="button" variant="outline" size="sm" disabled={page === 1} onClick={() => navigate(page - 1)}>Previous</Button>
        <span className="text-sm text-muted-foreground">Page {page}</span>
        <Button type="button" variant="outline" size="sm" disabled={!hasMore} onClick={() => navigate(page + 1)}>Next</Button>
      </nav>}
    </>}
  </div>;
}

export default function VenuesPage() {
  return <VenueWorkspace title="Venue catalogue" description="Find a space for your event. Compare capacity, facilities and availability before checking suitability and requesting a booking.">{(role) => <Catalogue canCreate={role === "Venue Staff"} />}</VenueWorkspace>;
}
