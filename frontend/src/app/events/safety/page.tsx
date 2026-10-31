"use client";

import { recordReference } from "@/lib/record-reference";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { type EventRecord } from "@/lib/events";
import { useActingRole } from "@/lib/use-acting-role";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";

export default function SafetyReviewsPage() {
  const [role, , roleLoading] = useActingRole();
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<{ events: EventRecord[]; has_more: boolean } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (roleLoading || role !== "Safety Officer") return;
    const controller = new AbortController();
    apiRequest<{ events: EventRecord[]; has_more: boolean }>(`/events/safety-review?page=${page}`, {
      signal: controller.signal,
    }).then((data) => {
      if (!controller.signal.aborted) { setResult(data); setLoading(false); }
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) {
        setError(reason instanceof Error ? reason.message : "Could not load safety reviews.");
        setLoading(false);
      }
    });
    return () => controller.abort();
  }, [role, roleLoading, page]);

  function changePage(next: number) {
    setLoading(true); setError(""); setResult(null); setPage(next);
  }

  return <AppShell actingRole={role}>
    <div className="mx-auto max-w-6xl space-y-6 px-5 py-8 sm:px-8 sm:py-10">
      <header className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary">Safety Officer workspace</p>
        <h1 className="text-3xl font-semibold tracking-tight">Operational safety reviews</h1>
        <p className="text-sm text-muted-foreground">Review a confirmed event before it proceeds to preparation.</p>
      </header>
      {roleLoading ? <p>Loading your role...</p> : role !== "Safety Officer"
        ? <p role="alert">Only Safety Officers can access operational safety reviews.</p>
        : <>
          {loading && <p role="status">Loading safety reviews...</p>}
          {error && <p role="alert" className="text-destructive">{error}</p>}
          {!loading && !error && result?.events.length === 0 && <p className="text-muted-foreground">There are no confirmed events awaiting safety review.</p>}
          {!loading && !error && <section aria-label="Events awaiting safety review" className="grid gap-4 sm:grid-cols-2">
            {result?.events.map((event) => <Link key={event.id} href={`/events/${event.id}`} className="rounded-2xl border border-border bg-card p-5 shadow-sm hover:border-primary">
              <h2 className="break-words font-semibold">{event.title}</h2>
          {event.reference && <p className="text-xs text-muted-foreground">{recordReference(event, event.event_datetime)}</p>}
              <p className="mt-2 text-sm text-muted-foreground">{event.event_datetime ? new Date(event.event_datetime).toLocaleString("en-SG", { timeZone: "Asia/Singapore" }) + " (Singapore)" : "Date not provided"}</p>
              <p className="mt-4 text-sm text-primary">Review safety →</p>
            </Link>)}
          </section>}
          <nav aria-label="Review pages" className="flex items-center gap-3">
            <Button variant="outline" disabled={loading || page === 1} onClick={() => changePage(page - 1)}>Previous</Button>
            <span>Page {page}</span>
            <Button variant="outline" disabled={loading || !result?.has_more || !!error} onClick={() => changePage(page + 1)}>Next</Button>
          </nav>
        </>}
    </div>
  </AppShell>;
}
