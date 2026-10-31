"use client";

import { recordReference } from "@/lib/record-reference";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError, apiRequest } from "@/lib/api";
import { StatusBadge, type CoordinatorEventRecord } from "@/lib/events";
import { useActingRole } from "@/lib/use-acting-role";
import { AppShell } from "@/components/app-shell";

export default function ReviewEventsPage() {
  const [actingRole] = useActingRole();
  const [events, setEvents] = useState<CoordinatorEventRecord[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();

    apiRequest<{ events: CoordinatorEventRecord[] }>("/events", { signal: controller.signal })
      .then((result) => {
        setEvents(result.events.filter((event) => event.status === "Submitted"));
        setLoading(false);
      })
      .catch((requestError) => {
        if (controller.signal.aborted) return;
        setError(
          requestError instanceof ApiError
            ? requestError.message
            : "Could not load event requests.",
        );
        setLoading(false);
      });

    return () => controller.abort();
  }, []);

  // SCRUM-54: the queue shows every submitted request for visibility, but only the ones
  // assigned to this Coordinator can be opened and decided; the rest are view-only.
  const mine = events.filter((event) => event.is_mine);
  const others = events.filter((event) => !event.is_mine);

  return (
    <AppShell actingRole={actingRole}>
      <div className="mx-auto max-w-6xl space-y-6 px-5 py-8 sm:px-8 sm:py-10">
        <header className="space-y-3">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary">Coordinator workspace</p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Review event requests</h1>
          <p className="text-sm text-muted-foreground">Open a request assigned to you to approve, reject or return it for clarification. Requests assigned to another coordinator, or still waiting to be assigned, are shown for visibility only.</p>
          <Link href="/events/managed" className="inline-flex text-sm text-primary hover:underline">View all events →</Link>
          {!loading && !error && <p className="text-sm text-primary">{mine.length} {mine.length === 1 ? "request" : "requests"} awaiting your review</p>}
        </header>

        {error && (
          <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            {error}
          </p>
        )}

        {loading && <p className="text-muted-foreground">Loading event requests...</p>}

        {!loading && !error && (
          <>
            <ReviewSection title="Awaiting your review" events={mine}
              emptyMessage="There are no submitted requests assigned to you." />
            <ReviewSection title="Other submitted requests" events={others}
              emptyMessage="There are no other submitted requests." />
          </>
        )}
      </div>
    </AppShell>
  );
}

function ReviewSection({ title, events, emptyMessage }: {
  title: string; events: CoordinatorEventRecord[]; emptyMessage: string;
}) {
  return (
    <section aria-label={title} className="space-y-4">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      {events.length === 0 ? (
        <p className="text-muted-foreground">{emptyMessage}</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {events.map((event) => <RequestCard key={event.id} event={event} />)}
        </div>
      )}
    </section>
  );
}

function RequestCard({ event }: { event: CoordinatorEventRecord }) {
  const meta = (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="break-words font-semibold">{event.title || "Untitled event request"}</h3>
          {event.reference && <p className="text-xs text-muted-foreground">{recordReference(event, event.event_datetime)}</p>}
          <p className="mt-1 text-sm text-muted-foreground">
            {event.category ?? "Category not provided"}
            {event.event_datetime ? ` · ${new Date(event.event_datetime).toLocaleString()}` : ""}
          </p>
        </div>
        <StatusBadge status={event.status} />
      </div>
    </>
  );

  if (event.is_mine) {
    return (
      <Link
        href={`/events/${event.id}`}
        className="block rounded-2xl border border-border bg-card p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md motion-reduce:transition-none motion-reduce:hover:translate-y-0"
      >
        {meta}
        <p className="mt-4 text-sm text-primary">Open request →</p>
      </Link>
    );
  }

  return (
    <div className="rounded-2xl border border-dashed border-border bg-card p-5 shadow-sm">
      {meta}
      <p className="mt-4 text-sm text-muted-foreground">Assigned to another coordinator, or awaiting assignment — view only.</p>
    </div>
  );
}
