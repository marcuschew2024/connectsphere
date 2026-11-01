import { describe, expect, it } from "vitest";
import type { EventRecord } from "./events";
import { requestStage } from "./request-stage";

const event = (state: string, coordinator: number | null = 2) => ({
  status: "Planning", request_status: state, coordinator_id: coordinator,
}) as EventRecord;

describe("organiser request progress", () => {
  it.each(["Submitted", "Assigned", "Under review"])("%s awaits assignment without a Coordinator", (state) => {
    expect(requestStage(event(state, null))).toMatchObject({ key: "assignment", label: "Awaiting assignment" });
  });
  it.each(["Submitted", "Assigned", "Under review"])("%s with a Coordinator is in review, not arranging venues", (state) => {
    expect(requestStage(event(state))).toMatchObject({ key: "review", label: "Coordinator review" });
  });
  it.each([
    ["Draft", "draft", "Draft"], ["Approved", "arrangements", "Planning arrangements"],
    ["Planning", "arrangements", "Planning arrangements"], ["Confirmed", "confirmed", "Event confirmed"],
    ["Preparation", "preparation", "Preparing for the event"],
    ["Completed", "closed", "Event record closed"], ["Rejected", "closed", "Request rejected"],
    ["Cancelled", "closed", "Event cancelled"],
  ])("%s has the right next step", (state, key, label) => {
    expect(requestStage(event(state))).toMatchObject({ key, label });
  });
  it("uses visible status for responses without a stored request state", () => {
    expect(requestStage({ status: "Confirmed" } as EventRecord).key).toBe("confirmed");
  });
  it("does not claim an unfamiliar state is approved or closed", () => {
    expect(requestStage(event("New server state"))).toMatchObject({ key: "unknown", label: "Check event status" });
  });
  it("explains that safety preparation closes new signups while keeping the event active", () => {
    expect(requestStage(event("Preparation")).detail).toContain("New registrations are closed");
    expect(requestStage(event("Confirmed")).detail).toContain("registration window");
  });
});
