import { describe, expect, it } from "vitest";
import { registrationStatus } from "./registrations";

describe("registration status presentation", () => {
  it("never describes a waiting-list entry as a booked or withdrawn place", () => {
    const status = registrationStatus("Waitlisted");
    expect(status.label).toBe("Waitlisted");
    expect(status.heading).toBe("Registration waitlisted");
    expect(status.description).toContain("A place has not been confirmed");
  });

  it("does not mistake an unknown server state for withdrawal or confirmation", () => {
    expect(registrationStatus("Unexpected").label).toBe("Status unavailable");
  });

  // SCRUM-69: a cancelled event keeps its registrations, but no place is booked any more.
  it.each(["Registered", "Waitlisted"])("tells a %s attendee that a cancelled event will not take place", (status) => {
    const shown = registrationStatus(status, "Cancelled");
    expect(shown.label).toBe("Event cancelled");
    expect(shown.heading).toBe("Event cancelled");
    expect(shown.description).toContain("will not take place");
    expect(shown.description).not.toContain("place is booked");
  });

  it("keeps a withdrawal visible as a withdrawal when the event is later cancelled", () => {
    expect(registrationStatus("Withdrawn", "Cancelled").label).toBe("Withdrawn");
  });

  it.each(["Confirmed", "Preparation", "Completed", null, undefined])("leaves a registration as booked when the event is %s", (eventStatus) => {
    expect(registrationStatus("Registered", eventStatus).heading).toBe("Registration confirmed");
  });
});
