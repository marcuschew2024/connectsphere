"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { StatusBadge, type EventRecord } from "@/lib/events";
import { useActingRole } from "@/lib/use-acting-role";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";

// SCRUM-19: an Organiser tracks the requests they have submitted. The API returns the
// customer-facing lifecycle status (Submitted/Assigned/etc. are projected to "Planning"),
// so this page never exposes internal review sub-states. Drafts have their own page, so
// they are filtered out here.
export default function MyEventRequestsPage() {
  const [role, , roleLoading] = useActingRole();
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (roleLoading || role !== "Organiser") return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    let active = true;
    apiRequest<{ events: EventRecord[] }>("/events", { signal: controller.signal })
      .then((data) => { if (active) setEvents(data.events.filter((event) => event.status !== "Draft")); })
      .catch((reason: unknown) => {
        if (active) setError(controller.signal.aborted ? "Loading timed out. Please try again."
          : reason instanceof Error ? reason.message : "Could not load your event requests.");
      }).finally(() => { window.clearTimeout(timeout); if (active) setLoading(false); });
    return () => { active = false; window.clearTimeout(timeout); controller.abort(); };
  }, [role, roleLoading, attempt]);

  return <AppShell actingRole={role}>
    <div className="mx-auto max-w-6xl space-y-6 px-5 py-8 sm:px-8 sm:py-10">
      <header className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary">Organiser workspace</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">My event requests</h1>
        <p className="text-sm text-muted-foreground">The requests you have submitted, with their current status. Open one to see its details and progress.</p>
        <Link href="/events/new" className="inline-flex text-sm text-primary hover:underline">Create an event request →</Link>
      </header>
      {roleLoading ? <p role="status">Loading your account...</p> : role !== "Organiser"
        ? <p role="alert">Only Organisers can view their submitted requests here.</p>
        : <>
          {loading && <p role="status">Loading your event requests...</p>}
          {error && <div className="space-y-3">
            <p role="alert" className="text-destructive">{error}</p>
            <Button variant="outline" onClick={() => {
              setError(""); setLoading(true); setAttempt((value) => value + 1);
            }}>Try again</Button>
          </div>}
          {!loading && !error && (events.length === 0
            ? <section className="rounded-2xl border border-dashed border-border bg-card px-6 py-16 text-center shadow-sm">
              <h2 className="text-2xl font-medium tracking-tight">No submitted requests yet.</h2>
              <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">Once you submit a request for approval, it will appear here so you can track its status.</p>
              <Link href="/events/new" className="mt-7 inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline">Create your first request <span aria-hidden="true">→</span></Link>
            </section>
            : <ul className="grid gap-4 sm:grid-cols-2">
              {events.map((event) => <li key={event.id}>
                <Link href={`/events/${event.id}`}
                  className="flex min-w-0 flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-sm transition-shadow hover:border-primary hover:shadow-md motion-reduce:transition-none">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <h2 className="min-w-0 break-words text-lg font-semibold">{event.title || "Untitled event request"}</h2>
                    <StatusBadge status={event.status} />
                  </div>
                  <p className="text-sm text-muted-foreground">{event.category ?? "Category not provided"}{event.event_datetime
                    ? ` · ${new Date(event.event_datetime).toLocaleString("en-SG", { timeZone: "Asia/Singapore" })} (Singapore)` : ""}</p>
                  <p className="text-sm font-medium text-primary">Open request →</p>
                </Link>
              </li>)}
            </ul>)}
        </>}
    </div>
  </AppShell>;
}
