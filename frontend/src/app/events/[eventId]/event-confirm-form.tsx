"use client";

import { useRef, useState } from "react";
import { ApiError, apiRequest } from "@/lib/api";
import type { EventRecord } from "@/lib/events";

// SCRUM-39: a Coordinator confirms a Planning event. The all-venues gate lives on the
// API (POST /events/<id>/confirm); when it is unmet the API returns 409 with the
// outstanding arrangements in the message, which we surface as the blocked message.
export default function EventConfirmForm({
  event,
  onSaved,
}: {
  event: EventRecord;
  onSaved: (event: EventRecord) => void;
}) {
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (event.status !== "Planning") return null;

  async function confirmEvent() {
    if (submitting.current) return;

    submitting.current = true;
    setBusy(true);
    setError("");

    try {
      const result = await apiRequest<{ event: EventRecord }>(
        `/events/${event.id}/confirm`,
        { method: "POST" },
      );

      onSaved(result.event);
    } catch (confirmError) {
      setError(
        confirmError instanceof ApiError
          ? confirmError.message
          : "Could not confirm the event.",
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4 rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div>
        <h2 className="text-lg font-semibold">Confirm event</h2>
        <p className="text-sm text-muted-foreground">
          Confirm this event once every venue booking is approved. It then moves to the
          operational safety check before preparation.
        </p>
      </div>

      {error && (
        <p
          role="alert"
          data-testid="confirm-blocked-message"
          className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      <button
        type="button"
        disabled={busy}
        onClick={() => void confirmEvent()}
        className="w-full rounded-md bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
      >
        Confirm event
      </button>
    </section>
  );
}
