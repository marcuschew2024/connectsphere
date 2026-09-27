"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import type { EventRecord } from "@/lib/events";
import { Button } from "@/components/ui/button";
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

  if (error) return <p role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive">{error}</p>;
  if (!event) return <p role="status" className="text-sm text-muted-foreground">Opening your draft…</p>;
  if ((event.request_status ?? event.status) !== "Draft") return (
    <section className="rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
      <h2 className="text-xl font-medium">This request has moved on.</h2>
      <p className="mt-3 text-sm text-muted-foreground">It has already been submitted and can no longer be edited as a draft.</p>
      <Button asChild className="mt-6"><Link href={`/events/${event.id}`}>View event status</Link></Button>
    </section>
  );
  return <EventRequestForm canCreate initialEvent={event} />;
}

export default function EditDraftPage() {
  const { eventId } = useParams<{ eventId: string }>();
  return <DraftWorkspace title="Pick up where you left off." description="Shape the details at your own pace. Save your progress, or submit when everything is ready."><DraftEditor key={eventId} eventId={eventId} /></DraftWorkspace>;
}
