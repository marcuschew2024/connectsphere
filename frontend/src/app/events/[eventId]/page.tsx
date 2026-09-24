"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiError, apiRequest } from "@/lib/api";
import {
  StatusBadge,
  type EventClarification,
  type EventRecord,
  type EventStatusHistory,
} from "@/lib/events";
import { useActingRole } from "@/lib/use-acting-role";
import EventDecisionForm from "./event-decision-form";
import EventEditForm from "./event-edit-form";
import EventClarificationForm from "./event-clarification-form";
import EventResubmitForm from "./event-resubmit-form";

export default function EventStatusPage() {
  const params = useParams<{ eventId: string }>();
  const [actingRole] = useActingRole();
  const [event, setEvent] = useState<EventRecord | null>(null);
  const [history, setHistory] = useState<EventStatusHistory[]>([]);
  const [clarification, setClarification] = useState<EventClarification | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
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
      apiRequest<{ clarification: EventClarification | null }>(
        `/events/${params.eventId}/clarification`, { signal: controller.signal },
      ),
    ])
      .then(([eventResult, historyResult, clarificationResult]) => {
        setEvent(eventResult.event);
        setHistory(historyResult.history);
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
  }, [params.eventId]);

  const canReview = actingRole === "Coordinator" && event?.status === "Submitted" && !clarification;
  const accepted = event?.decision_at && event.decision_by != null && event.decision_reason == null
    && ["Planning", "Confirmed", "Completed"].includes(event.status);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <nav aria-label="Request navigation" className="border-b border-white/10 bg-slate-900/60">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-8">
          <Link href="/" className="text-sm font-medium text-slate-300 hover:text-white"><span aria-hidden="true">← </span>Home & notifications</Link>
          {actingRole === "Coordinator" && <Link href="/events/review" className="rounded-lg border border-white/15 px-3 py-2 text-sm text-sky-200 hover:bg-white/5">Back to review queue <span aria-hidden="true">→</span></Link>}
        </div>
      </nav>
      <div className="mx-auto max-w-6xl space-y-6 px-5 py-7 sm:px-8 sm:py-9">
        {error && <p role="alert" className="rounded-xl border border-red-700 bg-red-950/40 p-4 text-red-200">{error}</p>}
        {loading && <p className="text-slate-400">Loading event status...</p>}
        {event && <>
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-sky-300">Event request</p>
              <h1 className="mt-2 break-words text-2xl font-semibold tracking-tight sm:text-3xl">{event.title || "Untitled request"}</h1>
              <p className="mt-2 text-xs text-slate-400">Last updated {new Date(event.last_status_changed_at ?? event.updated_at).toLocaleString()}</p>
            </div>
            <div className="space-y-2 text-right">
              <p className="text-xs text-slate-400">Current status</p>
              <StatusBadge status={event.request_status === "Draft" ? "Draft" : event.status} />
            </div>
          </header>

          {event.request_status === "Draft" && <Link href={`/events/drafts/${event.id}`} className="inline-flex rounded-xl bg-sky-300 px-5 py-3 text-sm font-semibold text-slate-950">Continue editing</Link>}
          {accepted && (actingRole === "Organiser" || actingRole === "Coordinator") && <section aria-labelledby="acceptance-heading" className="rounded-2xl border border-emerald-400/25 bg-emerald-400/5 p-5">
            <h2 id="acceptance-heading" className="font-semibold text-emerald-200">Request accepted</h2>
            <p role="status" className="mt-1 text-sm text-slate-300">The Coordinator accepted this request on {new Date(event.decision_at!).toLocaleString()}.{event.status === "Planning" ? " Your event is now in Planning." : ""}</p>
          </section>}
          {!accepted && event.request_status === "Submitted" && actingRole === "Organiser" && !clarification && <p className="rounded-xl border border-sky-300/20 bg-sky-300/5 p-4 text-sm text-sky-100">Your request is with the Coordinator. The decision will appear in your notifications.</p>}
          {event.status === "Rejected" && (actingRole === "Organiser" || actingRole === "Coordinator") && <section aria-labelledby="rejection-heading" className="rounded-2xl border border-rose-400/25 bg-rose-400/5 p-5">
            <h2 id="rejection-heading" className="font-semibold text-rose-200">Rejection reason</h2>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-200">{event.decision_reason || "No rejection reason was recorded."}</p>
            {event.decision_at && <p className="mt-3 text-xs text-slate-400">Rejected on {new Date(event.decision_at).toLocaleString()}</p>}
          </section>}

          {actingRole === "Coordinator" && clarification && <section data-testid="clarification-confirmation" className="space-y-2 rounded-2xl border border-amber-500/30 bg-amber-300/5 p-5">
            <h2 className="font-semibold text-amber-200">Clarification requested</h2>
            <p className="whitespace-pre-wrap break-words text-sm text-slate-300">{clarification.note}</p>
            <p className="text-sm text-slate-400">The request is waiting for the organiser to revise and resubmit it.</p>
          </section>}

          <div className={`grid items-start gap-6 ${canReview ? "lg:grid-cols-[minmax(0,1fr)_360px]" : ""}`}>
            <section aria-labelledby="request-details-heading" className="min-w-0 rounded-2xl border border-white/10 bg-slate-900/50 p-5 sm:p-6">
              <h2 id="request-details-heading" className="mb-5 font-semibold">Request details</h2>
              <dl className="grid gap-x-6 gap-y-5 text-sm sm:grid-cols-2">
                <div><dt className="mb-1 text-xs text-slate-400">Category</dt><dd className="break-words">{event.category || "Not provided"}</dd></div>
                <div><dt className="mb-1 text-xs text-slate-400">Event date</dt><dd>{event.event_datetime ? new Date(event.event_datetime).toLocaleString() : "Not provided"}</dd></div>
                <div><dt className="mb-1 text-xs text-slate-400">Expected attendance</dt><dd>{event.expected_attendance ?? "Not provided"}</dd></div>
                <div><dt className="mb-1 text-xs text-slate-400">Purpose</dt><dd className="whitespace-pre-wrap break-words">{event.purpose || "Not provided"}</dd></div>
                <div className="sm:col-span-2"><dt className="mb-1 text-xs text-slate-400">Description</dt><dd className="whitespace-pre-wrap break-words leading-relaxed">{event.description || "Not provided"}</dd></div>
                {([['venue_requirements', 'Venue'], ['accessibility_requirements', 'Accessibility'], ['equipment_requirements', 'Equipment'], ['registration_requirements', 'Registration']] as const).map(([field, label]) => event[field] && <div key={field}><dt className="mb-1 text-xs text-slate-400">{label} requirements</dt><dd className="whitespace-pre-wrap break-words">{event[field]}</dd></div>)}
                <div className="border-t border-white/10 pt-4 sm:col-span-2"><dt className="mb-1 text-xs text-slate-500">Request reference</dt><dd className="break-all font-mono text-xs text-slate-400">{event.id}</dd></div>
              </dl>
            </section>

            {canReview && <aside aria-label="Review actions" className="space-y-3 lg:sticky lg:top-6">
              <EventDecisionForm event={event} onSaved={setEvent} />
              <details className="rounded-2xl border border-white/10 bg-slate-900/50">
                <summary className="cursor-pointer px-5 py-4 text-sm font-medium text-amber-200">Request clarification</summary>
                <EventClarificationForm event={event} onRequested={setClarification} />
              </details>
            </aside>}
          </div>

          {actingRole === "Organiser" && clarification && <EventResubmitForm event={event} clarification={clarification} onSaved={(updated) => { setEvent(updated); setClarification(null); }} />}
          {actingRole === "Coordinator" && event.status === "Planning" && <details className="rounded-2xl border border-white/10 bg-slate-900/50">
            <summary className="cursor-pointer px-5 py-4 text-sm font-medium text-sky-200">Edit event details</summary>
            <EventEditForm event={event} onSaved={setEvent} />
          </details>}

          <details className="rounded-2xl border border-white/10 bg-slate-900/50">
            <summary className="cursor-pointer px-5 py-4 text-sm font-medium text-slate-300">Status history <span className="ml-2 text-xs text-slate-500">({history.length})</span></summary>
            <div className="border-t border-white/10 px-5 py-4">
              {history.length === 0 ? <p className="text-sm text-slate-400">No status history is available yet.</p> : <ol className="space-y-4">
                {history.map((change) => <li key={change.id} className="border-l-2 border-sky-300/30 pl-4 text-sm">
                  <p>{change.action ?? `${change.old_status ?? "Created"} → ${change.new_status}`}</p>
                  {change.note && <p className="mt-1 whitespace-pre-wrap break-words text-slate-300">{change.note}</p>}
                  <p className="mt-1 text-xs text-slate-400">User {change.changed_by} · {new Date(change.changed_at).toLocaleString()}</p>
                </li>)}
              </ol>}
            </div>
          </details>
        </>}
      </div>
    </main>
  );
}
