"use client";

import { recordReference } from "@/lib/record-reference";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { StatusBadge, type EventRecord } from "@/lib/events";
import { useActingRole } from "@/lib/use-acting-role";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { requestStage } from "@/lib/request-stage";

const CLOSED = new Set(["Completed", "Rejected", "Cancelled"]);

export default function MyRequestsPage() {
  const [role, , roleLoading, signedOut, userId] = useActingRole();
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState("");

  useEffect(() => {
    if (roleLoading || role !== "Organiser") return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    let active = true;
    apiRequest<{ events: EventRecord[] }>("/events", { signal: controller.signal })
      .then(({ events }) => { if (active) setEvents(events); })
      .catch((reason: unknown) => {
        if (active) setError(controller.signal.aborted ? "Loading timed out. Please try again."
          : reason instanceof Error ? reason.message : "Could not load your requests.");
      })
      .finally(() => { window.clearTimeout(timeout); if (active) setLoading(false); });
    return () => { active = false; window.clearTimeout(timeout); controller.abort(); };
  }, [role, roleLoading, attempt]);

  // The API enforces ownership. Keep drafts in their existing editable workspace.
  const submitted = events.filter((event) => event.organiser_id === userId
    && (event.request_status ?? event.status) !== "Draft");
  const filtered = submitted.filter((event) => (!stage || requestStage(event).key === stage)
    && (!search.trim() || [event.title, event.reference, event.category].some((value) => value?.toLowerCase().includes(search.trim().toLowerCase()))));
  const current = filtered.filter((event) => !CLOSED.has(event.request_status ?? event.status));
  const past = filtered.filter((event) => CLOSED.has(event.request_status ?? event.status));

  return <AppShell actingRole={role}>
    <div className="mx-auto max-w-6xl space-y-6 px-5 py-8 sm:px-8 sm:py-10">
      <header className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary">Organiser workspace</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">My requests</h1>
        <p className="text-sm text-muted-foreground">Your submitted requests, most recently updated first. Open a request to view decisions, history or clarification.</p>
      </header>
      {roleLoading ? <p role="status">Loading your account...</p>
        : role !== "Organiser" ? <div className="space-y-3">
          <p role="alert">{signedOut ? "Sign in as an Organiser to view your requests."
            : role ? "Only Organisers can access requests here." : "Could not verify your account. Please sign in again."}</p>
          {!role && <Link href="/login" className="text-primary hover:underline">Go to sign in</Link>}
        </div>
        : <>
          <div className="flex flex-wrap gap-3">
            <Button asChild><Link href="/events/new">Create a request</Link></Button>
            <Button asChild variant="outline"><Link href="/events/drafts">Continue a draft</Link></Button>
          </div>
          {!loading && !error && submitted.length > 0 && <div className="space-y-3 rounded-2xl border border-border bg-card p-4 sm:p-5">
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_240px]">
              <div><label htmlFor="request-search" className="mb-2 block text-sm font-medium">Find a request</label>
                <input id="request-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Event name, EVT reference or category"
                  className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" /></div>
              <div><label htmlFor="request-stage" className="mb-2 block text-sm font-medium">Request stage</label>
                <select id="request-stage" value={stage} onChange={(e) => setStage(e.target.value)} className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm focus-visible:ring-2 focus-visible:ring-ring">
                  <option value="">All stages</option><option value="assignment">Awaiting assignment</option><option value="review">Coordinator review</option><option value="arrangements">Planning arrangements</option><option value="confirmed">Event confirmed</option><option value="preparation">Preparing for the event</option><option value="closed">Closed requests</option>
                </select></div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <p aria-live="polite">Showing {filtered.length} of {submitted.length} requests</p>
              {(search || stage) && <button type="button" onClick={() => { setSearch(""); setStage(""); }} className="font-medium text-primary hover:underline">Clear filters</button>}
            </div>
          </div>}
          {loading && <p role="status">Loading your requests...</p>}
          {error && <div className="space-y-3">
            <p role="alert" className="text-destructive">{error}</p>
            <Button variant="outline" onClick={() => {
              setError(""); setLoading(true); setAttempt((value) => value + 1);
            }}>Try again</Button>
          </div>}
          {!loading && !error && (submitted.length === 0
            ? <section className="rounded-2xl border border-dashed border-border bg-card p-8">
              <h2 className="text-xl font-semibold">No submitted requests yet</h2>
              <p className="mt-2 text-sm text-muted-foreground">Once you submit a request, it will appear here even while it is waiting for a Coordinator. Unsubmitted drafts stay in Drafts.</p>
            </section>
            : filtered.length === 0 ? <section className="rounded-2xl border border-dashed border-border bg-card p-8">
              <h2 className="text-lg font-semibold">No matching requests</h2>
              <p className="mt-2 text-sm text-muted-foreground">Try a different event name or reference, or clear the filters above.</p>
            </section> : <>
              <RequestSection title="Active requests" events={current} empty="You have no active requests." />
              <RequestSection title="Past requests" events={past} empty="You have no past requests yet." />
            </>)}
        </>}
    </div>
  </AppShell>;
}

function RequestSection({ title, events, empty }: {
  title: string; events: EventRecord[]; empty: string;
}) {
  return <section aria-label={title} className="space-y-4">
    <h2 className="text-xl font-semibold">{title} <span className="text-muted-foreground">({events.length})</span></h2>
    {events.length === 0 ? <p className="text-sm text-muted-foreground">{empty}</p>
      : <ul className="grid gap-4 sm:grid-cols-2">
        {events.map((event) => <li key={event.id} className="min-w-0 space-y-3 rounded-2xl border border-border bg-card p-5 shadow-sm transition-colors hover:border-primary/40">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h3 className="min-w-0 break-words text-lg font-semibold">
              <Link href={`/events/${event.id}`} className="text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">{event.title || "Untitled event request"}</Link>
            </h3>
            <StatusBadge status={event.status} />
          </div>
          {event.reference && <p className="text-xs text-muted-foreground">{recordReference(event, event.event_datetime)}</p>}
          <p className="mt-3 text-sm text-muted-foreground">{event.event_datetime
            ? `${new Date(event.event_datetime).toLocaleString("en-SG", { timeZone: "Asia/Singapore" })} (Singapore)`
            : "Event date not provided"}</p>
          {!CLOSED.has(event.request_status ?? event.status) && <p className="mt-3 text-sm">
            {event.coordinator_id === null ? "Waiting for Coordinator assignment" : "Coordinator assigned"}
          </p>}
          <div className="rounded-lg bg-muted/50 px-3 py-2.5">
            <p className="text-xs font-semibold text-foreground">{requestStage(event).label}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{requestStage(event).detail}</p>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{event.category || "Category not provided"}</p>
        </li>)}
      </ul>}
  </section>;
}
