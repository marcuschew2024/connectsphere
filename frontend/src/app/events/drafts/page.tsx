"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import type { EventRecord } from "@/lib/events";
import { Button } from "@/components/ui/button";
import DraftWorkspace from "./draft-workspace";

function DraftList() {
  const [drafts, setDrafts] = useState<EventRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    apiRequest<{ events: EventRecord[] }>("/events?status=Draft", { signal: controller.signal })
      .then(({ events }) => { if (!controller.signal.aborted) setDrafts(events); })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Could not load your drafts.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [attempt]);

  if (error) return (
    <section className="rounded-2xl border border-destructive/30 bg-destructive/5 p-7">
      <p role="alert" className="text-sm text-destructive">{error}</p>
      <Button type="button" variant="outline" size="sm" onClick={() => { setError(""); setLoading(true); setAttempt(attempt + 1); }} className="mt-4">Try again</Button>
    </section>
  );

  if (loading) return <p role="status" className="rounded-2xl border border-border p-8 text-sm text-muted-foreground">Loading your drafts…</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">{drafts.length} {drafts.length === 1 ? "draft" : "drafts"}<span className="mx-2 text-border">·</span>Only visible to you</p>
        <Button asChild><Link href="/events/new"><span aria-hidden="true">＋</span> New request</Link></Button>
      </div>

      {drafts.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-border bg-card px-6 py-16 text-center shadow-sm sm:py-20">
          <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="3" /><path d="M9 8h6M9 12h6M9 16h3" strokeLinecap="round" /></svg>
          </div>
          <h2 className="text-2xl font-medium tracking-tight">Every event starts with an idea.</h2>
          <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">Start a request and save it as a draft. You can leave the details for later.</p>
          <Link href="/events/new" className="mt-7 inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline">Create your first request <span aria-hidden="true">→</span></Link>
        </section>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {drafts.map((draft) => (
            <li key={draft.id} className="group flex flex-col rounded-2xl border border-border bg-card p-6 shadow-sm transition-shadow hover:shadow-md motion-reduce:transition-none sm:p-7">
              <span className="mb-5 w-fit rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">Draft</span>
              <h2 className="break-words text-xl font-medium tracking-tight">{draft.title || "Untitled request"}</h2>
              <p className="mt-3 line-clamp-2 break-words text-sm leading-relaxed text-muted-foreground">{draft.description || "An idea in progress. Pick up where you left off."}</p>
              <div className="mt-auto pt-8">
                <p className="text-xs text-muted-foreground">Saved {new Date(draft.updated_at).toLocaleString([], { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
                <Link href={`/events/drafts/${draft.id}`} aria-label={`Continue editing ${draft.title || "Untitled request"}`} className="mt-4 flex items-center justify-between rounded-xl border border-border px-4 py-3 text-sm font-medium text-primary transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring motion-reduce:transition-none">Continue editing <span aria-hidden="true">→</span></Link>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="text-center text-xs leading-relaxed text-muted-foreground">Your drafts stay private until you submit them for planning.</p>
    </div>
  );
}

export default function DraftsPage() {
  return <DraftWorkspace title="Room for your next idea." description="Your unfinished requests, all in one place. Pick one up whenever you’re ready."><DraftList /></DraftWorkspace>;
}
