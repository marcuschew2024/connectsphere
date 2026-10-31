"use client";

import { recordReference } from "@/lib/record-reference";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { StatusBadge, type CoordinatorEventRecord } from "@/lib/events";
import { useActingRole } from "@/lib/use-acting-role";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";

export default function ManagedEventsPage() {
  const [role, , roleLoading] = useActingRole();
  const [events, setEvents] = useState<CoordinatorEventRecord[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (roleLoading || role !== "Coordinator") return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    let active = true;
    // SCRUM-54: GET /events returns every non-draft event for a Coordinator, with their own
    // assigned/organised events flagged is_mine and surfaced first.
    apiRequest<{ events: CoordinatorEventRecord[] }>("/events", { signal: controller.signal })
      .then((data) => { if (active) setEvents(data.events); })
      .catch((reason: unknown) => {
        if (active) setError(controller.signal.aborted ? "Loading timed out. Please try again."
          : reason instanceof Error ? reason.message : "Could not load events.");
      }).finally(() => { window.clearTimeout(timeout); if (active) setLoading(false); });
    return () => { active = false; window.clearTimeout(timeout); controller.abort(); };
  }, [role, roleLoading, attempt]);

  const mine = events.filter((event) => event.is_mine);
  const others = events.filter((event) => !event.is_mine);

  return <AppShell actingRole={role}>
    <div className="mx-auto max-w-6xl space-y-6 px-5 py-8 sm:px-8 sm:py-10">
      <header className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary">Coordinator workspace</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">All events</h1>
        <p className="text-sm text-muted-foreground">Your assigned events come first. You can see every other event for full visibility, but only the ones assigned to you can be opened and actioned.</p>
        <Link href="/events/review" className="inline-flex text-sm text-primary hover:underline">Review submitted requests →</Link>
      </header>
      {roleLoading ? <p role="status">Loading your account...</p> : role !== "Coordinator"
        ? <p role="alert">Only Coordinators can access events here.</p>
        : <>
          {loading && <p role="status">Loading events...</p>}
          {error && <div className="space-y-3">
            <p role="alert" className="text-destructive">{error}</p>
            <Button variant="outline" onClick={() => {
              setError(""); setLoading(true); setAttempt((value) => value + 1);
            }}>Try again</Button>
          </div>}
          {!loading && !error && <>
            <EventSection title="Your assigned events" events={mine}
              emptyMessage="There are no events assigned to you yet." />
            <EventSection title="All other events" events={others}
              emptyMessage="There are no other events to show." />
          </>}
        </>}
    </div>
  </AppShell>;
}

// Own events link through to their detail page; other Coordinators' events are view-only
// (their detail is record-level protected), so they render as non-interactive cards.
function EventSection({ title, events, emptyMessage }: {
  title: string; events: CoordinatorEventRecord[]; emptyMessage: string;
}) {
  return <section aria-label={title} className="space-y-4">
    <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
    {events.length === 0
      ? <p className="text-muted-foreground">{emptyMessage}</p>
      : <div className="grid gap-4 sm:grid-cols-2">
        {events.map((event) => <EventCard key={event.id} event={event} />)}
      </div>}
  </section>;
}

function EventCard({ event }: { event: CoordinatorEventRecord }) {
  const meta = <>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <h3 className="min-w-0 break-words text-lg font-semibold">{event.title || "Untitled event request"}</h3>
      <StatusBadge status={event.status} />
    </div>
          {event.reference && <p className="text-xs text-muted-foreground">{recordReference(event, event.event_datetime)}</p>}
    <p className="text-sm text-muted-foreground">{event.category ?? "Category not provided"}{event.event_datetime
      ? ` · ${new Date(event.event_datetime).toLocaleString("en-SG", { timeZone: "Asia/Singapore" })} (Singapore)` : ""}</p>
  </>;

  if (event.is_mine) {
    return <Link href={`/events/${event.id}`}
      className="min-w-0 space-y-3 rounded-2xl border border-border bg-card p-5 shadow-sm hover:border-primary">
      {meta}
      <p className="text-sm font-medium text-primary">Open event →</p>
    </Link>;
  }

  return <div
    className="min-w-0 space-y-3 rounded-2xl border border-dashed border-border bg-card p-5 shadow-sm">
    {meta}
    <p className="text-sm text-muted-foreground">Assigned to another coordinator — view only.</p>
  </div>;
}
