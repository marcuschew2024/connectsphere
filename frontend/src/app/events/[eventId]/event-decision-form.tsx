"use client";

import { useState, type FormEvent } from "react";
import { ApiError, apiRequest } from "@/lib/api";
import type { EventRecord } from "@/lib/events";

export default function EventDecisionForm({
  event,
  onSaved,
}: {
  event: EventRecord;
  onSaved: (event: EventRecord) => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (event.status !== "Submitted") return null;

  async function makeDecision(decision: "approve" | "reject") {
    if (busy) return;

    if (decision === "reject" && !reason.trim()) {
      setError("A reason is required when rejecting a request.");
      return;
    }

    setBusy(true);
    setError("");

    try {
      const result = await apiRequest<{ event: EventRecord }>(
        `/events/${event.id}/decision`,
        {
          method: "POST",
          body: JSON.stringify({
            decision,
            ...(decision === "reject" ? { reason: reason.trim() } : {}),
          }),
        },
      );

      onSaved(result.event);
      setReason("");
    } catch (decisionError) {
      setError(
        decisionError instanceof ApiError
          ? decisionError.message
          : "Could not save the decision.",
      );
    } finally {
      setBusy(false);
    }
  }

  function submitRejection(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    void makeDecision("reject");
  }

  return (
    <section className="space-y-4 rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div>
        <h2 className="text-lg font-semibold">Review request</h2>
        <p className="text-sm text-muted-foreground">
          Approve the request or reject it with a reason.
        </p>
      </div>

      {error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}

      <button
        type="button"
        disabled={busy}
        onClick={() => void makeDecision("approve")}
        className="w-full rounded-md bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
      >
        Approve
      </button>

      <form onSubmit={submitRejection} className="space-y-3 border-t border-border pt-4">
        <label htmlFor="decision-reason" className="block font-medium">
          Rejection reason
        </label>
        <textarea
          id="decision-reason"
          value={reason}
          onChange={(formEvent) => setReason(formEvent.target.value)}
          rows={3}
          maxLength={2000}
          className="w-full rounded-md border border-input bg-background p-3 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
          placeholder="Explain why the request cannot proceed"
        />
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm font-semibold text-destructive hover:bg-destructive/20 disabled:opacity-50"
        >
          Reject
        </button>
      </form>
    </section>
  );
}
