"use client";

import { useState } from "react";
import { ApiError, apiRequest } from "@/lib/api";
import type { EventCompletionResult, EventRecord } from "@/lib/events";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

// SCRUM-132: the assigned Coordinator closes a delivered (Preparation) event. The
// completion gate lives on the API (POST /events/<id>/complete); when arrangements are
// incomplete it returns 409 with the outstanding items, shown as the blocked message.
export default function EventCompleteForm({
  event,
  onCompleted,
}: {
  event: EventRecord;
  onCompleted: (result: EventCompletionResult) => void;
}) {
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (event.status !== "Preparation") return null;

  async function completeEvent() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await apiRequest<EventCompletionResult>(
        `/events/${event.id}/complete`,
        { method: "POST", body: JSON.stringify(note.trim() ? { note } : {}) },
      );
      onCompleted(result);
    } catch (completeError) {
      setConfirming(false);
      setError(
        completeError instanceof ApiError ? completeError.message : "Could not complete the event.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="complete-event-heading" className="space-y-4 rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div>
        <h2 id="complete-event-heading" className="text-lg font-semibold">Complete event</h2>
        <p className="text-sm text-muted-foreground">
          Close this event once it has been delivered. Its record becomes read-only and any
          remaining equipment reservations and future venue bookings are released.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="completion-note">Post-event notes (optional)</Label>
        <Textarea
          id="completion-note"
          value={note}
          onChange={(change) => setNote(change.target.value)}
          maxLength={2000}
          rows={3}
          placeholder="Issues, follow-ups or anything worth recording."
          disabled={busy}
        />
      </div>

      {error && (
        <p role="alert" data-testid="complete-blocked-message" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {confirming ? (
        <div className="space-y-3 rounded-xl border border-border bg-muted/40 p-4">
          <p className="text-sm font-medium">Completing an event cannot be undone. Continue?</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={busy} onClick={() => void completeEvent()}>
              {busy ? "Completing..." : "Confirm completion"}
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setConfirming(false)}>
              Keep event open
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" className="w-full" onClick={() => { setError(""); setConfirming(true); }}>
          Mark event complete
        </Button>
      )}
    </section>
  );
}
