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
    <section className="space-y-4 rounded-2xl border border-white/10 bg-slate-900/70 p-5">
      <div>
        <h2 className="text-lg font-semibold">Review request</h2>
        <p className="text-sm text-slate-400">
          Approve the request or reject it with a reason.
        </p>
      </div>

      {error && <p role="alert" className="rounded border border-red-700 p-3 text-red-200">{error}</p>}

      <button
        type="button"
        disabled={busy}
        onClick={() => void makeDecision("approve")}
        className="w-full rounded-xl bg-emerald-300 px-4 py-3 text-sm font-semibold text-slate-950 hover:bg-emerald-200 disabled:opacity-50"
      >
        Approve
      </button>

      <form onSubmit={submitRejection} className="space-y-3 border-t border-white/10 pt-4">
        <label htmlFor="decision-reason" className="block font-medium">
          Rejection reason
        </label>
        <textarea
          id="decision-reason"
          value={reason}
          onChange={(formEvent) => setReason(formEvent.target.value)}
          rows={3}
          maxLength={2000}
          className="w-full rounded-xl border border-slate-600 bg-slate-950 p-3 text-sm focus:border-sky-300 focus:outline-none"
          placeholder="Explain why the request cannot proceed"
        />
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-xl border border-rose-400/40 bg-rose-400/10 px-4 py-2.5 text-sm font-semibold text-rose-200 hover:bg-rose-400/20 disabled:opacity-50"
        >
          Reject
        </button>
      </form>
    </section>
  );
}
