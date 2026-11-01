"use client";

import { FormEvent, useEffect, useState } from "react";
import { ApiError, apiRequest } from "@/lib/api";
import {
  CHANGE_FIELDS,
  type ChangeApprovalResult,
  type ChangeField,
  changeFieldLabel,
  changeValue,
  needsReReview,
  proposedChanges,
  SIGNIFICANT_FIELDS,
} from "@/lib/change-requests";
import { type BookingRecord } from "@/lib/bookings";
import { ChangeRequestStatusBadge, type EventChangeRequest, type EventRecord } from "@/lib/events";
import { Button } from "@/components/ui/button";

export default function EventChangeRequests({
  event,
  requests,
  loadFailed = false,
  isCoordinator,
  onChanged,
}: {
  event: EventRecord;
  requests: EventChangeRequest[];
  loadFailed?: boolean;
  isCoordinator: boolean;
  onChanged: (request: EventChangeRequest, updatedEvent?: EventRecord) => void;
}) {
  const [description, setDescription] = useState("");
  const [drafts, setDrafts] = useState<Partial<Record<ChangeField, string>>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [affected, setAffected] = useState<Record<number, ChangeApprovalResult["affected"]>>({});
  const [error, setError] = useState("");
  // SCRUM-156: current capacity problems on the event's bookings (survive a reload), and
  // the request awaiting a "re-review is complete" confirmation before Implemented.
  const [capacityWarnings, setCapacityWarnings] = useState<string[]>([]);
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const reReviewOpen = requests.some(needsReReview);

  useEffect(() => {
    if (!reReviewOpen) return;
    const controller = new AbortController();
    apiRequest<{ bookings: BookingRecord[] }>(`/venues/bookings/event/${event.id}`, { signal: controller.signal })
      .then((result) => setCapacityWarnings(result.bookings
        .filter((booking) => booking.capacity_warning)
        .map((booking) => `${booking.venue?.name ?? "Venue"}: ${booking.capacity_warning}`)))
      .catch(() => { /* The bookings panel reports load failures; the banner stays generic. */ });
    return () => controller.abort();
  }, [event.id, event.expected_attendance, reReviewOpen]);
  const [busy, setBusy] = useState(false);
  const [proposing, setProposing] = useState(false);

  async function submit(event_: FormEvent<HTMLFormElement>) {
    event_.preventDefault();
    setError("");
    setFieldErrors({});
    setBusy(true);
    try {
      // SCRUM-138: proposed values travel with the description and apply on approval.
      const changes = proposedChanges(drafts);
      const result = await apiRequest<{ change_request: EventChangeRequest }>(
        `/events/${event.id}/change-requests`,
        { method: "POST", body: JSON.stringify(changes ? { description, changes } : { description }) },
      );
      setDescription("");
      setDrafts({});
      onChanged(result.change_request);
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : "Could not submit the change request.");
      if (requestError instanceof ApiError) setFieldErrors(requestError.fields);
    } finally {
      setBusy(false);
    }
  }

  async function review(request: EventChangeRequest, status: EventChangeRequest["status"]) {
    setError("");
    try {
      const result = await apiRequest<ChangeApprovalResult>(
        `/events/${event.id}/change-requests/${request.id}`,
        { method: "PATCH", body: JSON.stringify({ status }) },
      );
      if (result.affected) {
        const counts = result.affected;
        setAffected((current) => ({ ...current, [request.id]: counts }));
      }
      onChanged(result.change_request, result.event);
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : "Could not update the change request.");
    }
  }

  const current = event as unknown as Record<string, string | number | null | undefined>;

  return (
    <section aria-labelledby="change-requests-heading" className="space-y-4 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
      <div>
        <h2 id="change-requests-heading" className="font-semibold">Change requests</h2>
        <p className="mt-1 text-sm text-muted-foreground">Changes are routed to the assigned Coordinator and can be raised at any time.</p>
      </div>
      {reReviewOpen && (
        <div role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-200">
          <p className="font-semibold">Re-review needed</p>
          <p className="mt-1">{isCoordinator
            ? "An approved change to the number of attendees or the venue may affect this event's venue bookings and equipment. Nothing was cancelled; re-check them, then mark the change as implemented."
            : "Your change has been applied. Because it changes the number of attendees or the venue, your Coordinator is re-reviewing the venue and equipment arrangements before it is complete."}</p>
          {capacityWarnings.length > 0 && <div className="mt-2 rounded-lg border border-destructive/30 bg-destructive/5 p-2 text-destructive">
            <p className="font-medium">Venue too small</p>
            <ul className="mt-1 list-disc pl-5">{capacityWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
            {!isCoordinator && <p className="mt-1">Your Coordinator will re-book a larger venue, or you can raise a new change request with a lower number of attendees.</p>}
          </div>}
        </div>
      )}
      {!isCoordinator && !["Draft", "Rejected", "Cancelled", "Completed"].includes(event.status) && (
        <form onSubmit={submit} className="space-y-3">
          <label htmlFor="change-request-description" className="block text-sm font-medium">Describe the desired change</label>
          <textarea id="change-request-description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} required rows={4} className="w-full rounded-md border border-input bg-background p-3 text-sm" />
          <details className="rounded-xl border border-border p-4" onToggle={(e) => setProposing(e.currentTarget.open)}>
            <summary className="cursor-pointer text-sm font-medium">Propose new values (optional)</summary>
            {/* Rendered only while open, so a closed panel adds no extra form fields. */}
            {proposing && <>
            <p className="mt-2 text-xs text-muted-foreground">Fill in only what should change. Approved values are applied to the event. For a new date or time, describe it above.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {CHANGE_FIELDS.map((field) => {
                const { name, label } = field;
                const kind = "kind" in field ? field.kind : "text";
                return <div key={name} className="space-y-1">
                <label htmlFor={`change-${name}`} className="block text-xs font-medium">New {label.toLowerCase()}</label>
                <input
                  id={`change-${name}`}
                  type={kind === "datetime" ? "datetime-local" : kind === "number" ? "number" : "text"}
                  min={kind === "number" ? 1 : undefined}
                  value={drafts[name] ?? ""}
                  placeholder={`Currently: ${changeValue(current[name])}`}
                  onChange={(e) => setDrafts((values) => ({ ...values, [name]: e.target.value }))}
                  aria-invalid={Boolean(fieldErrors[name])}
                  aria-describedby={fieldErrors[name] ? `change-${name}-error` : undefined}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
                {fieldErrors[name] && <p id={`change-${name}-error`} className="text-xs text-destructive">{fieldErrors[name]}</p>}
              </div>;
              })}
            </div>
            </>}
          </details>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={busy}>{busy ? "Submitting..." : "Request a change"}</Button>
        </form>
      )}
      {isCoordinator && error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {loadFailed && <p role="alert" className="text-sm text-destructive">Existing change requests could not be loaded. Refresh to try again.</p>}
      {requests.length === 0 ? !loadFailed && <p className="text-sm text-muted-foreground">No change requests have been raised.</p> : (
        <ul className="space-y-3">
          {requests.map((request) => <li key={request.id} className="rounded-xl border border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">Requested {new Date(request.requested_at).toLocaleString()}</span>
              <ChangeRequestStatusBadge status={request.status} reReview={needsReReview(request)} />
            </div>
            <p className="mt-3 whitespace-pre-wrap text-sm">{request.description}</p>
            {request.applied_changes ? (
              <div className="mt-3 text-sm">
                <p className="font-medium">Applied to the event</p>
                {Object.keys(request.applied_changes).length === 0
                  ? <p className="text-muted-foreground">These values were already in place; nothing needed to change.</p>
                  : <ul className="mt-1 space-y-1">{Object.entries(request.applied_changes).map(([name, change]) => <li key={name} className="break-words">
                    {changeFieldLabel(name)}: {changeValue(change.from)} → {changeValue(change.to)}
                  </li>)}</ul>}
              </div>
            ) : request.requested_changes && (
              <div className="mt-3 text-sm">
                <p className="font-medium">Proposed values</p>
                <ul className="mt-1 space-y-1">{Object.entries(request.requested_changes).map(([name, value]) => <li key={name} className="break-words">
                  {changeFieldLabel(name)} → {changeValue(value)}{SIGNIFICANT_FIELDS.has(name) ? " (significant)" : ""}
                </li>)}</ul>
              </div>
            )}
            {affected[request.id] && needsReReview(request) && <p className="mt-2 text-sm text-muted-foreground">
              Re-check {affected[request.id]!.venue_bookings} venue booking(s) and {affected[request.id]!.equipment_reservations} equipment reservation(s). Nothing was cancelled.
            </p>}
            {needsReReview(request) && (affected[request.id]?.over_capacity?.length ?? 0) > 0 && <p role="alert" className="mt-2 rounded-lg border border-destructive/30 bg-destructive/5 p-2 text-sm text-destructive">
              Venue too small for the new attendance: {affected[request.id]!.over_capacity!.map((venue) => `${venue.venue_name} (capacity ${venue.capacity})`).join(", ")}. Re-book a larger venue or adjust the attendance.
            </p>}
            {request.review_note && <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">Coordinator note: {request.review_note}</p>}
            {isCoordinator && (request.status === "Pending" || request.status === "Under Review") && <div className="mt-3 flex flex-wrap gap-2">
              {request.status === "Pending" && <Button type="button" variant="outline" size="sm" onClick={() => void review(request, "Under Review")}>Start review</Button>}
              <Button type="button" size="sm" onClick={() => void review(request, "Approved")} className="bg-emerald-600 text-white hover:bg-emerald-500">{request.requested_changes ? "Approve and apply" : "Approve change"}</Button>
              <Button type="button" size="sm" onClick={() => void review(request, "Rejected")} className="bg-destructive text-white hover:bg-destructive/80">Reject change</Button>
            </div>}
            {isCoordinator && request.status === "Approved" && request.applied_changes && confirmingId !== request.id && <div className="mt-3">
              <Button type="button" variant="outline" size="sm" onClick={() => needsReReview(request)
                ? setConfirmingId(request.id) : void review(request, "Implemented")}>Mark as implemented</Button>
            </div>}
            {isCoordinator && confirmingId === request.id && <div role="group" aria-label="Confirm the re-review is complete" className="mt-3 space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-200">
              <p className="font-medium">Have you re-checked the venue bookings and equipment for this change?</p>
              {capacityWarnings.length > 0 && <p className="text-destructive">Still unresolved: {capacityWarnings.join("; ")}</p>}
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" onClick={() => { setConfirmingId(null); void review(request, "Implemented"); }}>Yes, re-review complete</Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setConfirmingId(null)}>Not yet</Button>
              </div>
            </div>}
          </li>)}
        </ul>
      )}
    </section>
  );
}
