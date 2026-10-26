"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError, apiRequest } from "@/lib/api";
import { StatusBadge, type EventRecord } from "@/lib/events";
import { useActingRole } from "@/lib/use-acting-role";
import { AppShell } from "@/components/app-shell";

// SCRUM-131: the Event Coordinator Lead's oversight list. GET /events returns every
// non-draft event for the Lead (the backend widens the scope by role). Assigning and
// reassigning a Coordinator is SCRUM-130; this screen is read-only for now.
export default function SupervisedEventsPage() {
  const [actingRole] = useActingRole();
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();

    apiRequest<{ events: EventRecord[] }>("/events", { signal: controller.signal })
      .then((result) => {
        setEvents(result.events);
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

  const unassigned = events.filter((event) => event.coordinator_id === null).length;

  return (
    <AppShell actingRole={actingRole}>
      <div className="mx-auto max-w-6xl space-y-6 px-5 py-8 sm:px-8 sm:py-10">
        <header className="space-y-3">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary">Event Coordinator Lead workspace</p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Supervised events</h1>
          <p className="text-sm text-muted-foreground">Every submitted and active event across all Coordinators. Open one to review its details.</p>
          {!loading && !error && (
            <p className="text-sm text-primary">
              {events.length} {events.length === 1 ? "event" : "events"}
              {unassigned > 0 ? ` · ${unassigned} unassigned` : ""}
            </p>
          )}
        </header>

        {error && (
          <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            {error}
          </p>
        )}

        {loading && <p className="text-muted-foreground">Loading supervised events...</p>}

        {!loading && !error && events.length === 0 && (
          <section className="rounded-2xl border border-border bg-card p-6 text-muted-foreground shadow-sm sm:p-8">
            There are no submitted or active events to supervise yet.
          </section>
        )}

        {!loading && events.length > 0 && (
          <section className="grid gap-4 sm:grid-cols-2">
            {events.map((event) => (
              <Link
                key={event.id}
                href={`/events/${event.id}`}
                className="block rounded-2xl border border-border bg-card p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md motion-reduce:transition-none motion-reduce:hover:translate-y-0"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h2 className="break-words font-semibold">{event.title || "Untitled event request"}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {event.category ?? "Category not provided"}
                      {event.event_datetime
                        ? ` · ${new Date(event.event_datetime).toLocaleString()}`
                        : ""}
                    </p>
                  </div>
                  <StatusBadge status={event.status} />
                </div>
                <p className="mt-4 text-sm text-muted-foreground">
                  {event.coordinator_id === null
                    ? "Unassigned — no Coordinator yet"
                    : `Assigned to Coordinator #${event.coordinator_id}`}
                </p>
              </Link>
            ))}
          </section>
        )}
      </div>
    </AppShell>
  );
}
