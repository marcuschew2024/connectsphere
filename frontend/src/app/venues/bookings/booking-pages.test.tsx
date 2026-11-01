// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { act, deferred, fireEvent, render, screen } from "../../../../scripts/testing/dom";
import Queue from "./page";
import Edit from "./[bookingId]/edit/page";
import { ApiError, apiRequest } from "@/lib/api";
const navigation = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useParams: () => ({ bookingId: "booking-1" }), usePathname: () => "/venues/bookings", useRouter: () => navigation }));
vi.mock("@/lib/use-acting-role", () => ({ useActingRole: () => ["Coordinator", vi.fn(), false, false, 2] }));
vi.mock("@/lib/api", async original => ({ ...await original<object>(), apiRequest: vi.fn() }));
const api = vi.mocked(apiRequest);
const booking = { id: "booking-1", event_id: "event-1", venue_id: "venue-1", status: "Requested", requested_by: 2, reference: "BKG-001",
  start_at: "2099-10-20T06:00:00Z", end_at: "2099-10-20T08:00:00Z", expected_attendance: 20,
  layout: "Theatre", special_requirements: null as string | null, venue: { name: "Auditorium" }, event: { title: "Workshop" } };
const venues = [{ id: "venue-1", name: "Auditorium", capacity: 100 }, { id: "venue-2", name: "Seminar room", capacity: 40 }];
function load(record = booking, catalogue = venues) {
  api.mockImplementation(async path => path === "/venues?page=1" ? { venues: catalogue } : { booking: record });
}
function edit(label: string, value: string) { fireEvent.change(screen.getByLabelText(label), { target: { value } }); }
function save() { fireEvent.submit(screen.getByRole("button", { name: /Save booking change|Saving/ }).closest("form")!); }
beforeEach(() => { vi.resetAllMocks(); load(); });

it("shows loading, a routed booking reference and honest fallbacks for older records", async () => {
  const result = deferred<object>(); api.mockReturnValueOnce(result.promise);
  render(<Queue />); expect(screen.getByText("Loading booking requests...")).toBeTruthy();
  await act(async () => result.resolve({ bookings: [booking, { ...booking, id: "legacy", reference: undefined, venue: null, event: null }] }));
  expect(screen.getByRole("heading", { name: "Auditorium" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Venue booking" })).toBeTruthy();
  expect(screen.getByText("Workshop")).toBeTruthy(); expect(screen.getByText("Event", { exact: true })).toBeTruthy();
  expect(screen.getByRole("link", { name: /Auditorium Workshop/ }).getAttribute("href")).toBe("/venues/bookings/booking-1");
  expect(screen.getByText(/BKG-001/)).toBeTruthy();
});
it("distinguishes an empty queue from an unavailable service", async () => {
  api.mockResolvedValueOnce({ bookings: [] }); render(<Queue />);
  expect(await screen.findByText("There are no requested venue bookings.")).toBeTruthy();
});
it.each([new ApiError("Permission denied", 403), new Error("private connection details")])("shows an appropriate queue error: %s", async error => {
  api.mockRejectedValueOnce(error); render(<Queue />);
  expect((await screen.findByRole("alert")).textContent).toBe(error instanceof ApiError ? "Permission denied" : "Could not load booking requests.");
  expect(screen.queryByText("There are no requested venue bookings.")).toBeNull();
});
it("cancels a queue lookup on navigation without showing a stale failure", async () => {
  const result = deferred<object>(); api.mockReturnValueOnce(result.promise); const view = render(<Queue />);
  const signal = api.mock.calls[0][1]!.signal!; view.unmount(); expect(signal.aborted).toBe(true);
  await act(async () => result.reject(new Error("aborted")));
  expect(screen.queryByRole("alert")).toBeNull();
});
it("saves only the changed booking, prevents duplicate submission and returns to its event", async () => {
  render(<Edit />); await screen.findByLabelText("Venue");
  edit("Venue", "venue-2"); edit("Start", "2099-10-21T14:00"); edit("End", "2099-10-21T16:00");
  edit("Expected attendance", "30"); edit("Layout", "Classroom"); edit("Special requirements", "Projector");
  const result = deferred<object>(); api.mockReturnValueOnce(result.promise); save(); save();
  const writes = api.mock.calls.filter(([, options]) => options?.method === "PATCH");
  expect(writes).toHaveLength(1);
  expect(writes[0][0]).toBe("/venues/bookings/booking-1");
  expect(JSON.parse(writes[0][1]!.body as string)).toEqual({ venue_id: "venue-2",
    start_at: new Date("2099-10-21T14:00").toISOString(), end_at: new Date("2099-10-21T16:00").toISOString(),
    expected_attendance: 30, layout: "Classroom", special_requirements: "Projector" });
  expect(navigation.push).not.toHaveBeenCalled();
  await act(async () => result.resolve({ booking: { ...booking, venue_id: "venue-2" } }));
  expect(navigation.push).toHaveBeenCalledWith("/events/event-1");
});
it.each([
  ["Start", "", "valid start and end"], ["End", "", "valid start and end"],
  ["End", "2000-01-01T00:00", "after the start"], ["Expected attendance", "0", "between 1 and 100"],
  ["Expected attendance", "1.5", "between 1 and 100"], ["Expected attendance", "101", "between 1 and 100"],
])("refuses invalid %s=%s before writing", async (label, value, message) => {
  render(<Edit />); await screen.findByLabelText("Venue"); edit(label, value); save();
  expect(screen.getByRole("alert").textContent).toContain(message);
  expect(api.mock.calls.some(([, options]) => options?.method === "PATCH")).toBe(false);
});
it("handles missing catalogue choices and malformed legacy dates without an invalid write", async () => {
  load({ ...booking, start_at: "unreadable", special_requirements: "Accessible route" }, []);
  render(<Edit />); const start = await screen.findByLabelText("Start");
  expect((start as HTMLInputElement).value).toBe("");
  expect((screen.getByLabelText("Special requirements") as HTMLTextAreaElement).value).toBe("Accessible route");
  save(); expect(screen.getByRole("alert").textContent).toContain("Choose a venue");
  expect(navigation.push).not.toHaveBeenCalled();
});
it.each([new ApiError("Booking no longer editable", 409), new Error("offline")])("retains booking edits after a failed save: %s", async error => {
  render(<Edit />); await screen.findByLabelText("Venue"); edit("Layout", "Boardroom");
  api.mockRejectedValueOnce(error); save();
  expect((await screen.findByRole("alert")).textContent).toBe(error instanceof ApiError ? error.message : "Could not change this booking.");
  expect((screen.getByLabelText("Layout") as HTMLInputElement).value).toBe("Boardroom");
  expect(navigation.push).not.toHaveBeenCalled();
});
it.each([new ApiError("Not your booking", 403), new Error("offline")])("shows load failures without offering an editable form: %s", async error => {
  api.mockRejectedValue(error); render(<Edit />);
  expect((await screen.findByRole("alert")).textContent).toBe(error instanceof ApiError ? error.message : "Could not load this booking.");
  expect(screen.queryByLabelText("Venue")).toBeNull();
});

it.each(["Confirmed", "Cancelled", "Held"])("keeps a %s booking read-only even at the direct edit URL", async status => {
  load({ ...booking, status }); render(<Edit />);
  expect(await screen.findByText(/This booking is read-only/)).toBeTruthy();
  expect(screen.queryByLabelText("Venue")).toBeNull();
  expect(api.mock.calls.some(([, options]) => options?.method === "PATCH")).toBe(false);
});
it("does not offer edits for another Coordinator's Requested booking", async () => {
  load({ ...booking, requested_by: 7 }); render(<Edit />);
  expect(await screen.findByText(/This booking is read-only/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Save booking change" })).toBeNull();
});
