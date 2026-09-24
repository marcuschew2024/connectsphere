"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import type { EventRecord } from "@/lib/events";
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
    <section className="rounded-3xl border border-red-300/20 bg-red-300/5 p-7">
      <p role="alert" className="text-sm text-red-200">{error}</p>
      <button type="button" onClick={() => { setError(""); setLoading(true); setAttempt(attempt + 1); }} className="mt-4 rounded-full border border-white/20 px-4 py-2 text-sm">Try again</button>
    </section>
  );

  if (loading) return <p role="status" className="rounded-3xl border border-white/10 p-8 text-sm text-slate-400">Loading your drafts…</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-slate-400">{drafts.length} {drafts.length === 1 ? "draft" : "drafts"}<span className="mx-2 text-slate-600">·</span>Only visible to you</p>
        <Link href="/events/new" className="inline-flex items-center gap-2 rounded-full bg-sky-300 px-5 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-sky-200 motion-reduce:transition-none"><span aria-hidden="true">＋</span> New request</Link>
      </div>

      {drafts.length === 0 ? (
        <section className="rounded-3xl border border-dashed border-white/15 bg-white/[0.02] px-6 py-16 text-center sm:py-20">
          <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl border border-sky-300/15 bg-sky-300/5 text-sky-200">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="3" /><path d="M9 8h6M9 12h6M9 16h3" strokeLinecap="round" /></svg>
          </div>
          <h2 className="text-2xl font-medium tracking-tight">Every event starts with an idea.</h2>
          <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-slate-400">Start a request and save it as a draft. You can leave the details for later.</p>
          <Link href="/events/new" className="mt-7 inline-flex items-center gap-2 text-sm font-medium text-sky-200 hover:text-sky-100">Create your first request <span aria-hidden="true">→</span></Link>
        </section>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {drafts.map((draft) => (
            <li key={draft.id} className="group flex flex-col rounded-3xl border border-white/10 bg-white/[0.025] p-6 transition-colors hover:border-white/20 hover:bg-white/[0.04] motion-reduce:transition-none sm:p-7">
              <span className="mb-5 w-fit rounded-full border border-slate-500/30 px-3 py-1 text-xs text-slate-300">Draft</span>
              <h2 className="break-words text-xl font-medium tracking-tight">{draft.title || "Untitled request"}</h2>
              <p className="mt-3 line-clamp-2 break-words text-sm leading-relaxed text-slate-400">{draft.description || "An idea in progress. Pick up where you left off."}</p>
              <div className="mt-auto pt-8">
                <p className="text-xs text-slate-500">Saved {new Date(draft.updated_at).toLocaleString([], { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
                <Link href={`/events/drafts/${draft.id}`} aria-label={`Continue editing ${draft.title || "Untitled request"}`} className="mt-4 flex items-center justify-between rounded-xl border border-white/10 px-4 py-3 text-sm font-medium text-sky-200 transition-colors hover:bg-sky-300/5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sky-300 motion-reduce:transition-none">Continue editing <span aria-hidden="true">→</span></Link>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="text-center text-xs leading-relaxed text-slate-500">Your drafts stay private until you submit them for planning.</p>
    </div>
  );
}

export default function DraftsPage() {
  return <DraftWorkspace title="Room for your next idea." description="Your unfinished requests, all in one place. Pick one up whenever you’re ready."><DraftList /></DraftWorkspace>;
}
