import type { EventRecord } from "@/lib/events";
import { requestStage } from "@/lib/request-stage";

export default function EventNextStep({ event, role, userId, needsClarification }: {
  event: EventRecord; role: string | null; userId: number | null; needsClarification: boolean;
}) {
  const stage = requestStage(event);
  const coordinator = role === "Coordinator" && userId === event.coordinator_id;
  const organiser = role === "Organiser" && userId === event.organiser_id;
  let detail = stage.detail;
  let title = stage.label;
  if (needsClarification && stage.key !== "closed") {
    title = organiser ? "Your response is needed" : "Waiting for the Organiser";
    detail = organiser ? "Read the clarification below, update the request and resubmit it for review."
      : "The Organiser needs to respond to the clarification before review can continue.";
  } else if (coordinator && stage.key === "review") {
    detail = "Review the details, then approve, reject with a reason, or request clarification.";
  } else if (coordinator && stage.key === "arrangements") {
    detail = "Check the venue bookings and any equipment requests. Once arrangements are ready, use Confirm event.";
  } else if (organiser && stage.key === "arrangements") {
    detail = "Your Coordinator is arranging the venue and any equipment. Set your registration capacity and withdrawal conditions before attendees sign up.";
  } else if (organiser && stage.key === "assignment") {
    detail = "Your request is with the Event Coordinator Lead, who will assign a Coordinator to review it. You can track assignment here and in My requests.";
  } else if (organiser && stage.key === "review") {
    detail = "Your request is with the Coordinator. The decision will appear in your notifications.";
  }
  return <section aria-labelledby="next-step-heading" className="rounded-2xl border border-primary/20 bg-primary/5 p-5 sm:p-6">
    <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_200px]">
      <div>
        <h2 id="next-step-heading" className="text-xs font-semibold uppercase tracking-wider text-primary">What happens next</h2>
        <p className="mt-2 text-lg font-semibold">{title}</p>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">{detail}</p>
      </div>
      <div className="border-t border-primary/15 pt-4 text-sm sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0">
        <p className="text-xs font-medium text-muted-foreground">Coordination</p>
        <p className="mt-1 font-medium">{stage.key === "draft" ? "Not submitted" : event.coordinator_id == null ? "Not assigned yet" : coordinator ? "Assigned to you" : "Coordinator assigned"}</p>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{stage.key === "draft" ? "Submit the request when you are ready for review." : event.coordinator_id == null
          ? "The Event Coordinator Lead manages assignment." : "The assigned Coordinator manages review and arrangements."}</p>
      </div>
    </div>
  </section>;
}
