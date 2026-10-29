"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { ApiError, apiRequest } from "@/lib/api";
import {
  assignCoordinator,
  canReassign,
  coordinatorName,
  listCoordinators,
  splitQueue,
  type Coordinator,
} from "@/lib/assignment";
import { StatusBadge, type EventRecord } from "@/lib/events";
import { useActingRole } from "@/lib/use-acting-role";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";

// SCRUM-131 + SCRUM-130: the Event Coordinator Lead's oversight list. GET /events returns
// every non-draft event for the Lead. New requests wait in the unassigned queue until
// the Lead routes them; the Lead can also reassign any active event.
export default function SupervisedEventsPage() {
  const [actingRole] = useActingRole();
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [coordinators, setCoordinators] = useState<Coordinator[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  // Page-level, because a newly assigned event moves out of the queue (and its form).
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    Promise.all([
      apiRequest<{ events: EventRecord[] }>("/events", { signal: controller.signal }),
      listCoordinators(controller.signal),
    ])
      .then(([eventResult, coordinatorResult]) => {
        setEvents(eventResult.events);
        setCoordinators(coordinatorResult.coordinators);
        setLoading(false);
      })
      .catch((requestError) => {
        if (controller.signal.aborted) return;
        setError(
          requestError instanceof ApiError
            ? requestError.message
            : "Could not load supervised events.",
        );
        setLoading(false);
      });

    return () => controller.abort();
  }, []);

  function replaceEvent(updated: EventRecord, message: string) {
    setEvents((current) => current.map((event) => (event.id === updated.id ? updated : event)));
    setNotice(message);
  }

  const { unassigned, assigned } = splitQueue(events);

  return (
    <AppShell actingRole={actingRole}>
      <div className="mx-auto max-w-6xl space-y-8 px-5 py-8 sm:px-8 sm:py-10">
        <header className="space-y-3">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary">Event Coordinator Lead workspace</p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Supervised events</h1>
          <p className="text-sm text-muted-foreground">Assign new requests to a Coordinator and oversee every active event.</p>
          {!loading && !error && (
            <p className="text-sm text-primary">
              {events.length} {events.length === 1 ? "event" : "events"}
              {unassigned.length > 0 ? ` · ${unassigned.length} unassigned` : ""}
            </p>
          )}
        </header>

        <p role="status" className="text-sm font-medium text-primary empty:hidden">{notice}</p>

        {error && (
          <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            {error}
          </p>
        )}

        {loading && <p className="text-muted-foreground">Loading supervised events...</p>}

        {!loading && !error && (
          <section aria-labelledby="unassigned-heading" className="space-y-4">
            <h2 id="unassigned-heading" className="text-xl font-semibold tracking-tight">Unassigned queue</h2>
            {unassigned.length === 0 ? (
              <p className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground shadow-sm">
                No requests are waiting for a Coordinator.
              </p>
            ) : (
              <ul className="grid gap-4 sm:grid-cols-2">
                {unassigned.map((event) => (
                  <EventCard key={event.id} event={event}>
                    <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                      <dt className="text-muted-foreground">Expected attendance</dt>
                      <dd>{event.expected_attendance ?? "Not provided"}</dd>
                      <dt className="text-muted-foreground">Submitted</dt>
                      <dd>{event.submitted_at ? new Date(event.submitted_at).toLocaleString() : "Not recorded"}</dd>
                    </dl>
                    <AssignForm event={event} coordinators={coordinators} onAssigned={replaceEvent} />
                  </EventCard>
                ))}
              </ul>
            )}
          </section>
        )}

        {!loading && !error && (
          <section aria-labelledby="assigned-heading" className="space-y-4">
            <h2 id="assigned-heading" className="text-xl font-semibold tracking-tight">Assigned events</h2>
            {assigned.length === 0 ? (
              <p className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground shadow-sm">
                There are no assigned events to supervise yet.
              </p>
            ) : (
              <ul className="grid gap-4 sm:grid-cols-2">
                {assigned.map((event) => (
                  <EventCard key={event.id} event={event}>
                    <p className="mt-4 text-sm text-muted-foreground">
                      {event.coordinator_id === null
                        ? "Unassigned — no Coordinator yet"
                        : `Assigned to ${coordinatorName(coordinators, event.coordinator_id)}`}
                    </p>
                    {canReassign(event) && (
                      <AssignForm event={event} coordinators={coordinators} onAssigned={replaceEvent} />
                    )}
                  </EventCard>
                ))}
              </ul>
            )}
          </section>
        )}
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
          <p className="mt-1 text-sm text-muted-foreground">
            {event.category ?? "Category not provided"}
            {event.event_datetime ? ` · ${new Date(event.event_datetime).toLocaleString()}` : ""}
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
