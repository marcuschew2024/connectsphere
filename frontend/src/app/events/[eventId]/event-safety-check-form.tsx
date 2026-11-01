"use client";

import { useRef, useState } from "react";
import { ApiError, apiRequest } from "@/lib/api";
import type { EventRecord } from "@/lib/events";

type SafetyAction = "approve" | "request_changes" | "reject";

// The operational-safety aspects the Safety Officer assesses (Week 7 change #6). Shown as
// prompts alongside the event's recorded details so the review is deliberate, not a rubber stamp.
const SAFETY_CONSIDERATIONS = [
  "Expected attendance against venue capacity and layout",
  "Emergency access and evacuation routes",
  "Accessibility requirements",
  "Equipment placement",
  "Crowd movement",
  "Known venue restrictions",
];

// SCRUM-128: a Safety Officer reviews a Confirmed event and approves it (-> Preparation) or
// sends it back to Planning (request changes / reject) with a reason.
export default function EventSafetyCheckForm({
  event,
  onSaved,
}: {
  event: EventRecord;
  onSaved: (event: EventRecord) => void;
}) {
  const [reason, setReason] = useState("");
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (event.status !== "Confirmed") return null;

  async function decide(decision: SafetyAction) {
    if (submitting.current) return;

    if (decision !== "approve" && !reason.trim()) {
      setError("A reason is required when requesting changes or rejecting.");
      return;
    }

    submitting.current = true;
    setBusy(true);
    setError("");

    try {
      const result = await apiRequest<{ event: EventRecord }>(
        `/events/${event.id}/safety-check`,
        {
          method: "POST",
          body: JSON.stringify({
            decision,
            ...(decision === "approve" ? {} : { reason: reason.trim() }),
          }),
        },
      );

      onSaved(result.event);
      setReason("");
    } catch (decisionError) {
      setError(
        decisionError instanceof ApiError
          ? decisionError.message
          : "Could not record the safety decision.",
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4 rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div>
        <h2 className="text-lg font-semibold">Operational safety check</h2>
        <p className="text-sm text-muted-foreground">
          Review the event&apos;s operational safety, then approve it to proceed to
          preparation or send it back with a reason.
        </p>
      </div>

      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        <div><dt className="text-xs text-muted-foreground">Expected attendance</dt><dd>{event.expected_attendance ?? "Not provided"}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Layout requirements</dt><dd className="whitespace-pre-wrap break-words">{event.venue_requirements || "Not provided"}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Facility requirements</dt><dd className="whitespace-pre-wrap break-words">{event.facility_requirements || "Not provided"}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Accessibility requirements</dt><dd className="whitespace-pre-wrap break-words">{event.accessibility_requirements || "Not provided"}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Equipment requirements</dt><dd className="whitespace-pre-wrap break-words">{event.equipment_requirements || "Not provided"}</dd></div>
      </dl>

      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Assess</p>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {SAFETY_CONSIDERATIONS.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </div>

      {error && <p role="alert" data-testid="safety-error" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}

      <button
        type="button"
        disabled={busy}
        onClick={() => void decide("approve")}
        className="w-full rounded-md bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
      >
        Approve for preparation
      </button>

      <div className="space-y-3 border-t border-border pt-4">
        <label htmlFor="safety-reason" className="block font-medium">
          Reason (required to request changes or reject)
        </label>
        <textarea
          id="safety-reason"
          value={reason}
          onChange={(formEvent) => setReason(formEvent.target.value)}
          rows={3}
          maxLength={2000}
          className="w-full rounded-md border border-input bg-background p-3 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
          placeholder="What must be addressed before this event is safe to prepare?"
        />
        <div className="flex gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => void decide("request_changes")}
            className="flex-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-sm font-semibold text-amber-700 hover:bg-amber-500/20 disabled:opacity-50 dark:text-amber-300"
          >
            Request changes
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void decide("reject")}
            className="flex-1 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm font-semibold text-destructive hover:bg-destructive/20 disabled:opacity-50"
          >
            Reject
          </button>
        </div>
      </div>
    </section>
  );
}
