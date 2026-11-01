"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import type { Venue } from "@/lib/venues";
import VenueWorkspace from "../../venue-workspace";
import VenueForm from "../../new/venue-form";

function EditVenue({ venueId }: { venueId: string }) {
  const [venue, setVenue] = useState<Venue | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let active = true;
    apiRequest<{ venue: Venue }>(`/venues/${venueId}`, { signal: controller.signal })
      .then(({ venue }) => {
        if (!active) return;
        if (!venue.revision) throw new Error("Venue editing is not set up yet. Ask the team to apply the update_venues database migration.");
        // SCRUM-26: a retired venue's details are kept as they were.
        if (venue.is_retired) throw new Error("This venue is retired. Its details are kept for history and cannot be edited.");
        setVenue(venue);
      })
      .catch((error: unknown) => { if (active) setError(error instanceof Error || error instanceof DOMException
        ? error.name === "AbortError" ? "Loading took too long. Reload to try again." : error.message
        : "Could not load the venue. Reload to try again."); })
      .finally(() => clearTimeout(timeout));
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [venueId]);

  if (error) return <div role="alert" className="rounded-xl border border-destructive/30 p-5 text-sm text-destructive">{error}<Link href="/venues" className="mt-3 block underline">Back to catalogue</Link></div>;
  if (!venue) return <p role="status" className="text-sm text-muted-foreground">Loading venue…</p>;
  return <VenueForm key={venue.id} venue={venue} />;
}

export default function EditVenuePage() {
  const { venueId } = useParams<{ venueId: string }>();
  return <VenueWorkspace editing title="Edit venue" description="Keep the space’s capacity, facilities, accessibility, layouts and opening hours up to date.">{() => <EditVenue key={venueId} venueId={venueId} />}</VenueWorkspace>;
}
