"use client";

import { useState } from "react";
import { ApiError, apiRequest } from "@/lib/api";
import type { EventClarification, EventRecord } from "@/lib/events";

export default function EventClarificationForm({
  event,
  onRequested,
}: {
  event: EventRecord;
  onRequested: (clarification: EventClarification) => void;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (event.status !== "Submitted") return null;

  async function requestClarification() {
    if (busy) return;
    if (!note.trim()) {
      setError("Explain what the organiser needs to clarify.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await apiRequest<{ clarification: EventClarification }>(
        `/events/${event.id}/clarification`,
        { method: "POST", body: JSON.stringify({ note: note.trim() }) },
      );
      onRequested(result.clarification);
      setNote("");
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : "Could not request clarification.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4 border-t border-border p-5">
      <div>
        <h2 className="text-lg font-semibold">Request clarification</h2>
        <p className="text-sm text-muted-foreground">Return this request to the organiser with the information they need to amend.</p>
      </div>
      {error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
      <label htmlFor="clarification-note" className="block font-medium">Clarification note</label>
      <textarea
        id="clarification-note"
        value={note}
        onChange={(eventChange) => setNote(eventChange.target.value)}
        maxLength={2000}
        rows={3}
        className="w-full rounded-md border border-input bg-background p-3 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
        placeholder="Describe the missing or incorrect information"
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => void requestClarification()}
        className="rounded-md bg-amber-500 px-4 py-2 font-semibold text-white hover:bg-amber-400 disabled:opacity-50"
      >
        {busy ? "Sending..." : "Return for clarification"}
      </button>
    </section>
  );
}
