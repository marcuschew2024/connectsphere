"use client";

import { useState, type FormEvent } from "react";
import { ApiError, apiRequest } from "@/lib/api";
import type { BookingRecord } from "@/lib/bookings";

// Venue Staff approve/reject a submitted booking request (SCRUM-32 / SCRUM-122).
// Mirrors EventDecisionForm; adds the optional "suggested alternative" the AC allows on
// reject (TC-32-03). Role gating lives in the parent page; this only shows while Pending.
export default function BookingDecisionForm({
  booking,
  onSaved,
}: {
  booking: BookingRecord;
  onSaved: (booking: BookingRecord) => void;
}) {
  const [reason, setReason] = useState("");
  const [alternative, setAlternative] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (booking.status !== "Requested" && booking.status !== "Pending") return null;

  async function makeDecision(decision: "approve" | "reject") {
    if (busy) return;

    if (decision === "reject" && !reason.trim()) {
      setError("A reason is required when rejecting a request.");
      return;
    }

    setBusy(true);
    setError("");

    try {
      const result = await apiRequest<{ booking: BookingRecord }>(
        `/venues/bookings/${booking.id}/decision`,
        {
          method: "POST",
          body: JSON.stringify({
            decision,
            ...(decision === "reject" ? { reason: reason.trim() } : {}),
            ...(alternative.trim() ? { alternative: alternative.trim() } : {}),
          }),
        },
      );

      onSaved(result.booking);
      setReason("");
      setAlternative("");
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
        <h2 className="text-lg font-semibold">Review booking</h2>
        <p className="text-sm text-muted-foreground">
          Approve the booking or reject it with a reason. You may suggest an alternative.
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
        <div>
          <label htmlFor="decision-reason" className="block font-medium">
            Rejection reason
          </label>
          <textarea
            id="decision-reason"
            value={reason}
            onChange={(formEvent) => setReason(formEvent.target.value)}
            rows={3}
            maxLength={2000}
            className="mt-1 w-full rounded-md border border-input bg-background p-3 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
            placeholder="Explain why the booking cannot proceed"
          />
        </div>
        <div>
          <label htmlFor="decision-alternative" className="block font-medium">
            Suggested alternative <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <textarea
            id="decision-alternative"
            value={alternative}
            onChange={(formEvent) => setAlternative(formEvent.target.value)}
            rows={2}
            maxLength={2000}
            className="mt-1 w-full rounded-md border border-input bg-background p-3 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
            placeholder="e.g. Room B, 4–6pm"
          />
        </div>
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
