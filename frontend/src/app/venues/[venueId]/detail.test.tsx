// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, deferred, fireEvent, render, screen, waitFor, within } from "../../../../scripts/testing/dom";
import Page from "./page";
import { ApiError, apiRequest } from "@/lib/api";
import { venueMoment } from "@/lib/venues";
const state = vi.hoisted(() => ({ role: "Venue Staff" as string | null, query: new URLSearchParams() }));
vi.mock("next/navigation", () => ({ useParams: () => ({ venueId: "room" }), useSearchParams: () => state.query, usePathname: () => "/venues/room", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/use-acting-role", () => ({ useActingRole: () => [state.role] }));
vi.mock("@/lib/api", async original => ({ ...await original<object>(), apiRequest: vi.fn() }));
const api = vi.mocked(apiRequest);
// SCRUM-27: the fixture carries the fields GET /venues/{id} always returns, so the
// detail page is exercised against the real catalogue payload.
const venue = { id: "room", name: "Hall", location: "Campus", capacity: 30, operating_hours: {}, is_retired: false,
  supported_layouts: ["Theatre", "Classroom"], facilities: ["Projector", "Wi-Fi"], accessibility: ["Ramp"],
  setup_time_minutes: 15, turnaround_time_minutes: 30, timezone: "Asia/Singapore" };
const block = { id: "block", start_at: "2099-10-20T06:00:00Z", end_at: "2099-10-20T07:00:00Z", reason: "Maintenance" };
let blocks: object[], current: object;
function load() {
  api.mockImplementation(async path => {
    if (path.includes("/bookings?")) return { bookings: [] };
    if (path.includes("/unavailability?")) return { blocks };
    if (path.includes("/suitability/")) return { suitability: { is_suitable: true, flags: [] } };
    return { venue: current };
  });
}
beforeEach(() => { vi.resetAllMocks(); state.role = "Venue Staff"; state.query = new URLSearchParams(); current = { ...venue }; blocks = []; load(); });
afterEach(() => vi.useRealTimers());
async function open() { render(<Page />); await screen.findByRole("heading", { name: "Hall" }); }
function fill(label: string, value: string) { fireEvent.change(screen.getByLabelText(label), { target: { value } }); }
function submit() { fill("Start", "2099-10-20T14:00"); fill("End", "2099-10-20T15:00"); fill("Reason", "Safety"); fill("Note", "Inspection"); fireEvent.submit(screen.getByRole("button", { name: "Block venue" }).closest("form")!); }
it.each([new ApiError("Sign in", 401), new ApiError("Unavailable", 503), new Error("offline")])("explains a venue load failure: %s", async error => {
  api.mockRejectedValue(error); render(<Page />);
  expect((await screen.findByRole("alert")).textContent).toBe(error instanceof ApiError ? error.status === 401 ? "Please select a demo user before viewing this venue." : "Unavailable" : "Could not load this venue.");
});
it("explains a timed-out calendar without calling it an empty venue", async () => {
  vi.useFakeTimers(); api.mockImplementation((_path, options) => new Promise((_resolve, reject) => options?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))));
  render(<Page />); await act(async () => vi.advanceTimersByTimeAsync(8000));
  expect(screen.getByRole("alert").textContent).toContain("calendar timed out");
});
it("cancels a departed calendar request without showing a failure", async () => {
  const request = deferred<object>(); api.mockReturnValue(request.promise); const view = render(<Page />);
  const signal = api.mock.calls[0][1]!.signal!; view.unmount(); await act(async () => request.reject(new Error("late")));
  expect(signal.aborted).toBe(true); expect(screen.queryByRole("alert")).toBeNull();
});
it.each(["nonsense", "2099-99-99", "2099-10-20"])("calendar navigation recovers from date query %s", async date => {
  state.query.set("date", date); await open(); const first = api.mock.calls.find(([p]) => p.includes("/bookings?"))![0];
  fireEvent.click(screen.getByRole("button", { name: "Next week" })); await waitFor(() => expect(api.mock.calls.filter(([p]) => p.includes("/bookings?")).length).toBe(2));
  expect(api.mock.calls.filter(([p]) => p.includes("/bookings?"))[1][0]).not.toBe(first);
  fireEvent.click(screen.getByRole("button", { name: "Previous week" })); await waitFor(() => expect(api.mock.calls.filter(([p]) => p.includes("/bookings?")).length).toBe(3));
  fireEvent.click(screen.getByRole("button", { name: "This week" }));
});
it("blocks and unblocks while refreshing persisted calendar data", async () => {
  await open(); const normal = api.getMockImplementation()!;
  api.mockImplementation(async (path, options) => {
    if (options?.method === "POST") { blocks = [block]; return { block }; }
    if (options?.method === "DELETE") { blocks = []; return {}; }
    return normal(path, options);
  });
  submit(); await screen.findByRole("button", { name: "Unblock" });
  const write = api.mock.calls.find(([, o]) => o?.method === "POST")!;
  expect(JSON.parse(write[1]!.body as string)).toEqual({ start_at: new Date(block.start_at).toISOString(), end_at: new Date(block.end_at).toISOString(), reason: "Safety", note: "Inspection" });
  expect((screen.getByLabelText("Note") as HTMLInputElement).value).toBe("");
  fireEvent.click(screen.getByRole("button", { name: "Unblock" })); await waitFor(() => expect(screen.queryByRole("button", { name: "Unblock" })).toBeNull());
});
it.each([new ApiError("Block refused", 409), new Error("offline")])("keeps inputs after a block failure: %s", async error => {
  await open(); api.mockRejectedValueOnce(error); submit();
  expect((await screen.findByRole("alert")).textContent).toBe(error instanceof ApiError ? error.message : "Could not block this venue.");
  expect((screen.getByLabelText("Note") as HTMLInputElement).value).toBe("Inspection");
});
it.each([new ApiError("Cannot unblock", 409), new Error("offline")])("keeps the block after failed removal: %s", async error => {
  blocks = [block]; await open(); api.mockRejectedValueOnce(error); fireEvent.click(screen.getByRole("button", { name: "Unblock" }));
  expect((await screen.findByRole("alert")).textContent).toBe(error instanceof ApiError ? error.message : "Could not unblock this venue.");
  expect(screen.getByRole("button", { name: "Unblock" })).toBeTruthy();
});
it.each([0, 1, 2])("retirement explains that %s confirmed bookings were preserved", async count => {
  await open(); fireEvent.click(screen.getByText("Retire venue", { selector: "summary" })); fireEvent.click(screen.getByRole("button", { name: "Continue to retirement" }));
  api.mockResolvedValueOnce({ venue: { ...venue, is_retired: true }, kept_confirmed_bookings: count });
  fireEvent.click(screen.getByRole("button", { name: "Confirm retirement" }));
  expect((await screen.findByRole("status")).textContent).toContain(`${count} upcoming confirmed ${count === 1 ? "booking was" : "bookings were"} kept`);
});
it.each([false, true])("ignores a late suitability %s after leaving the venue", async rejects => {
  state.query.set("eventId", "event"); const pending = deferred<object>(); const normal = api.getMockImplementation()!;
  api.mockImplementation((path, options) => path.includes("/suitability/") ? pending.promise : normal(path, options));
  const view = render(<Page />); await screen.findByRole("heading", { name: "Hall" }); view.unmount();
  await act(async () => { if (rejects) pending.reject(new Error("late")); else pending.resolve({ suitability: { is_suitable: false, flags: ["Stale"] } }); });
  expect(screen.queryByText("Stale")).toBeNull();
});
it("a suitability lookup failure does not hide the venue calendar", async () => {
  state.query.set("eventId", "event"); const normal = api.getMockImplementation()!;
  api.mockImplementation((path, options) => path.includes("/suitability/") ? Promise.reject(new Error("offline")) : normal(path, options));
  await open(); expect(screen.getByRole("region", { name: "Venue availability" })).toBeTruthy();
});
it("venue details display the public reference alongside the title", async () => {
  current = { ...venue, reference: "VEN-007", created_at: "2099-10-01T00:00:00Z" }; await open(); expect(screen.getByText(/VEN-007/)).toBeTruthy();
});

// --- SCRUM-27: the venue opened from a catalogue card shows its complete record --------
function recordValue(term: string) {
  return screen.getByText(term, { selector: "dt" }).nextElementSibling?.textContent;
}
it("shows the complete catalogue record, not only name location and capacity", async () => {
  await open();
  expect(screen.getByRole("region", { name: "Venue record" })).toBeTruthy();
  expect(recordValue("Layouts")).toBe("Theatre · Classroom");
  expect(recordValue("Facilities")).toBe("Projector · Wi-Fi");
  expect(recordValue("Accessibility")).toBe("Ramp");
  expect(recordValue("Capacity")).toBe("30 people");
  expect(recordValue("Setup buffer")).toBe("15 minutes before the event");
  expect(recordValue("Turnaround buffer")).toBe("30 minutes after the event");
  expect(recordValue("Time zone")).toBe("Asia/Singapore");
});
it("says what is absent rather than leaving the record blank", async () => {
  current = { ...venue, facilities: [], accessibility: [], setup_time_minutes: 0, turnaround_time_minutes: 0 };
  await open();
  expect(recordValue("Facilities")).toBe("None listed");
  expect(recordValue("Accessibility")).toBe("None listed");
  expect(recordValue("Setup buffer")).toBe("None");
  expect(recordValue("Turnaround buffer")).toBe("None");
});
it("lists the opening hours of every day, including the days the venue is closed", async () => {
  current = { ...venue, operating_hours: { monday: { opens: "10:00", closes: "18:00" }, tuesday: { opens: "09:00", closes: "17:00" }, saturday: null } };
  await open();
  fireEvent.click(screen.getByText("Opening hours", { selector: "summary" }));
  const hours = screen.getByText("Opening hours", { selector: "summary" }).nextElementSibling!;
  expect(within(hours as HTMLElement).getByText("monday").nextElementSibling?.textContent).toBe("10:00 – 18:00");
  expect(within(hours as HTMLElement).getByText("tuesday").nextElementSibling?.textContent).toBe("09:00 – 17:00");
  expect(within(hours as HTMLElement).getAllByText("Closed")).toHaveLength(5);
});
it("keeps the record out of reach of roles that cannot open the venue", async () => {
  state.role = "Organiser";
  render(<Page />);
  expect((await screen.findByRole("alert")).textContent).toContain("Coordinators and Venue Staff");
  expect(screen.queryByRole("heading", { name: "Venue record" })).toBeNull();
});

// --- SCRUM-27 AC2/AC3: status, closures and the Coordinator's read-only view ----------
const closure = { id: "closure", start_at: "2099-10-20T06:00:00Z", end_at: "2099-10-20T07:00:00Z", reason: "Renovation" };
// The calendar and the closure lookup share one endpoint; the closure lookup is the one
// asking for the 90-day horizon rather than a single week.
function isClosureLookup(path: string) {
  const query = new URLSearchParams(path.split("?")[1] ?? "");
  const from = Date.parse(query.get("from") ?? ""), to = Date.parse(query.get("to") ?? "");
  return path.includes("/unavailability?") && to - from > 8 * 24 * 60 * 60 * 1000;
}
function interceptClosures(answer: (path: string) => Promise<object>) {
  const normal = api.getMockImplementation()!;
  api.mockImplementation((path, options) =>
    isClosureLookup(path) ? answer(path) : normal(path, options));
}
function withClosures(rows: object[]) {
  interceptClosures(() => Promise.resolve({ blocks: rows }));
}
it("reports an open venue as active and lists no closures", async () => {
  await open();
  expect(recordValue("Status")).toBe("Active");
  expect(screen.queryByText("Current and upcoming closures")).toBeNull();
});
it("marks a venue that is closed right now, naming the reason and when it reopens", async () => {
  const now = Date.now();
  const running = { ...closure, start_at: new Date(now - 3600_000).toISOString(), end_at: new Date(now + 3600_000).toISOString() };
  withClosures([running]); state.role = "Coordinator"; await open();
  expect(recordValue("Status")).toBe(`Blocked — Renovation until ${venueMoment(running.end_at)}`);
});
it("marks a retired venue as retired", async () => {
  current = { ...venue, is_retired: true }; await open();
  expect(recordValue("Status")).toBe("Retired");
});
it("shows a Coordinator the closures ahead, which the calendar week would hide", async () => {
  withClosures([closure]); state.role = "Coordinator"; await open();
  const list = screen.getByText("Current and upcoming closures").nextElementSibling!;
  const listed = within(list as HTMLElement).getByRole("listitem");
  expect(listed.textContent).toContain("Renovation");
  expect(listed.textContent).toContain(venueMoment(closure.start_at));
  expect(recordValue("Status")).toBe("Active");
});
it("does not repeat the closures for Venue Staff, who manage them in their own panel", async () => {
  withClosures([closure]); await open();
  expect(screen.queryByText("Current and upcoming closures")).toBeNull();
  expect(screen.getByRole("heading", { name: "Block venue period" })).toBeTruthy();
});
it("keeps the record readable when the closure lookup fails", async () => {
  interceptClosures(() => Promise.reject(new Error("offline")));
  state.role = "Coordinator"; await open();
  expect(recordValue("Status")).toBe("Active");
  expect(recordValue("Layouts")).toBe("Theatre · Classroom");
});
it("offers a Coordinator no way to change the venue", async () => {
  state.role = "Coordinator"; await open();
  expect(screen.getByRole("region", { name: "Venue record" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Block venue period" })).toBeNull();
  expect(screen.queryByText("Retire venue", { selector: "summary" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Block venue" })).toBeNull();
});
it.each([false, true])("ignores a late closure lookup %s after leaving the venue", async rejects => {
  const pending = deferred<object>(); interceptClosures(() => pending.promise);
  state.role = "Coordinator"; const view = render(<Page />);
  await screen.findByRole("heading", { name: "Hall" }); view.unmount();
  await act(async () => { if (rejects) pending.reject(new Error("late")); else pending.resolve({ blocks: [closure] }); });
  expect(screen.queryByText("Current and upcoming closures")).toBeNull();
});
