"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/api";
import { VENUE_DAYS, type Venue } from "@/lib/venues";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
      <p className="text-sm text-muted-foreground">Shared with Venue Staff and Coordinators</p>
      {canCreate && <Button asChild><Link href="/venues/new">Add a venue <span aria-hidden="true">＋</span></Link></Button>}
    </div>
    {loading && <p role="status" className="p-6 text-sm text-muted-foreground">Loading venues…</p>}
    {error && <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5">
      <p role="alert" className="text-sm text-destructive">{error}</p>
      <Button type="button" variant="outline" size="sm" onClick={() => navigate(page)} className="mt-4">Try again</Button>
    </div>}
    {!loading && !error && <>
      {venues.length === 0 ? <div className="rounded-2xl border border-dashed border-border px-6 py-12 text-center">
        <h2 className="text-lg font-medium">{page === 1 ? "No venues yet" : "No more venues"}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{canCreate ? "Add your first venue to make it available for event planning." : "Venues will appear here when Venue Staff add them."}</p>
      </div> : <ul className="grid gap-4 lg:grid-cols-2">
        {venues.map((venue) => <li key={venue.id} className="min-w-0 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0"><h2 className="break-words text-lg font-semibold">{venue.name}</h2><p className="mt-1 break-words text-sm text-muted-foreground">{venue.location}</p></div>
            <Badge variant="secondary" className="shrink-0">{venue.capacity} people</Badge>
          </div>
          <dl className="mt-5 space-y-3 text-sm">
            <div><dt className="text-xs text-muted-foreground">Layouts</dt><dd className="mt-1 break-words text-foreground">{venue.supported_layouts.join(" · ")}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Facilities</dt><dd className="mt-1 break-words text-foreground">{venue.facilities.join(" · ") || "None listed"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Accessibility</dt><dd className="mt-1 break-words text-foreground">{venue.accessibility.join(" · ") || "None listed"}</dd></div>
          </dl>
          <details className="mt-5 border-t border-border pt-4">
            <summary className="cursor-pointer text-sm font-medium text-primary">Opening hours <span className="ml-1 text-xs font-normal text-muted-foreground">(Singapore time)</span></summary>
            <dl className="mt-3 space-y-2 text-xs text-muted-foreground">{VENUE_DAYS.map((day) => <div key={day} className="flex justify-between gap-3"><dt className="capitalize">{day}</dt><dd>{venue.operating_hours[day] ? `${venue.operating_hours[day]!.opens} – ${venue.operating_hours[day]!.closes}` : "Closed"}</dd></div>)}</dl>
          </details>
          <div className="mt-5 flex items-center justify-between gap-3 border-t border-border pt-4">
            <p className="text-xs text-muted-foreground">Added {new Date(venue.created_at).toLocaleDateString()}{venue.creator?.display_name ? ` by ${venue.creator.display_name}` : ""}</p>
            <Link href={`/venues/${venue.id}`} className="shrink-0 text-sm font-medium text-primary hover:underline">View availability →</Link>
          </div>
        </li>)}
      </ul>}
      {(page > 1 || hasMore) && <nav aria-label="Catalogue pages" className="flex items-center justify-center gap-4">
        <Button type="button" variant="outline" size="sm" disabled={page === 1} onClick={() => navigate(page - 1)}>Previous</Button>
        <span className="text-sm text-muted-foreground">Page {page}</span>
        <Button type="button" variant="outline" size="sm" disabled={!hasMore} onClick={() => navigate(page + 1)}>Next</Button>
      </nav>}
    </>}
  </div>;
}

export default function VenuesPage() {
  return <VenueWorkspace title="Venue catalogue" description="Explore registered spaces, their facilities and opening hours.">{(role) => <Catalogue canCreate={role === "Venue Staff"} />}</VenueWorkspace>;
}
