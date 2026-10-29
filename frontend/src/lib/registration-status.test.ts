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
});
