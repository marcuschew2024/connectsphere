import type { EventRecord } from "./events";

// Presentation only: use the stored request state to distinguish intake from
// arrangements, even when the customer-facing badge calls both "Planning".
export function requestStage(event: EventRecord) {
  const state = event.request_status ?? event.status;
  if (state === "Draft") return { key: "draft", label: "Draft", detail: "Finish the details and submit when you are ready." };
  if (["Submitted", "Assigned", "Under review"].includes(state)) {
    return event.coordinator_id == null
      ? { key: "assignment", label: "Awaiting assignment", detail: "The Event Coordinator Lead will assign a Coordinator to review this request." }
      : { key: "review", label: "Coordinator review", detail: "Your assigned Coordinator is reviewing the request before arrangements begin." };
  }
  switch (state) {
    case "Approved":
    case "Planning": return { key: "arrangements", label: "Planning arrangements", detail: "The Coordinator arranges venues and any equipment needed before confirming the event." };
    case "Confirmed": return { key: "confirmed", label: "Event confirmed", detail: "Attendees can find this event in Browse events. Signup depends on capacity and the registration window." };
    case "Preparation": return { key: "preparation", label: "Preparing for the event", detail: "The safety review is complete. New registrations are closed while the team prepares for the event." };
    case "Completed": return { key: "closed", label: "Event record closed", detail: "This event is closed. Its details and registrations remain available for reference." };
    case "Rejected": return { key: "closed", label: "Request rejected", detail: "Read the Coordinator's reason in the request before planning a new event." };
    case "Cancelled": return { key: "closed", label: "Event cancelled", detail: "This event will not take place. Its records remain available for reference." };
    default: return { key: "unknown", label: "Check event status", detail: "Open the request details and status history for the latest update." };
  }
}
