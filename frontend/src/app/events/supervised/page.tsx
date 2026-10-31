"use client";

import { recordReference } from "@/lib/record-reference";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { ApiError, apiRequest } from "@/lib/api";
import {
  assignCoordinator,
  canReassign,
  coordinatorName,
  listCoordinators,
  type Coordinator,
} from "@/lib/assignment";
import { StatusBadge, type EventRecord } from "@/lib/events";
import { useActingRole } from "@/lib/use-acting-role";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { filterSupervisedEvents, groupSupervisedEvents, OVERVIEW_PAGE_SIZE } from "@/lib/supervised-events";

// SCRUM-131 + SCRUM-130: the Event Coordinator Lead's oversight list. GET /events returns
// every non-draft event for the Lead. New requests wait in the unassigned queue until
// the Lead routes them; the Lead can also reassign any active event.
export default function SupervisedEventsPage() {
  const [actingRole, , roleLoading] = useActingRole();
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [coordinators, setCoordinators] = useState<Coordinator[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  // Page-level, because a newly assigned event moves out of the queue (and its form).
  const [notice, setNotice] = useState("");
  const [updatedId, setUpdatedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [coordinator, setCoordinator] = useState("all");
  const [status, setStatus] = useState("all");
  const [attempt, setAttempt] = useState(0);
  const [pages, setPages] = useState({ unassigned: 1, assigned: 1, past: 1 });

  useEffect(() => {
    if (roleLoading || actingRole !== "Event Coordinator Lead") return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    let active = true;

    Promise.all([
      apiRequest<{ events: EventRecord[] }>("/events", { signal: controller.signal }),
      listCoordinators(controller.signal),
    ])
      .then(([eventResult, coordinatorResult]) => {
        if (!active) return;
        setEvents(eventResult.events);
        setCoordinators(coordinatorResult.coordinators);
        setLoading(false);
      })
      .catch((requestError) => {
        if (!active) return;
        setError(
          controller.signal.aborted ? "Loading timed out. Please try again." : requestError instanceof ApiError
            ? requestError.message
            : "Could not load supervised events.",
        );
        setLoading(false);
      }).finally(() => window.clearTimeout(timeout));

    return () => { active = false; window.clearTimeout(timeout); controller.abort(); };
  }, [actingRole, roleLoading, attempt]);

  function replaceEvent(updated: EventRecord, message: string) {
    setEvents((current) => current.map((event) => (event.id === updated.id ? updated : event)));
    setNotice(message);
    setUpdatedId(updated.id);
    setPages({ unassigned: 1, assigned: 1, past: 1 });
  }

  const groups = groupSupervisedEvents(events);
  const filtered = Object.fromEntries(Object.entries(groups).map(([key, rows]) => [
    key, filterSupervisedEvents(rows, search, coordinator, status),
  ])) as typeof groups;
  const hasFilters = !!search.trim() || coordinator !== "all" || status !== "all";
  const statuses = [...new Set(Object.values(groups).flat().map(event => event.status))].sort();
  const total = Object.values(groups).reduce((sum, rows) => sum + rows.length, 0);
  const matching = Object.values(filtered).reduce((sum, rows) => sum + rows.length, 0);

  function resetPages() { setPages({ unassigned: 1, assigned: 1, past: 1 }); }
  function clearFilters() { setSearch(""); setCoordinator("all"); setStatus("all"); resetPages(); }
  function refresh() { setError(""); setLoading(true); setAttempt(value => value + 1); }

  return (
    <AppShell actingRole={actingRole}>
      <div className="mx-auto max-w-6xl space-y-8 px-5 py-8 sm:px-8 sm:py-10">
        <header className="space-y-3">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary">Event Coordinator Lead workspace</p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Supervised events</h1>
          <p className="text-sm text-muted-foreground">Assign new requests, track who is handling each event and review past events.</p>
          {!loading && !error && actingRole === "Event Coordinator Lead" && <p className="text-sm text-primary">
            {total} {total === 1 ? "event" : "events"}{groups.unassigned.length > 0 ? ` · ${groups.unassigned.length} unassigned` : ""}
          </p>}
        </header>

        {roleLoading ? <p role="status">Loading your account...</p> : actingRole !== "Event Coordinator Lead"
          ? <p role="alert">Only the Event Coordinator Lead can access this overview.</p>
          : <>
            <div className="flex flex-wrap items-center gap-3">
              <p role="status" className="text-sm font-medium text-primary empty:hidden">{notice}</p>
              {notice && updatedId && <Link href={`/events/${updatedId}`} className="text-sm text-primary underline">Open updated event</Link>}
              <Button variant="outline" disabled={loading} onClick={refresh}>Refresh events</Button>
            </div>
            {error && <div className="space-y-3">
              <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</p>
              <Button variant="outline" onClick={refresh}>Try again</Button>
            </div>}
            {loading && <p role="status" className="text-muted-foreground">Loading supervised events...</p>}
            {!loading && !error && <>
              <nav aria-label="Event overview" className="grid gap-3 sm:grid-cols-3">
                {([['unassigned', 'Needs assignment'], ['assigned', 'Assigned and active'], ['past', 'Past events']] as const).map(([key, label]) =>
                  <a key={key} href={`#${key}-heading`} className="rounded-xl border border-border bg-card p-4 hover:border-primary focus-visible:outline-2 focus-visible:outline-ring">
                    <span className="block text-sm text-muted-foreground">{label}</span>
                    <span className="mt-1 block text-2xl font-semibold">{groups[key].length}</span>
                  </a>)}
              </nav>
              <section aria-label="Find events" className="space-y-4 rounded-2xl border border-border bg-card p-5">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <label className="space-y-2 text-sm font-medium">Search events
                    <input type="search" value={search} placeholder="Event name or EVT-001" onChange={event => { setSearch(event.target.value); resetPages(); }} className="block w-full rounded-md border border-input bg-background px-3 py-2" />
                  </label>
                  <label className="space-y-2 text-sm font-medium">Coordinator filter
                    <select value={coordinator} onChange={event => { setCoordinator(event.target.value); resetPages(); }} className="block w-full rounded-md border border-input bg-background px-3 py-2">
                      <option value="all">All Coordinators</option><option value="unassigned">Not assigned yet</option>
                      {coordinators.map(person => <option key={person.id} value={String(person.id)}>{person.display_name}</option>)}
                    </select>
                  </label>
                  <label className="space-y-2 text-sm font-medium">Status filter
                    <select value={status} onChange={event => { setStatus(event.target.value); resetPages(); }} className="block w-full rounded-md border border-input bg-background px-3 py-2">
                      <option value="all">All statuses</option>
                      {statuses.map(value => <option key={value} value={value}>{value}</option>)}
                    </select>
                  </label>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p role="status" className="text-sm text-muted-foreground">{matching} of {total} events match</p>
                  {hasFilters && <Button variant="outline" onClick={clearFilters}>Clear filters</Button>}
                </div>
              </section>
              {([['unassigned', 'Unassigned queue', 'No requests are waiting for a Coordinator.'],
                ['assigned', 'Assigned events', 'There are no assigned events to supervise yet.'],
                ['past', 'Past events', 'There are no past events yet.']] as const).map(([key, title, empty]) => {
                const rows = filtered[key];
                const pageCount = Math.max(1, Math.ceil(rows.length / OVERVIEW_PAGE_SIZE));
                const page = Math.min(pages[key], pageCount);
                const shown = rows.slice((page - 1) * OVERVIEW_PAGE_SIZE, page * OVERVIEW_PAGE_SIZE);
                return <section key={key} aria-labelledby={`${key}-heading`} className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 id={`${key}-heading`} className="scroll-mt-6 text-xl font-semibold tracking-tight">{title}</h2>
                    <span className="text-sm text-muted-foreground">{rows.length} {rows.length === 1 ? "event" : "events"}</span>
                  </div>
                  <p className="text-sm text-muted-foreground">{key === 'unassigned' ? 'Oldest submissions first.' : key === 'assigned' ? 'Most recently assigned first. Open an event for its progress and history.' : 'Completed, rejected and cancelled events remain available here.'}</p>
                  {rows.length === 0 ? <p className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
                    {hasFilters && groups[key].length > 0 ? "No events in this section match your filters." : empty}
                  </p> : <ul className="grid gap-4 sm:grid-cols-2">
                    {shown.map(event => <EventCard key={event.id} event={event}>
                      {key === 'unassigned' ? <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                        <dt className="text-muted-foreground">Expected attendance</dt><dd>{event.expected_attendance ?? "Not provided"}</dd>
                        <dt className="text-muted-foreground">Submitted</dt><dd>{event.submitted_at ? singaporeDate(event.submitted_at) : "Not recorded"}</dd>
                      </dl> : <div className="mt-4 space-y-1 text-sm">
                        <p>{event.coordinator_id === null ? "No Coordinator was assigned" : `Assigned to ${coordinatorName(coordinators, event.coordinator_id)}`}</p>
                        {event.coordinator_assigned_at && <p className="text-xs text-muted-foreground">Assigned {singaporeDate(event.coordinator_assigned_at)}</p>}
                      </div>}
                      {key !== 'past' && canReassign(event) && <AssignForm event={event} coordinators={coordinators} onAssigned={replaceEvent} />}
                    </EventCard>)}
                  </ul>}
                  {pageCount > 1 && <nav aria-label={`${title} pages`} className="flex items-center gap-3">
                    <Button variant="outline" disabled={page === 1} onClick={() => setPages(current => ({ ...current, [key]: page - 1 }))}>Previous</Button>
                    <span className="text-sm">Page {page} of {pageCount}</span>
                    <Button variant="outline" disabled={page === pageCount} onClick={() => setPages(current => ({ ...current, [key]: page + 1 }))}>Next</Button>
                  </nav>}
                </section>;
              })}
            </>}
          </>}
      </div>
    </AppShell>
  );
}

function EventCard({ event, children }: { event: EventRecord; children: React.ReactNode }) {
  return (
    <li className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="break-words font-semibold">
            <Link href={`/events/${event.id}`} className="hover:text-primary hover:underline">
              {event.title || "Untitled event request"}
            </Link>
          </h3>
          {event.reference && <p className="text-xs text-muted-foreground">{recordReference(event, event.event_datetime)}</p>}
          <p className="mt-1 text-sm text-muted-foreground">
            {event.category ?? "Category not provided"}
            {event.event_datetime ? ` · ${(event.reference ? new Date(event.event_datetime).toLocaleTimeString("en-GB", { timeZone: "Asia/Singapore", hour: "2-digit", minute: "2-digit", hour12: false }) : singaporeDate(event.event_datetime)) + " (Singapore)"}` : ""}
          </p>
        </div>
        <StatusBadge status={event.status} />
      </div>
      {children}
    </li>
  );
}

function AssignForm({ event, coordinators, onAssigned }: {
  event: EventRecord;
  coordinators: Coordinator[];
  onAssigned: (event: EventRecord, message: string) => void;
}) {
  const reassigning = event.coordinator_id !== null;
  const choices = coordinators.filter((coordinator) => coordinator.id !== event.coordinator_id);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const title = event.title || "Untitled event request";
  const selectId = `coordinator-${event.id}`;

  async function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (!selected || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await assignCoordinator(event.id, Number(selected));
      setSelected("");
      const verb = result.outcome === "reassigned" ? "Reassigned" : "Assigned";
      onAssigned(result.event,
        `${verb} ${title} to ${coordinatorName(coordinators, result.event.coordinator_id)}.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not assign the Coordinator.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-2 border-t border-border pt-4">
      <label htmlFor={selectId} className="block text-sm font-medium">
        {reassigning ? `Reassign ${title} to` : `Assign ${title} to`}
      </label>
      <div className="flex gap-2">
        <select
          id={selectId}
          value={selected}
          disabled={busy || choices.length === 0}
          onChange={(changeEvent) => setSelected(changeEvent.target.value)}
          className="w-full min-w-0 rounded-lg border border-input bg-background p-2 text-sm text-foreground shadow-xs focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30 disabled:opacity-50"
        >
          <option value="">{choices.length === 0 ? "No other Coordinator available" : "Choose a Coordinator"}</option>
          {choices.map((coordinator) => (
            <option key={coordinator.id} value={coordinator.id}>{coordinator.display_name}</option>
          ))}
        </select>
        <Button type="submit" disabled={!selected || busy} aria-label={`${reassigning ? "Reassign" : "Assign"} ${title}`}>
          {busy ? "Saving…" : reassigning ? "Reassign" : "Assign"}
        </Button>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </form>
  );
}

function singaporeDate(value: string) {
  return new Date(value).toLocaleString("en-GB", { timeZone: "Asia/Singapore",
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}
