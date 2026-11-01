// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, deferred, fireEvent, render, screen, waitFor } from "../../../../scripts/testing/dom";
import Page from "./page";
import { ApiError, apiRequest } from "@/lib/api";
const state = vi.hoisted(() => ({ role: "Venue Staff" as string | null, query: new URLSearchParams() }));
vi.mock("next/navigation", () => ({ useParams: () => ({ venueId: "room" }), useSearchParams: () => state.query, usePathname: () => "/venues/room", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/use-acting-role", () => ({ useActingRole: () => [state.role] }));
vi.mock("@/lib/api", async original => ({ ...await original<object>(), apiRequest: vi.fn() }));
const api = vi.mocked(apiRequest);
const venue = { id: "room", name: "Hall", location: "Campus", capacity: 30, operating_hours: {}, is_retired: false };
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
