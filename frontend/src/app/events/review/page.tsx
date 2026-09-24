"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError, apiRequest } from "@/lib/api";
import { StatusBadge, type EventRecord } from "@/lib/events";

export default function ReviewEventsPage() {
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();

    apiRequest<{ events: EventRecord[] }>("/events", { signal: controller.signal })
      .then((result) => {
        setEvents(result.events.filter((event) => event.status === "Submitted"));
        setLoading(false);
      })
      .catch((requestError) => {
        if (controller.signal.aborted) return;
        setError(
          requestError instanceof ApiError
            ? requestError.message
            : "Could not load event requests.",
        );
        setLoading(false);
      });

    return () => controller.abort();
  }, []);

  return (
    <main className="min-h-screen bg-slate-950 px-5 py-8 text-slate-100 sm:py-12">
      <div className="mx-auto max-w-3xl space-y-7">
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white">
          <span aria-hidden="true">←</span> ConnectSphere
        </Link>

        <header className="space-y-3">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-sky-300">Coordinator workspace</p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Review event requests</h1>
          <p className="text-slate-400">Choose a submitted request to approve or reject it.</p>
        </header>

        {error && (
          <p role="alert" className="rounded border border-red-700 bg-red-950/40 p-4 text-red-200">
            {error}
          </p>
        )}

        {loading && <p className="text-slate-400">Loading event requests...</p>}

        {!loading && !error && events.length === 0 && (
          <section className="rounded-2xl border border-white/10 bg-slate-900/70 p-6 text-slate-400 sm:p-8">
            There are no submitted event requests assigned to you.
          </section>
        )}

        {!loading && events.length > 0 && (
          <section className="space-y-3">
            {events.map((event) => (
              <Link
                key={event.id}
                href={`/events/${event.id}`}
                className="block rounded-2xl border border-white/10 bg-slate-900/70 p-5 transition hover:border-sky-400/60 hover:bg-slate-900"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold">{event.title ?? "Untitled event request"}</h2>
                    <p className="mt-1 text-sm text-slate-400">
                      {event.category ?? "Category not provided"}
                      {event.event_datetime
                        ? ` · ${new Date(event.event_datetime).toLocaleString()}`
                        : ""}
                    </p>
                  </div>
                  <StatusBadge status={event.status} />
                </div>
                <p className="mt-4 text-sm text-sky-300">Open request →</p>
              </Link>
            ))}
          </section>
        )}
      </div>
    </main>
  );
}
