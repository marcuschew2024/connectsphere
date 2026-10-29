"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { eventTime, registrationStatus, type OwnRegistration } from "@/lib/registrations";
import { useActingRole } from "@/lib/use-acting-role";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";

type RegistrationPage = { registrations: OwnRegistration[]; page: number; has_more: boolean };

export default function MyRegistrationsPage() {
  const [role, , roleLoading] = useActingRole();
  const [query, setQuery] = useState({ page: 1, revision: 0 });
  const [result, setResult] = useState<RegistrationPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback((page?: number) => {
    setResult(null);
    setError("");
    setLoading(true);
    setQuery((current) => ({ page: page ?? current.page, revision: current.revision + 1 }));
  }, []);

  useEffect(() => {
    if (roleLoading || role !== "Attendee") return;
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    apiRequest<RegistrationPage>(`/events/registrations?page=${query.page}`, {
      signal: controller.signal, cache: "no-store",
    }).then((data) => {
      if (active) setResult(data);
    }).catch((reason: unknown) => {
      if (active) setError(controller.signal.aborted ? "Loading timed out. Please try again."
        : reason instanceof Error ? reason.message : "Could not load your registrations.");
    }).finally(() => {
      window.clearTimeout(timeout);
      if (active) setLoading(false);
    });
    return () => { active = false; window.clearTimeout(timeout); controller.abort(); };
  }, [role, roleLoading, query]);

  useEffect(() => {
    if (roleLoading || role !== "Attendee") return;
    const check = () => { if (document.visibilityState === "visible") refresh(); };
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    const interval = window.setInterval(check, 30000);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [role, roleLoading, refresh]);

  return <AppShell actingRole={role}>
    <div className="mx-auto max-w-5xl space-y-6 px-5 py-8 sm:px-8 sm:py-10">
      <header className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary">Attendee workspace</p>
        <h1 className="text-3xl font-semibold tracking-tight">My registrations</h1>
        <p className="text-muted-foreground">Check your current status for each event. Statuses refresh when you return to this page and every 30 seconds while it is visible.</p>
      </header>
      {roleLoading ? <p role="status">Loading your account...</p> : role !== "Attendee"
        ? <p role="alert">Sign in with an Attendee account to view your registrations. <Link href="/login" className="text-primary underline">Sign in</Link></p>
        : <>
          <div className="flex flex-wrap items-center gap-4">
            <Button variant="outline" disabled={loading} onClick={() => refresh()}>Refresh registrations</Button>
            <Link href="/events/browse" className="text-sm text-primary hover:underline">Browse events</Link>
          </div>
          <div aria-live="polite" aria-atomic="true">
            {loading && <p role="status" className="text-muted-foreground">Loading registrations...</p>}
            {!loading && !error && result && <p className="text-sm text-muted-foreground">Statuses are up to date.</p>}
          </div>
          {error && <div className="space-y-3">
            <p role="alert" className="text-destructive">{error}</p>
            <Button variant="outline" onClick={() => refresh()}>Try again</Button>
          </div>}
          {!loading && !error && result && <>
            {result.registrations.length === 0 ? <div className="space-y-2 rounded-2xl border border-border bg-card p-6">
              <h2 className="font-semibold">{query.page === 1 ? "No registrations yet" : "No registrations on this page"}</h2>
              <p className="text-sm text-muted-foreground">{query.page === 1
                ? "Your event registrations will appear here after you register."
                : "Your registrations may have changed. Use Previous to return to an earlier page."}</p>
            </div> : <ul aria-label="Your registrations" className="grid gap-4 sm:grid-cols-2">
              {result.registrations.map((registration) => <li key={registration.id} className="min-w-0 space-y-4 rounded-2xl border border-border bg-card p-5 shadow-sm">
                <div className="space-y-2">
                  {registration.event?.category && <p className="text-xs text-muted-foreground">{registration.event.category}</p>}
                  <h2 className="break-words text-lg font-semibold">{registration.event?.title || "Event unavailable"}</h2>
                  {registration.event && <p className="text-sm text-muted-foreground">{eventTime(registration.event.event_datetime)}</p>}
                </div>
                <dl className="space-y-3 text-sm">
                  <div><dt className="text-muted-foreground">Your registration status</dt>
                    <dd className="mt-1 inline-flex rounded-full bg-primary/10 px-3 py-1 font-medium text-primary">{registrationStatus(registration.status).label}</dd></div>
                  {registration.event && <div><dt className="text-muted-foreground">Event status</dt><dd>{registration.event.status}</dd></div>}
                  <div><dt className="text-muted-foreground">Registered at</dt><dd>{eventTime(registration.registered_at)}</dd></div>
                  {registration.status === "Withdrawn" && registration.withdrawn_at && <div><dt className="text-muted-foreground">Withdrawn at</dt><dd>{eventTime(registration.withdrawn_at)}</dd></div>}
                  <div><dt className="text-muted-foreground">Registration reference</dt><dd className="break-all font-mono">{registration.id}</dd></div>
                </dl>
                <p className="text-sm text-muted-foreground">{registrationStatus(registration.status).description}</p>
                {registration.event && <Link href={`/events/browse/${registration.event_id}`} className="inline-flex text-sm text-primary hover:underline">View event →</Link>}
              </li>)}
            </ul>}
            <nav aria-label="Registration pages" className="flex items-center gap-3">
              <Button variant="outline" disabled={query.page === 1} onClick={() => refresh(query.page - 1)}>Previous</Button>
              <span>Page {query.page}</span>
              <Button variant="outline" disabled={!result.has_more} onClick={() => refresh(query.page + 1)}>Next</Button>
            </nav>
          </>}
        </>}
    </div>
  </AppShell>;
}
