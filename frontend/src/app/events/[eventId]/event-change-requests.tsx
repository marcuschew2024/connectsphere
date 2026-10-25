"use client";

import { FormEvent, useState } from "react";
import { ApiError, apiRequest } from "@/lib/api";
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
  onChanged: (request: EventChangeRequest) => void;
}) {
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event_: FormEvent<HTMLFormElement>) {
    event_.preventDefault();
    setError("");
    setBusy(true);
    try {
      const result = await apiRequest<{ change_request: EventChangeRequest }>(
        `/events/${event.id}/change-requests`,
        { method: "POST", body: JSON.stringify({ description }) },
      );
      setDescription("");
      onChanged(result.change_request);
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : "Could not submit the change request.");
    } finally {
      setBusy(false);
    }
  }

  async function review(request: EventChangeRequest, status: EventChangeRequest["status"]) {
    setError("");
    try {
      const result = await apiRequest<{ change_request: EventChangeRequest }>(
        `/events/${event.id}/change-requests/${request.id}`,
        { method: "PATCH", body: JSON.stringify({ status }) },
      );
      onChanged(result.change_request);
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : "Could not update the change request.");
    }
  }

  return (
    <section aria-labelledby="change-requests-heading" className="space-y-4 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
      <div>
        <h2 id="change-requests-heading" className="font-semibold">Change requests</h2>
        <p className="mt-1 text-sm text-muted-foreground">Changes are routed to the assigned Coordinator and can be raised at any time.</p>
      </div>
      {!isCoordinator && !["Draft", "Rejected", "Cancelled"].includes(event.status) && (
        <form onSubmit={submit} className="space-y-3">
          <label htmlFor="change-request-description" className="block text-sm font-medium">Describe the desired change</label>
          <textarea id="change-request-description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} required rows={4} className="w-full rounded-md border border-input bg-background p-3 text-sm" />
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={busy}>{busy ? "Submitting..." : "Request a change"}</Button>
        </form>
      )}
      {loadFailed && <p role="alert" className="text-sm text-destructive">Existing change requests could not be loaded. Refresh to try again.</p>}
      {requests.length === 0 ? !loadFailed && <p className="text-sm text-muted-foreground">No change requests have been raised.</p> : (
        <ul className="space-y-3">
          {requests.map((request) => <li key={request.id} className="rounded-xl border border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">Requested {new Date(request.requested_at).toLocaleString()}</span>
              <ChangeRequestStatusBadge status={request.status} />
            </div>
            <p className="mt-3 whitespace-pre-wrap text-sm">{request.description}</p>
            {request.review_note && <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">Coordinator note: {request.review_note}</p>}
            {isCoordinator && (request.status === "Pending" || request.status === "Under Review") && <div className="mt-3 flex flex-wrap gap-2">
              {request.status === "Pending" && <Button type="button" variant="outline" size="sm" onClick={() => void review(request, "Under Review")}>Start review</Button>}
              <Button type="button" size="sm" onClick={() => void review(request, "Approved")} className="bg-emerald-600 text-white hover:bg-emerald-500">Approve change</Button>
              <Button type="button" size="sm" onClick={() => void review(request, "Rejected")} className="bg-destructive text-white hover:bg-destructive/80">Reject change</Button>
            </div>}
          </li>)}
        </ul>
      )}
    </section>
  );
}
