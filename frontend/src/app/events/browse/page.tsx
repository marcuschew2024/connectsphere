"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { eventTime, type RegistrationOffer } from "@/lib/registrations";
import { useActingRole } from "@/lib/use-acting-role";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";

export default function BrowseEventsPage() {
  const [role, , roleLoading] = useActingRole();
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ offers: RegistrationOffer[]; has_more: boolean } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (roleLoading || role !== "Attendee") return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    let active = true;
    apiRequest<{ offers: RegistrationOffer[]; has_more: boolean }>(
      `/events/registration-offers?page=${page}`, { signal: controller.signal },
    ).then((data) => { if (active) setResult(data); })
      .catch((reason: unknown) => {
        if (active) setError(controller.signal.aborted ? "Loading timed out. Please try again."
          : reason instanceof Error ? reason.message : "Could not load events.");
      }).finally(() => {
        window.clearTimeout(timeout);
        if (active) setLoading(false);
      });
    return () => { active = false; window.clearTimeout(timeout); controller.abort(); };
  }, [role, roleLoading, page, attempt]);

  function load(nextPage: number) {
    setPage(nextPage); setLoading(true); setError(""); setResult(null);
    setAttempt((value) => value + 1);
  }

  return <AppShell actingRole={role}>
    <div className="mx-auto max-w-5xl space-y-6 px-5 py-8 sm:px-8 sm:py-10">
      <header className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary">Attendee workspace</p>
        <h1 className="text-3xl font-semibold tracking-tight">Browse events</h1>
        <p className="text-muted-foreground">Find a confirmed campus event and book your place.</p>
      </header>
      {roleLoading ? <p role="status">Loading your account...</p> : role !== "Attendee"
        ? <p role="alert">Sign in with an Attendee account to register for events. <Link href="/login" className="text-primary underline">Sign in</Link></p>
        : <>
          {loading && <p role="status">Loading events...</p>}
          {error && <div className="space-y-3"><p role="alert" className="text-destructive">{error}</p><Button variant="outline" onClick={() => load(page)}>Try again</Button></div>}
          {!loading && !error && result?.offers.length === 0 && <p className="text-muted-foreground">There are no confirmed events to browse yet.</p>}
          {!loading && !error && <section aria-label="Confirmed events" className="grid gap-4 sm:grid-cols-2">
            {result?.offers.map(({ event, capacity, unavailable_reason }) => <Link
              key={event.id} href={`/events/browse/${event.id}`}
              className="min-w-0 space-y-3 rounded-2xl border border-border bg-card p-5 shadow-sm hover:border-primary"
            >
              <p className="text-xs text-muted-foreground">{event.category}</p>
              <h2 className="break-words text-lg font-semibold">{event.title}</h2>
              <p className="text-sm text-muted-foreground">{eventTime(event.event_datetime)}</p>
              <p className="text-sm">{unavailable_reason ?? `${capacity.remaining} ${capacity.remaining === 1 ? "place" : "places"} remaining`}</p>
              <p className="text-sm font-medium text-primary">View event →</p>
            </Link>)}
          </section>}
          {!error && <nav aria-label="Event pages" className="flex items-center gap-3">
            <Button variant="outline" disabled={loading || page === 1} onClick={() => load(page - 1)}>Previous</Button>
            <span>Page {page}</span>
            <Button variant="outline" disabled={loading || !result?.has_more} onClick={() => load(page + 1)}>Next</Button>
          </nav>}
        </>}
    </div>
  </AppShell>;
}
