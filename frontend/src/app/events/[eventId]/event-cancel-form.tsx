"use client";

import { useRef, useState } from "react";
import { ApiError, apiRequest } from "@/lib/api";
import type { EventCancellationResult, EventRecord } from "@/lib/events";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

// SCRUM-69: the assigned Coordinator or the Event Coordinator Lead cancels an event. The
// API (POST /events/<id>/cancel) re-checks who may cancel, releases the venue bookings and
// equipment and notifies registered Attendees in one transaction.
export const CANCELLABLE_STATUSES = ["Submitted", "Planning", "Confirmed", "Preparation"];

export default function EventCancelForm({
  event,
  onCancelled,
}: {
  event: EventRecord;
  onCancelled: (result: EventCancellationResult) => void;
}) {
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!CANCELLABLE_STATUSES.includes(event.status)) return null;

  function startCancelling() {
    if (!reason.trim()) {
      setError("Give a reason for cancelling this event.");
      return;
    }
    setError("");
    setConfirming(true);
  }

  async function cancelEvent() {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await apiRequest<EventCancellationResult>(`/events/${event.id}/cancel`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      onCancelled(result);
    } catch (cancelError) {
      setConfirming(false);
      setError(
        cancelError instanceof ApiError ? cancelError.message : "Could not cancel the event.",
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <details className="rounded-2xl border border-destructive/30 bg-card shadow-sm">
      <summary className="cursor-pointer px-5 py-4 text-sm font-medium text-destructive">Cancel event</summary>
      <section aria-labelledby="cancel-event-heading" className="space-y-4 border-t border-border p-5">
        <div>
          <h2 id="cancel-event-heading" className="text-lg font-semibold">Cancel this event</h2>
          <p className="text-sm text-muted-foreground">
            Cancelling releases all of this event&apos;s venue bookings and equipment
            reservations and notifies registered attendees. Registrations are kept as they are.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="cancellation-reason">Reason for cancelling</Label>
          <Textarea
            id="cancellation-reason"
            value={reason}
            onChange={(change) => setReason(change.target.value)}
            maxLength={2000}
            rows={3}
            required
            disabled={busy || confirming}
          />
          <p className="text-xs text-muted-foreground">
            Recorded in the status history and shared with the organiser, not with attendees.
          </p>
        </div>

        {error && (
          <p role="alert" data-testid="cancel-error-message" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </p>
        )}

        {confirming ? (
          <div className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
            <p className="text-sm font-medium">Cancelling an event cannot be undone. Continue?</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="destructive" disabled={busy} onClick={() => void cancelEvent()}>
                {busy ? "Cancelling..." : "Confirm cancellation"}
              </Button>
              <Button type="button" variant="outline" disabled={busy} onClick={() => setConfirming(false)}>
                Keep event
              </Button>
            </div>
          </div>
        ) : (
          <Button type="button" variant="destructive" className="w-full" onClick={startCancelling}>
            Continue to cancellation
          </Button>
        )}
      </section>
    </details>
  );
}
