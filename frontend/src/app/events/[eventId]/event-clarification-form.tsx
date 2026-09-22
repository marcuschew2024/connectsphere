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
    <section className="space-y-4 rounded-2xl border border-amber-500/30 bg-slate-900/70 p-6 sm:p-8">
      <div>
        <h2 className="text-lg font-semibold">Request clarification</h2>
        <p className="text-sm text-slate-400">Return this request to the organiser with the information they need to amend.</p>
      </div>
      {error && <p role="alert" className="rounded border border-red-700 p-3 text-red-200">{error}</p>}
      <label htmlFor="clarification-note" className="block font-medium">Clarification note</label>
      <textarea
        id="clarification-note"
        value={note}
        onChange={(eventChange) => setNote(eventChange.target.value)}
        maxLength={2000}
        rows={5}
        className="w-full rounded border border-slate-600 bg-slate-950 p-3"
        placeholder="Describe the missing or incorrect information"
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => void requestClarification()}
        className="rounded bg-amber-300 px-4 py-2 font-semibold text-slate-950 disabled:opacity-50"
      >
        {busy ? "Sending..." : "Return for clarification"}
      </button>
    </section>
  );
}
