"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import type { EventRecord } from "@/lib/events";
import EventRequestForm from "../../new/event-request-form";
import DraftWorkspace from "../draft-workspace";

function DraftEditor({ eventId }: { eventId: string }) {
  const [event, setEvent] = useState<EventRecord | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    apiRequest<{ event: EventRecord }>(`/events/${eventId}`, { signal: controller.signal })
      .then(({ event }) => { if (!controller.signal.aborted) setEvent(event); })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Could not open this draft.");
      });
    return () => controller.abort();
  }, [eventId]);

  if (error) return <p role="alert" className="rounded-2xl border border-red-300/20 bg-red-300/5 p-6 text-sm text-red-200">{error}</p>;
  if (!event) return <p role="status" className="text-sm text-slate-400">Opening your draft…</p>;
  if ((event.request_status ?? event.status) !== "Draft") return (
    <section className="rounded-3xl border border-white/10 bg-white/[0.02] p-8 text-center">
      <h2 className="text-xl font-medium">This request has moved on.</h2>
      <p className="mt-3 text-sm text-slate-400">It has already been submitted and can no longer be edited as a draft.</p>
      <Link href={`/events/${event.id}`} className="mt-6 inline-flex rounded-full bg-sky-300 px-5 py-2.5 text-sm font-semibold text-slate-950">View event status</Link>
    </section>
  );
  return <EventRequestForm canCreate initialEvent={event} />;
}

export default function EditDraftPage() {
  const { eventId } = useParams<{ eventId: string }>();
  return <DraftWorkspace title="Pick up where you left off." description="Shape the details at your own pace. Save your progress, or submit when everything is ready."><DraftEditor key={eventId} eventId={eventId} /></DraftWorkspace>;
}
