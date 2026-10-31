import type { EventRecord } from "./events";

const CLOSED = new Set(["Completed", "Rejected", "Cancelled"]);
export const OVERVIEW_PAGE_SIZE = 6;

export function groupSupervisedEvents(events: EventRecord[]) {
  const visible = events.filter(event => (event.request_status ?? event.status) !== "Draft");
  const past = visible.filter(event => CLOSED.has(event.request_status ?? event.status));
  const active = visible.filter(event => !CLOSED.has(event.request_status ?? event.status));
  const unassigned = active.filter(event => event.coordinator_id === null)
    .sort((a, b) => (a.submitted_at ?? a.created_at).localeCompare(b.submitted_at ?? b.created_at));
  const assigned = active.filter(event => event.coordinator_id !== null)
    .sort((a, b) => (b.coordinator_assigned_at ?? b.updated_at).localeCompare(a.coordinator_assigned_at ?? a.updated_at));
  past.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return { unassigned, assigned, past };
}

export function filterSupervisedEvents(events: EventRecord[], search: string, coordinator: string, status: string) {
  const query = search.trim().toLocaleLowerCase();
  return events.filter(event => (!query || [event.title, event.reference].some(value => value?.toLocaleLowerCase().includes(query)))
    && (coordinator === "all" || (coordinator === "unassigned" ? event.coordinator_id === null : String(event.coordinator_id) === coordinator))
    && (status === "all" || event.status === status));
}
