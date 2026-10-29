"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { StatusBadge, type EventRecord } from "@/lib/events";
import { useActingRole } from "@/lib/use-acting-role";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";

export default function ManagedEventsPage() {
  const [role, , roleLoading] = useActingRole();
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (roleLoading || role !== "Coordinator") return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    let active = true;
    // GET /events already limits records to the session user's assignments.
    // Keep every lifecycle stage reachable after it leaves the Submitted queue.
    apiRequest<{ events: EventRecord[] }>("/events", { signal: controller.signal })
      .then((data) => { if (active) setEvents(data.events); })
      .catch((reason: unknown) => {
        if (active) setError(controller.signal.aborted ? "Loading timed out. Please try again."
          : reason instanceof Error ? reason.message : "Could not load your events.");
      }).finally(() => { window.clearTimeout(timeout); if (active) setLoading(false); });
    return () => { active = false; window.clearTimeout(timeout); controller.abort(); };
  }, [role, roleLoading, attempt]);

  return <AppShell actingRole={role}>
    <div className="mx-auto max-w-6xl space-y-6 px-5 py-8 sm:px-8 sm:py-10">
      <header className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary">Coordinator workspace</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">My events</h1>
        <p className="text-sm text-muted-foreground">Open an assigned event to continue planning, confirm it or close it after delivery.</p>
        <Link href="/events/review" className="inline-flex text-sm text-primary hover:underline">Review submitted requests →</Link>
      </header>
      {roleLoading ? <p role="status">Loading your account...</p> : role !== "Coordinator"
        ? <p role="alert">Only Coordinators can access their assigned events here.</p>
        : <>
          {loading && <p role="status">Loading your events...</p>}
          {error && <div className="space-y-3">
            <p role="alert" className="text-destructive">{error}</p>
            <Button variant="outline" onClick={() => {
              setError(""); setLoading(true); setAttempt((value) => value + 1);
            }}>Try again</Button>
          </div>}
          {!loading && !error && (events.length === 0
            ? <p className="text-muted-foreground">There are no events assigned to you yet.</p>
            : <section aria-label="Assigned events" className="grid gap-4 sm:grid-cols-2">
              {events.map((event) => <Link key={event.id} href={`/events/${event.id}`}
                className="min-w-0 space-y-3 rounded-2xl border border-border bg-card p-5 shadow-sm hover:border-primary">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <h2 className="min-w-0 break-words text-lg font-semibold">{event.title || "Untitled event request"}</h2>
                  <StatusBadge status={event.status} />
                </div>
                <p className="text-sm text-muted-foreground">{event.category ?? "Category not provided"}{event.event_datetime
                  ? ` · ${new Date(event.event_datetime).toLocaleString("en-SG", { timeZone: "Asia/Singapore" })} (Singapore)` : ""}</p>
                <p className="text-sm font-medium text-primary">Open event →</p>
              </Link>)}
            </section>)}
        </>}
    </div>
  </AppShell>;
}
