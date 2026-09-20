"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiError, apiRequest } from "@/lib/api";
import { StatusBadge, type EventRecord, type EventStatusHistory } from "@/lib/events";
import { useActingRole } from "@/lib/use-acting-role";
import EventEditForm from "./event-edit-form";

export default function EventStatusPage() {
  const params = useParams<{ eventId: string }>();
  const [actingRole] = useActingRole();
  const [event, setEvent] = useState<EventRecord | null>(null);
  const [history, setHistory] = useState<EventStatusHistory[]>([]);
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
    ])
      .then(([eventResult, historyResult]) => {
        setEvent(eventResult.event);
        setHistory(historyResult.history);
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

  return (
    <main className="min-h-screen bg-slate-950 px-5 py-8 text-slate-100 sm:py-12">
      <div className="mx-auto max-w-3xl space-y-7">
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white">
          <span aria-hidden="true">←</span> ConnectSphere
        </Link>

        {error && (
          <p role="alert" className="rounded border border-red-700 bg-red-950/40 p-4 text-red-200">
            {error}
          </p>
        )}

        {loading && <p className="text-slate-400">Loading event status...</p>}

        {event && (
          <>
            <header className="space-y-3">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-sky-300">Event status</p>
              <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{event.title || "Untitled request"}</h1>
              {event.request_status === "Draft" && <Link href={`/events/drafts/${event.id}`} className="inline-flex rounded-full bg-sky-300 px-5 py-2.5 text-sm font-semibold text-slate-950">Continue editing</Link>}
            </header>

            <section className="space-y-5 rounded-2xl border border-white/10 bg-slate-900/70 p-6 sm:p-8">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-5">
                <div>
                  <p className="text-sm text-slate-400">Current status</p>
                  <div className="mt-2"><StatusBadge status={event.request_status === "Draft" ? "Draft" : event.status} /></div>
                </div>
                <p className="text-sm text-slate-400">
                  Last updated {new Date(event.last_status_changed_at ?? event.updated_at).toLocaleString()}
                </p>
              </div>

              <p className="text-sm text-slate-400">
                Updated by user {event.last_status_changed_by ?? "unknown"}
              </p>

              <dl className="grid gap-4 text-sm sm:grid-cols-2">
                <div><dt className="text-slate-400">Category</dt><dd>{event.category ?? "Not provided"}</dd></div>
                <div><dt className="text-slate-400">Event date</dt><dd>{event.event_datetime ? new Date(event.event_datetime).toLocaleString() : "Not provided"}</dd></div>
                <div><dt className="text-slate-400">Description</dt><dd>{event.description ?? "Not provided"}</dd></div>
                <div><dt className="text-slate-400">Reference</dt><dd className="break-all font-mono">{event.id}</dd></div>
              </dl>
            </section>

            <section className="space-y-4 rounded-2xl border border-white/10 bg-slate-900/70 p-6 sm:p-8">
              <h2 className="text-lg font-semibold">Status history</h2>
              {history.length === 0 ? (
                <p className="text-sm text-slate-400">No status history is available yet.</p>
              ) : (
                <ol className="space-y-3">
                  {history.map((change) => (
                    <li key={change.id} className="border-l-2 border-sky-300/50 pl-4 text-sm">
                      <p>
                        {change.old_status ?? "Created"} → {change.new_status}
                      </p>
                      <p className="text-slate-400">
                        User {change.changed_by} · {new Date(change.changed_at).toLocaleString()}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            {actingRole === "Coordinator" && (
              <EventEditForm event={event} onSaved={setEvent} />
            )}
          </>
        )}
      </div>
    </main>
  );
}
