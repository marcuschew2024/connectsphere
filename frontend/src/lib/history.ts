// Readable labels for event_status_history.action values.
const ACTION_LABELS: Record<string, string> = {
  event_completed: "Event completed",
  event_cancelled: "Event cancelled",
  change_requested: "Change Request Pending",
  change_request_under_review: "Change Request Under Review",
  change_request_approved: "Change Request Approved",
  change_request_rejected: "Change Request Rejected",
  change_request_implemented: "Change Request Implemented",
  // SCRUM-130: the Event Coordinator Lead routed the request.
  coordinator_assigned: "Coordinator Assigned",
  coordinator_reassigned: "Coordinator Reassigned",
};

/** A known label, or the stored action turned into words (never raw snake_case). */
export function historyActionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
