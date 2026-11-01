"use client";

import { useRef, useState } from "react";
import { ApiError, apiRequest } from "@/lib/api";
import type { Venue } from "@/lib/venues";
import { Button } from "@/components/ui/button";

export type VenueRetirementResult = { venue: Venue; kept_confirmed_bookings: number };

// SCRUM-26: Venue Staff retire a venue. The API (POST /venues/<id>/retire) re-checks the
// role, refuses while booking requests still need a decision, and records who retired
// the venue and when. Confirmed bookings and the venue's history are kept.
export default function VenueRetirePanel({
  venue,
  onRetired,
}: {
  venue: Venue;
  onRetired: (result: VenueRetirementResult) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (venue.is_retired) return null;

  async function retireVenue() {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await apiRequest<VenueRetirementResult>(`/venues/${venue.id}/retire`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      onRetired(result);
    } catch (retireError) {
      setConfirming(false);
      setError(retireError instanceof ApiError ? retireError.message : "Could not retire the venue.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <details className="rounded-2xl border border-destructive/30 bg-card shadow-sm">
      <summary className="cursor-pointer px-5 py-4 text-sm font-medium text-destructive">Retire venue</summary>
      <section aria-labelledby="retire-venue-heading" className="space-y-4 border-t border-border p-5">
        <div>
          <h2 id="retire-venue-heading" className="text-lg font-semibold">Retire this venue</h2>
          <p className="text-sm text-muted-foreground">
            A retired venue is no longer offered to Coordinators for new bookings. Its confirmed
            bookings and history are kept. Decide any outstanding booking requests first.
          </p>
        </div>

        {error && (
          <p role="alert" data-testid="retire-error-message" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </p>
        )}

        {confirming ? (
          <div className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
            <p className="text-sm font-medium">Retiring a venue cannot be undone. Continue?</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="destructive" disabled={busy} onClick={() => void retireVenue()}>
                {busy ? "Retiring..." : "Confirm retirement"}
              </Button>
              <Button type="button" variant="outline" disabled={busy} onClick={() => setConfirming(false)}>
                Keep venue
              </Button>
            </div>
          </div>
        ) : (
          <Button type="button" variant="destructive" className="w-full" onClick={() => { setError(""); setConfirming(true); }}>
            Continue to retirement
          </Button>
        )}
      </section>
    </details>
  );
}
