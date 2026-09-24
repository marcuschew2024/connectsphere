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
  const [notice, setNotice] = useState("");

  if (event.status !== "Submitted") return null;

  async function makeDecision(decision: "approve" | "reject") {
    if (busy) return;

    if (decision === "reject" && !reason.trim()) {
      setError("A reason is required when rejecting a request.");
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");

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
      setNotice(
        decision === "approve"
          ? "Request approved and moved to Planning."
          : "Request rejected and the organiser was notified.",
      );
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
    <section className="space-y-4 rounded-2xl border border-white/10 bg-slate-900/70 p-6 sm:p-8">
      <div>
        <h2 className="text-lg font-semibold">Review request</h2>
        <p className="text-sm text-slate-400">
          Approve the request or reject it with a reason.
        </p>
      </div>

      {error && <p role="alert" className="rounded border border-red-700 p-3 text-red-200">{error}</p>}
      {notice && <p role="status" className="rounded border border-green-700 p-3 text-green-200">{notice}</p>}

      <button
        type="button"
        disabled={busy}
        onClick={() => void makeDecision("approve")}
        className="rounded bg-emerald-400 px-4 py-2 font-semibold text-slate-950 disabled:opacity-50"
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
          rows={4}
          maxLength={2000}
          className="w-full rounded border border-slate-600 bg-slate-950 p-3"
          placeholder="Explain why the request cannot proceed"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-red-400 px-4 py-2 font-semibold text-slate-950 disabled:opacity-50"
        >
          Reject
        </button>
      </form>
    </section>
  );
}
