"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/api";
import { VENUE_DAYS, type Venue } from "@/lib/venues";
import VenueWorkspace from "./venue-workspace";

function Catalogue({ canCreate }: { canCreate: boolean }) {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const top = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    apiRequest<{ venues: Venue[]; has_more: boolean }>(`/venues?page=${page}`, { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) { setVenues(result.venues); setHasMore(result.has_more); } })
      .catch((error: unknown) => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Could not load the venue catalogue."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [page, attempt]);
  function navigate(next: number) {
    setLoading(true); setError(""); setPage(next); setAttempt(attempt + 1);
    top.current?.scrollIntoView({ block: "start" });
  }
  return <div ref={top} className="scroll-mt-6 space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-slate-400">Shared with Venue Staff and Coordinators</p>
      {canCreate && <Link href="/venues/new" className="rounded-xl bg-sky-300 px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-sky-200">Add a venue <span aria-hidden="true">＋</span></Link>}
    </div>
    {loading && <p role="status" className="p-6 text-sm text-slate-400">Loading venues…</p>}
    {error && <div className="rounded-xl border border-rose-400/30 bg-rose-400/5 p-5">
      <p role="alert" className="text-sm text-rose-200">{error}</p>
      <button type="button" onClick={() => navigate(page)} className="mt-4 rounded-lg border border-white/15 px-4 py-2 text-sm">Try again</button>
    </div>}
    {!loading && !error && <>
      {venues.length === 0 ? <div className="rounded-2xl border border-dashed border-white/15 px-6 py-12 text-center">
        <h2 className="text-lg font-medium">{page === 1 ? "No venues yet" : "No more venues"}</h2>
        <p className="mt-2 text-sm text-slate-400">{canCreate ? "Add your first venue to make it available for event planning." : "Venues will appear here when Venue Staff add them."}</p>
      </div> : <ul className="grid gap-4 lg:grid-cols-2">
        {venues.map((venue) => <li key={venue.id} className="min-w-0 rounded-2xl border border-white/10 bg-slate-900/50 p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0"><h2 className="break-words text-lg font-semibold">{venue.name}</h2><p className="mt-1 break-words text-sm text-slate-400">{venue.location}</p></div>
            <span className="shrink-0 rounded-full border border-sky-300/20 bg-sky-300/5 px-3 py-1 text-xs text-sky-200">{venue.capacity} people</span>
          </div>
          <dl className="mt-5 space-y-3 text-sm">
            <div><dt className="text-xs text-slate-500">Layouts</dt><dd className="mt-1 break-words text-slate-300">{venue.supported_layouts.join(" · ")}</dd></div>
            <div><dt className="text-xs text-slate-500">Facilities</dt><dd className="mt-1 break-words text-slate-300">{venue.facilities.join(" · ") || "None listed"}</dd></div>
            <div><dt className="text-xs text-slate-500">Accessibility</dt><dd className="mt-1 break-words text-slate-300">{venue.accessibility.join(" · ") || "None listed"}</dd></div>
          </dl>
          <details className="mt-5 border-t border-white/10 pt-4">
            <summary className="cursor-pointer text-sm font-medium text-sky-200">Opening hours <span className="ml-1 text-xs font-normal text-slate-400">(Singapore time)</span></summary>
            <dl className="mt-3 space-y-2 text-xs text-slate-400">{VENUE_DAYS.map((day) => <div key={day} className="flex justify-between gap-3"><dt className="capitalize">{day}</dt><dd>{venue.operating_hours[day] ? `${venue.operating_hours[day]!.opens} – ${venue.operating_hours[day]!.closes}` : "Closed"}</dd></div>)}</dl>
          </details>
          <p className="mt-5 text-xs text-slate-500">Added {new Date(venue.created_at).toLocaleDateString()}{venue.creator?.display_name ? ` by ${venue.creator.display_name}` : ""}</p>
        </li>)}
      </ul>}
      {(page > 1 || hasMore) && <nav aria-label="Catalogue pages" className="flex items-center justify-center gap-4">
        <button type="button" disabled={page === 1} onClick={() => navigate(page - 1)} className="rounded-lg border border-white/15 px-4 py-2 text-sm disabled:opacity-30">Previous</button>
        <span className="text-sm text-slate-400">Page {page}</span>
        <button type="button" disabled={!hasMore} onClick={() => navigate(page + 1)} className="rounded-lg border border-white/15 px-4 py-2 text-sm disabled:opacity-30">Next</button>
      </nav>}
    </>}
  </div>;
}

export default function VenuesPage() {
  return <VenueWorkspace title="Venue catalogue" description="Explore registered spaces, their facilities and opening hours.">{(role) => <Catalogue canCreate={role === "Venue Staff"} />}</VenueWorkspace>;
}
