"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiError, apiRequest } from "@/lib/api";
import {
  StatusBadge,
  type EventClarification,
  type EventCancellationResult,
  type EventChangeRequest,
  type EventCompletionResult,
  type EventRecord,
  type EventStatusHistory,
} from "@/lib/events";
import { useActingRole } from "@/lib/use-acting-role";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import EventConfirmForm from "./event-confirm-form";
import EventSafetyCheckForm from "./event-safety-check-form";
import EventSafetyReviewDetail from "./event-safety-review-detail";
import EventDecisionForm from "./event-decision-form";
import EventEditForm from "./event-edit-form";
import EventClarificationForm from "./event-clarification-form";
import EventResubmitForm from "./event-resubmit-form";
import EventBookingsPanel from "./event-bookings-panel";
import EventChangeRequests from "./event-change-requests";
import EventCompleteForm from "./event-complete-form";
import EventCancelForm from "./event-cancel-form";
import EventCapacityPanel from "./event-capacity-panel";
import EventWithdrawalPolicy from "./event-withdrawal-policy";
import { historyActionLabel } from "@/lib/history";

export default function EventStatusPage() {
  const params = useParams<{ eventId: string }>();
  const [actingRole, , roleLoading, , userId] = useActingRole();
  const [event, setEvent] = useState<EventRecord | null>(null);
  const [history, setHistory] = useState<EventStatusHistory[]>([]);
  const [clarification, setClarification] = useState<EventClarification | null>(null);
  const [changeRequests, setChangeRequests] = useState<EventChangeRequest[]>([]);
  const [changeRequestsUnavailable, setChangeRequestsUnavailable] = useState(false);
  const [released, setReleased] = useState<EventCompletionResult["released"] | null>(null);
  const [cancellation, setCancellation] = useState<EventCancellationResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (roleLoading) return;
    const controller = new AbortController();
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 8000);

    Promise.all([
      apiRequest<{ event: EventRecord }>(`/events/${params.eventId}`, {
        signal: controller.signal,
      }),
      apiRequest<{ history: EventStatusHistory[] }>(`/events/${params.eventId}/history`, {
        signal: controller.signal,
      }),
      // Only Organisers and Coordinators may list change requests (SCRUM-46).
      // They are secondary to the event, so a failed load must not hide the page.
      actingRole === "Organiser" || actingRole === "Coordinator"
        ? apiRequest<{ change_requests: EventChangeRequest[] }>(
          `/events/${params.eventId}/change-requests`, { signal: controller.signal },
        ).catch((loadError) => {
          if (controller.signal.aborted) throw loadError;
          return null;
        })
        : Promise.resolve({ change_requests: [] }),
      actingRole === "Safety Officer"
        ? Promise.resolve({ clarification: null })
        : apiRequest<{ clarification: EventClarification | null }>(
        `/events/${params.eventId}/clarification`, { signal: controller.signal },
      ),
    ])
      .then(([eventResult, historyResult, changeRequestResult, clarificationResult]) => {
        setEvent(eventResult.event);
        setHistory(historyResult.history);
        setChangeRequests(changeRequestResult?.change_requests ?? []);
        setChangeRequestsUnavailable(changeRequestResult === null);
        setClarification(clarificationResult.clarification);
        setLoading(false);
      })
      .catch((requestError) => {
        if (controller.signal.aborted && !timedOut) return;

        if (timedOut) {
          setError("The event request timed out. Check that the API is running.");
        } else if (requestError instanceof ApiError && requestError.status === 401) {
          setError("Please select a demo user before viewing this event.");
        } else if (requestError instanceof ApiError && requestError.status === 403) {
          setError("You do not have access to this event.");
        } else {
          setError(
            requestError instanceof ApiError
              ? requestError.message
              : "Could not load this event.",
          );
        }
        setLoading(false);
      });

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [params.eventId, actingRole, roleLoading]);

  const canReview = actingRole === "Coordinator" && event?.status === "Submitted" && !clarification;
  const completed = event?.status === "Completed";
  const cancelled = event?.status === "Cancelled";
  // SCRUM-69 (D33): the assigned Coordinator or the Event Coordinator Lead may cancel.
  // Coordinators can view every event (SCRUM-54), so the panel checks it is theirs.
  const canCancel = actingRole === "Event Coordinator Lead"
    || (actingRole === "Coordinator" && userId !== null && event?.coordinator_id === userId);

  async function refreshHistory(eventId: string, failure: string) {
    try {
      const updatedHistory = await apiRequest<{ history: EventStatusHistory[] }>(
        `/events/${eventId}/history`,
      );
      setHistory(updatedHistory.history);
    } catch {
      setError(failure);
    }
  }

  async function handleCompleted(result: EventCompletionResult) {
    setEvent(result.event);
    setReleased(result.released);
    await refreshHistory(result.event.id, "The event was completed, but status history could not be refreshed.");
  }

  async function handleCancelled(result: EventCancellationResult) {
    setEvent(result.event);
    setCancellation(result);
    await refreshHistory(result.event.id, "The event was cancelled, but status history could not be refreshed.");
  }
  const accepted = event?.decision_at && event.decision_by != null && event.decision_reason == null
    && ["Planning", "Confirmed", "Completed"].includes(event.status);

  return (
    <AppShell actingRole={actingRole}>
      {actingRole === "Safety Officer" && <div className="mx-auto max-w-6xl px-5 pt-6 sm:px-8"><Link href="/events/safety" className="text-sm text-primary hover:underline">Back to safety reviews</Link></div>}
      <div className="mx-auto max-w-6xl space-y-6 px-5 py-8 sm:px-8 sm:py-10">
        {actingRole === "Coordinator" && (
          <Link href="/events/review" className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
            <span aria-hidden="true">←</span> Back to review queue
          </Link>
        )}
        {error && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</p>}
        {loading && <p className="text-muted-foreground">Loading event status...</p>}
        {event && <>
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-primary">Event request</p>
              <h1 className="mt-2 break-words text-2xl font-semibold tracking-tight sm:text-3xl">{event.title || "Untitled request"}</h1>
              <p className="mt-2 text-xs text-muted-foreground">Last updated {new Date(event.last_status_changed_at ?? event.updated_at).toLocaleString()}</p>
            </div>
            <div className="space-y-2 text-right">
              <p className="text-xs text-muted-foreground">Current status</p>
              <StatusBadge status={event.request_status === "Draft" ? "Draft" : event.status} />
            </div>
          </header>

          {completed && <section aria-labelledby="completed-heading" className="rounded-2xl border border-border bg-muted/40 p-5">
            <h2 id="completed-heading" className="font-semibold">Event completed and closed</h2>
            <p role="status" className="mt-1 text-sm text-muted-foreground">
              This event&apos;s record is read-only.
              {released && ` Released ${released.equipment_reservations} equipment reservation(s) and ${released.venue_bookings} future venue booking(s).`}
            </p>
          </section>}
          {cancelled && <section aria-labelledby="cancelled-heading" className="rounded-2xl border border-destructive/30 bg-destructive/5 p-5">
            <h2 id="cancelled-heading" className="font-semibold text-destructive">Event cancelled</h2>
            <p role="status" className="mt-1 text-sm text-muted-foreground">
              This event has been cancelled and its record is read-only.
              {cancellation && ` Released ${cancellation.released.venue_bookings} venue booking(s) and ${cancellation.released.equipment_reservations} equipment reservation(s). Notified ${cancellation.notified_attendees} registered attendee(s).`}
            </p>
          </section>}
          {event.request_status === "Draft" && <Button asChild><Link href={`/events/drafts/${event.id}`}>Continue editing</Link></Button>}
          {accepted && (actingRole === "Organiser" || actingRole === "Coordinator") && <section aria-labelledby="acceptance-heading" className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5">
            <h2 id="acceptance-heading" className="font-semibold text-emerald-700 dark:text-emerald-400">Request accepted</h2>
            <p role="status" className="mt-1 text-sm text-muted-foreground">The Coordinator accepted this request on {new Date(event.decision_at!).toLocaleString()}.{event.status === "Planning" ? " Your event is now in Planning." : ""}</p>
          </section>}
          {/* SCRUM-130: a new request waits with the Event Coordinator Lead until assigned. */}
          {!accepted && event.request_status === "Submitted" && actingRole === "Organiser" && !clarification && <p className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm text-foreground">{event.coordinator_id === null
            ? "Your request is with the Event Coordinator Lead, who will assign a Coordinator to review it. You will be notified when a Coordinator is assigned."
            : "Your request is with the Coordinator. The decision will appear in your notifications."}</p>}
          {event.status === "Rejected" && (actingRole === "Organiser" || actingRole === "Coordinator") && <section aria-labelledby="rejection-heading" className="rounded-2xl border border-destructive/30 bg-destructive/5 p-5">
            <h2 id="rejection-heading" className="font-semibold text-destructive">Rejection reason</h2>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm text-foreground">{event.decision_reason || "No rejection reason was recorded."}</p>
            {event.decision_at && <p className="mt-3 text-xs text-muted-foreground">Rejected on {new Date(event.decision_at).toLocaleString()}</p>}
          </section>}

          {actingRole === "Coordinator" && clarification && <section data-testid="clarification-confirmation" className="space-y-2 rounded-2xl border border-amber-500/40 bg-amber-500/5 p-5">
            <h2 className="font-semibold text-amber-700 dark:text-amber-400">Clarification requested</h2>
            <p className="whitespace-pre-wrap break-words text-sm text-foreground">{clarification.note}</p>
            <p className="text-sm text-muted-foreground">The request is waiting for the organiser to revise and resubmit it.</p>
          </section>}

          <div className={`grid items-start gap-6 ${canReview ? "lg:grid-cols-[minmax(0,1fr)_360px]" : ""}`}>
            <section aria-labelledby="request-details-heading" className="min-w-0 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
              <h2 id="request-details-heading" className="mb-5 font-semibold">Request details</h2>
              <dl className="grid gap-x-6 gap-y-5 text-sm sm:grid-cols-2">
                <div><dt className="mb-1 text-xs text-muted-foreground">Category</dt><dd className="break-words">{event.category || "Not provided"}</dd></div>
                <div><dt className="mb-1 text-xs text-muted-foreground">Event date</dt><dd>{event.event_datetime ? new Date(event.event_datetime).toLocaleString() : "Not provided"}</dd></div>
                <div><dt className="mb-1 text-xs text-muted-foreground">Expected attendance</dt><dd>{event.expected_attendance ?? "Not provided"}</dd></div>
                <div><dt className="mb-1 text-xs text-muted-foreground">Purpose</dt><dd className="whitespace-pre-wrap break-words">{event.purpose || "Not provided"}</dd></div>
                <div className="sm:col-span-2"><dt className="mb-1 text-xs text-muted-foreground">Description</dt><dd className="whitespace-pre-wrap break-words leading-relaxed">{event.description || "Not provided"}</dd></div>
                {([['venue_requirements', 'Venue'], ['accessibility_requirements', 'Accessibility'], ['equipment_requirements', 'Equipment'], ['registration_requirements', 'Registration']] as const).map(([field, label]) => event[field] && <div key={field}><dt className="mb-1 text-xs text-muted-foreground">{label} requirements</dt><dd className="whitespace-pre-wrap break-words">{event[field]}</dd></div>)}
                <div className="border-t border-border pt-4 sm:col-span-2"><dt className="mb-1 text-xs text-muted-foreground">Request reference</dt><dd className="break-all font-mono text-xs text-muted-foreground">{event.id}</dd></div>
              </dl>
            </section>

            {canReview && <aside aria-label="Review actions" className="space-y-3 lg:sticky lg:top-6">
              <EventDecisionForm event={event} onSaved={setEvent} />
              <details className="rounded-2xl border border-border bg-card shadow-sm">
                <summary className="cursor-pointer px-5 py-4 text-sm font-medium text-amber-700 dark:text-amber-400">Request clarification</summary>
                <EventClarificationForm event={event} onRequested={setClarification} />
              </details>
            </aside>}
          </div>

          {actingRole === "Organiser" && clarification && <EventResubmitForm event={event} clarification={clarification} onSaved={(updated) => { setEvent(updated); setClarification(null); }} />}
          {event.registration_capacity !== undefined && (actingRole === "Organiser" || actingRole === "Coordinator") && (
            <EventCapacityPanel key={event.id} event={event} actingRole={actingRole} onSaved={setEvent} />
          )}
          {actingRole === "Organiser" && event.withdrawal_closes_at !== undefined && <EventWithdrawalPolicy key={event.id} eventId={event.id} />}
          {(actingRole === "Organiser" || actingRole === "Coordinator") && (
            <EventChangeRequests
              event={event}
              requests={changeRequests}
              loadFailed={changeRequestsUnavailable}
              isCoordinator={actingRole === "Coordinator"}
              onChanged={async (changed) => {
                setChangeRequests((current) => {
                  const existing = current.findIndex((request) => request.id === changed.id);
                  if (existing < 0) return [changed, ...current];
                  return current.map((request) => request.id === changed.id ? changed : request);
                });
                try {
                  const updatedHistory = await apiRequest<{ history: EventStatusHistory[] }>(
                    `/events/${event.id}/history`,
                  );
                  setHistory(updatedHistory.history);
                } catch {
                  setError("The change request was saved, but status history could not be refreshed.");
                }
              }}
            />
          )}
          {actingRole === "Coordinator" && event.status === "Planning" && <EventConfirmForm event={event} onSaved={setEvent} />}
            {(actingRole === "Coordinator" || actingRole === "Organiser" || actingRole === "Venue Staff") && (
              <EventBookingsPanel eventId={event.id} canManage={actingRole === "Coordinator" && !completed && !cancelled} />
            )}
          {actingRole === "Coordinator" && event.status === "Preparation" && <EventCompleteForm event={event} onCompleted={(result) => void handleCompleted(result)} />}
          {actingRole === "Safety Officer" && (event.status === "Confirmed" || event.status === "Preparation") && <EventSafetyReviewDetail eventId={event.id} />}
          {actingRole === "Safety Officer" && event.status === "Confirmed" && <EventSafetyCheckForm event={event} onSaved={setEvent} />}
          {actingRole === "Coordinator" && event.status === "Planning" && <details className="rounded-2xl border border-border bg-card shadow-sm">
            <summary className="cursor-pointer px-5 py-4 text-sm font-medium text-primary">Edit event details</summary>
            <EventEditForm event={event} onSaved={setEvent} />
          </details>}
          {canCancel && <EventCancelForm event={event} onCancelled={(result) => void handleCancelled(result)} />}

          <details className="rounded-2xl border border-border bg-card shadow-sm">
            <summary className="cursor-pointer px-5 py-4 text-sm font-medium text-foreground">Status history <span className="ml-2 text-xs text-muted-foreground">({history.length})</span></summary>
            <div className="border-t border-border px-5 py-4">
              {history.length === 0 ? <p className="text-sm text-muted-foreground">No status history is available yet.</p> : <ol className="space-y-4">
                {history.map((change) => <li key={change.id} className="border-l-2 border-primary/40 pl-4 text-sm">
                  <p>{change.action ? historyActionLabel(change.action) : `${change.old_status ?? "Created"} → ${change.new_status}`}</p>
                  {change.note && <p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">{change.note}</p>}
                  <p className="mt-1 text-xs text-muted-foreground">User {change.changed_by} · {new Date(change.changed_at).toLocaleString()}</p>
                </li>)}
              </ol>}
            </div>
          </details>
        </>}
      </div>
    </AppShell>
  );
}
