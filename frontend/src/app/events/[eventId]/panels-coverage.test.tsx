// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { act, deferred, fireEvent, render, screen, waitFor } from "../../../../scripts/testing/dom";
import { eventRecord as event, bookingRecord as booking } from "../../../../scripts/testing/records";
import { ApiError, apiRequest } from "@/lib/api";
import Safety from "./event-safety-review-detail";
import Bookings from "./event-bookings-panel";
import Changes from "./event-change-requests";
import Capacity from "./event-capacity-panel";
import type { EventChangeRequest } from "@/lib/events";
vi.mock("@/lib/api", async original => ({ ...await original<object>(), apiRequest: vi.fn() }));
const api = vi.mocked(apiRequest), changed = vi.fn();
function ReadBookings({ eventId }: { eventId: string }) { return <Bookings eventId={eventId} canManage={false} />; }
const request: EventChangeRequest = { id: 1, event_id: "event", description: "Update", requested_by: 1, requested_at: "2099-10-01T00:00:00Z", status: "Pending", reviewed_by: null, reviewed_at: null, review_note: null };
beforeEach(() => vi.resetAllMocks());
for (const [name, Component] of [["safety detail", Safety], ["bookings", ReadBookings]] as const) {
  it.each([new ApiError("Unavailable", 503), new Error("offline")])(`${name} explains an unavailable read without inventing empty results: %s`, async error => {
    api.mockRejectedValue(error); render(<Component eventId="event" />); expect((await screen.findByRole("alert")).textContent).toContain(error instanceof ApiError ? "Unavailable" : "Could not load");
  });
  it.each([false, true])(`${name} cancels and discards a departed response: rejects=%s`, async rejects => {
    const pending = deferred<object>(); api.mockReturnValue(pending.promise); const view = render(<Component eventId="event" />); const signal = api.mock.calls[0][1]!.signal!; view.unmount();
    await act(async () => { if (rejects) pending.reject(new Error("late")); else pending.resolve({ bookings: [], venues: [], equipment: { reservations: [] } }); });
    expect(signal.aborted).toBe(true); expect(screen.queryByRole("alert")).toBeNull();
  });
}
it("safety details distinguish unrecorded values from real operational details", async () => {
  api.mockResolvedValue({ venues: [{ id: "venue", name: "Unknown venue", location: null, capacity: null, supported_layouts: null, accessibility: [], facilities: null }], bookings: [booking], equipment: { reservations: [{ id: "reservation", quantity: null, status: "Confirmed", equipment: null }] } });
  render(<Safety eventId="event" />); await screen.findByText("Unknown venue"); expect(screen.getByText("Not recorded")).toBeTruthy(); expect(screen.getAllByText("None recorded")).toHaveLength(3); expect(screen.getByRole("heading", { name: "Venue booking" })).toBeTruthy();
});
it.each(["Rejected", "Implemented"] as const)("Coordinator can mark a change %s without a significant re-review prompt", async status => {
  const record = { ...request, status: status === "Implemented" ? "Approved" as const : "Pending" as const, significant: false, applied_changes: {} };
  api.mockResolvedValue({ change_request: { ...record, status } }); render(<Changes event={event} requests={[record]} isCoordinator onChanged={changed} />);
  fireEvent.click(screen.getByRole("button", { name: status === "Rejected" ? "Reject change" : "Mark as implemented" }));
  await waitFor(() => expect(changed).toHaveBeenCalled()); expect(JSON.parse(api.mock.calls[0][1]!.body as string)).toEqual({ status });
});
it.each([new ApiError("Refused", 409), new Error("offline")])("failed change review leaves the current request intact: %s", async error => {
  api.mockRejectedValue(error); render(<Changes event={event} requests={[request]} isCoordinator onChanged={changed} />); fireEvent.click(screen.getByRole("button", { name: "Reject change" }));
  expect((await screen.findByRole("alert")).textContent).toBe(error instanceof ApiError ? "Refused" : "Could not update the change request."); expect(changed).not.toHaveBeenCalled();
});
it("an applied no-op change shows its review note without inventing changed values", () => {
  render(<Changes event={event} requests={[{ ...request, status: "Approved", applied_changes: {}, significant: false, review_note: "Already correct" }]} isCoordinator={false} onChanged={changed} />);
  expect(screen.getByText("These values were already in place; nothing needed to change.")).toBeTruthy(); expect(screen.getByText("Coordinator note: Already correct")).toBeTruthy();
});
it("changing structured venue values can clear existing requirements", async () => {
  api.mockResolvedValue({ change_request: request }); render(<Changes event={event} requests={[]} isCoordinator={false} onChanged={changed} />);
  fireEvent.change(screen.getByLabelText("Describe the desired change"), { target: { value: "Simpler requirements" } }); fireEvent.click(screen.getByText("Propose new values (optional)"));
  fireEvent.click(await screen.findByRole("checkbox", { name: "Classroom" })); fireEvent.click(screen.getByRole("checkbox", { name: "Projector" })); fireEvent.click(screen.getByRole("checkbox", { name: "Theatre" }));
  fireEvent.submit(screen.getByRole("button", { name: "Request a change" }).closest("form")!); await waitFor(() => expect(changed).toHaveBeenCalled());
  expect(JSON.parse(api.mock.calls[0][1]!.body as string).changes).toMatchObject({ venue_requirements: "Theatre", facility_requirements: "" });
});
it("a failed new change request preserves the description", async () => {
  api.mockRejectedValue(new Error("offline")); render(<Changes event={event} requests={[]} isCoordinator={false} onChanged={changed} />);
  fireEvent.change(screen.getByLabelText("Describe the desired change"), { target: { value: "Keep my explanation" } }); fireEvent.submit(screen.getByRole("button", { name: "Request a change" }).closest("form")!);
  expect((await screen.findByRole("alert")).textContent).toBe("Could not submit the change request."); expect((screen.getByLabelText("Describe the desired change") as HTMLTextAreaElement).value).toBe("Keep my explanation");
});
it("capacity does not send a second pending save", async () => {
  const pending = deferred<object>(); api.mockReturnValue(pending.promise); render(<Capacity event={event} actingRole="Organiser" onSaved={changed} />); fireEvent.change(screen.getByLabelText("Maximum attendees"), { target: { value: "20" } });
  const form = screen.getByRole("button", { name: "Save capacity" }).closest("form")!; fireEvent.submit(form); fireEvent.submit(form); expect(api).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve({ registration_capacity: { capacity: 20, registered_count: 0 } })); expect(changed).toHaveBeenCalledTimes(1);
});
it("an empty safety assessment explicitly identifies missing venue and equipment arrangements", async () => {
  api.mockResolvedValue({ venues: [], bookings: [], equipment: { reservations: [] } }); render(<Safety eventId="event" />);
  await screen.findByText("No venue has been booked for this event yet."); expect(screen.getByText("No venue bookings for this event.")).toBeTruthy(); expect(screen.getByText("No equipment is reserved for this event.")).toBeTruthy();
});
it.each([new ApiError("Denied", 403), new Error("offline")])("failed booking cancellation retains the current arrangement: %s", async failure => {
  api.mockResolvedValueOnce({ bookings: [{ ...booking, reference: undefined }] }); render(<Bookings eventId="event" canManage />); const cancel = await screen.findByRole("button", { name: "Cancel" }); api.mockRejectedValueOnce(failure); fireEvent.click(cancel);
  expect((await screen.findByRole("alert")).textContent).toBe(failure instanceof ApiError ? "Denied" : "Could not cancel this booking."); expect(screen.getByText("Requested")).toBeTruthy();
});
it("a capacity warning remains useful when the old booking no longer has a venue name", async () => {
  api.mockResolvedValue({ bookings: [{ ...booking, venue: null, capacity_warning: "10 seats short" }] });
  render(<Changes event={event} requests={[{ ...request, status: "Approved", significant: true }]} isCoordinator onChanged={changed} />);
  await screen.findByText("Venue: 10 seats short");
});
it("a change can add structured requirements when older event values are absent", async () => {
  api.mockResolvedValue({ change_request: request }); render(<Changes event={{ ...event, venue_requirements: null, facility_requirements: null, accessibility_requirements: null }} requests={[]} isCoordinator={false} onChanged={changed} />);
  fireEvent.change(screen.getByLabelText("Describe the desired change"), { target: { value: "Add classroom layout" } }); fireEvent.click(screen.getByText("Propose new values (optional)")); fireEvent.click(await screen.findByRole("checkbox", { name: "Classroom" }));
  fireEvent.submit(screen.getByRole("button", { name: "Request a change" }).closest("form")!); await waitFor(() => expect(changed).toHaveBeenCalled()); expect(JSON.parse(api.mock.calls[0][1]!.body as string).changes).toEqual({ venue_requirements: "Classroom" });
});
it("booking arrangements display persisted human-readable references", async () => {
  api.mockResolvedValue({ bookings: [{ ...booking, reference: "BKG-007" }] }); render(<Bookings eventId="event" canManage={false} />); await screen.findByText(/BKG-007/);
});
