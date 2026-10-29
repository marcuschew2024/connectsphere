// SCRUM-130: the Event Coordinator Lead's unassigned queue and (re)assignment.
// The API re-checks every rule; these helpers only shape what the Lead sees.
import { apiRequest } from "./api";
import type { EventRecord } from "./events";

export type Coordinator = { id: number; display_name: string };

// Terminal events keep their last Coordinator; nothing can re-route them.
const CLOSED = new Set(["Completed", "Rejected", "Cancelled"]);

export function canReassign(event: Pick<EventRecord, "status">): boolean {
  return !CLOSED.has(event.status);
}

/** Unassigned requests (oldest submission first) and everything already routed. */
export function splitQueue(events: EventRecord[]) {
  const unassigned = events
    .filter((event) => event.coordinator_id === null && event.status === "Submitted")
    .sort((a, b) => (a.submitted_at ?? "").localeCompare(b.submitted_at ?? ""));
  const assigned = events.filter((event) => !unassigned.includes(event));
  return { unassigned, assigned };
}

export function coordinatorName(coordinators: Coordinator[], id: number | null): string {
  if (id === null) return "Unassigned";
  return coordinators.find((coordinator) => coordinator.id === id)?.display_name
    ?? `Coordinator #${id}`;
}

export function listCoordinators(signal?: AbortSignal) {
  return apiRequest<{ coordinators: Coordinator[] }>("/events/coordinators", { signal });
}

export function assignCoordinator(eventId: string, coordinatorId: number) {
  return apiRequest<{ event: EventRecord; outcome: "assigned" | "reassigned" }>(
    `/events/${eventId}/coordinator`,
    { method: "POST", body: JSON.stringify({ coordinator_id: coordinatorId }) },
  );
}
