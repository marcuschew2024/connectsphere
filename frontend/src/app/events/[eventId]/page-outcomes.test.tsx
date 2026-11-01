// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, deferred, fireEvent, render, screen, waitFor } from "../../../../scripts/testing/dom";
import { eventRecord as base } from "../../../../scripts/testing/records";
import Page from "./page";
import Roster from "./registrations/page";
import Offer from "../browse/[eventId]/page";
import { apiRequest, ApiError } from "@/lib/api";
const state = vi.hoisted(() => ({ role: "Coordinator", userId: 2 as number | null }));
vi.mock("next/navigation", () => ({ useParams: () => ({ eventId: "event" }), usePathname: () => "/events/event", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/use-acting-role", () => ({ useActingRole: () => [state.role, vi.fn(), false, false, state.userId] }));
vi.mock("@/lib/api", async original => ({ ...await original<object>(), apiRequest: vi.fn() }));
const api = vi.mocked(apiRequest);
beforeEach(() => { vi.resetAllMocks(); state.role = "Coordinator"; state.userId = 2; }); afterEach(() => vi.useRealTimers());
it.each(["completion", "cancellation", "change request"])("a saved %s with failed history refresh is reported accurately", async action => {
  if (action === "change request") state.role = "Organiser";
  let saved = false; const event = { ...base, status: action === "completion" ? "Preparation" : "Planning" };
  api.mockImplementation(async (path, options) => {
    if (options?.method === "POST") { saved = true; return action === "change request" ? { change_request: { id: 1, status: "Pending", description: "Update", requested_at: "2099-10-01T00:00:00Z" } } : { event: { ...event, status: action === "completion" ? "Completed" : "Cancelled" }, released: { venue_bookings: 1, equipment_reservations: 1 }, notified_attendees: 0 }; }
    if (path.endsWith("/history")) { if (saved) throw new Error("history offline"); return { history: [] }; }
    if (path.endsWith("/change-requests")) return { change_requests: [] };
    if (path.endsWith("/clarification")) return { clarification: null };
    if (path.includes("/bookings/event/")) return { bookings: [] };
    return { event };
  });
  render(<Page />); await screen.findByRole("heading", { name: "Workshop" });
  if (action === "completion") { fireEvent.click(screen.getByRole("button", { name: "Mark event complete" })); fireEvent.click(screen.getByRole("button", { name: "Confirm completion" })); }
  else if (action === "cancellation") { fireEvent.click(screen.getByText("Cancel event", { selector: "summary" })); fireEvent.change(screen.getByLabelText("Reason for cancelling"), { target: { value: "Unavailable" } }); fireEvent.click(screen.getByRole("button", { name: "Continue to cancellation" })); fireEvent.click(screen.getByRole("button", { name: "Confirm cancellation" })); }
  else { fireEvent.change(screen.getByLabelText("Describe the desired change"), { target: { value: "Update" } }); fireEvent.submit(screen.getByRole("button", { name: "Request a change" }).closest("form")!); }
  const message = action === "completion" ? "The event was completed" : action === "cancellation" ? "The event was cancelled" : "The change request was saved";
  expect((await screen.findByRole("alert")).textContent).toContain(`${message}, but status history could not be refreshed.`);
  expect(api.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1);
});
it("roster pagination can return to the first page and explains missing historical attendee fields", async () => {
  state.role = "Organiser"; const record = { event: { ...base, title: null, reference: undefined, event_datetime: null }, registrations: [{ id: "reg", status: "Registered", attendee: null, reference: null, registered_at: null, withdrawn_at: null }], counts: { registered_count: 1, waitlisted_count: 0, withdrawn_count: 0 }, capacity: null, page: 1, has_more: true };
  api.mockResolvedValueOnce(record); render(<Roster />); await screen.findByText("Attendee unavailable"); expect(screen.getByText("Reference unavailable")).toBeTruthy();
  api.mockResolvedValueOnce({ ...record, page: 2, has_more: false }); fireEvent.click(screen.getByRole("button", { name: "Next" })); await screen.findByText("Page 2");
  api.mockResolvedValueOnce(record); fireEvent.click(screen.getByRole("button", { name: "Previous" })); await screen.findByText("Page 1"); expect(api.mock.calls[2][0]).toContain("page=1");
});
const offer = { event: { ...base, status: "Confirmed", registration_requirements: "" }, capacity: { capacity: 10, registered_count: 0, remaining: 10 }, registration: null, can_register: true, unavailable_reason: null };
it.each([new ApiError("Invalid", 400, { information: "Explain your requirements" }), new Error("offline")])("registration failure preserves input and distinguishes field errors: %s", async error => {
  state.role = "Attendee"; api.mockResolvedValueOnce(offer); render(<Offer />); const button = await screen.findByRole("button", { name: "Register for event" });
  api.mockRejectedValueOnce(error); fireEvent.submit(button.closest("form")!);
  expect((await screen.findAllByRole("alert")).some(element => element.textContent?.includes(error instanceof ApiError ? "Explain your requirements" : "Could not confirm your registration"))).toBe(true);
});
it("registration waits for a persisted response and ignores a duplicate pending submit", async () => {
  state.role = "Attendee"; api.mockResolvedValueOnce(offer); render(<Offer />); const button = await screen.findByRole("button", { name: "Register for event" }); const form = button.closest("form")!;
  const pending = deferred<object>(); api.mockReturnValueOnce(pending.promise); fireEvent.submit(form); fireEvent.submit(form); expect(api.mock.calls.filter(([, o]) => o?.method === "POST")).toHaveLength(1);
  await act(async () => pending.resolve({ registration: { id: "reg", status: "Registered", event_id: "event", registered_at: "2099-10-01T00:00:00Z", information: "" } })); await waitFor(() => expect(screen.queryByRole("button", { name: "Register for event" })).toBeNull());
});
it("registration aborts a stalled save without claiming a place", async () => {
  state.role = "Attendee"; api.mockResolvedValueOnce(offer); render(<Offer />); const button = await screen.findByRole("button", { name: "Register for event" }); vi.useFakeTimers();
  api.mockImplementation((_path, options) => new Promise((_resolve, reject) => options?.signal?.addEventListener("abort", () => reject(new Error("Timed out"))))); fireEvent.submit(button.closest("form")!);
  await act(async () => vi.advanceTimersByTimeAsync(15000)); expect(screen.getByRole("alert").textContent).toContain("Could not confirm your registration");
});
it("an organiser can return from a legacy draft status page to editing", async () => {
  state.role = "Organiser"; state.userId = 1;
  api.mockImplementation(async path => path.endsWith("/history") ? { history: [] } : path.includes("/bookings/event/") ? { bookings: [] } : path.endsWith("/change-requests") ? { change_requests: [] } : path.endsWith("/clarification") ? { clarification: null } : { event: { ...base, title: "", status: "Draft", request_status: "Draft" } });
  render(<Page />); await screen.findByRole("heading", { name: "Untitled request" }); expect(screen.getByRole("link", { name: "Continue editing" })).toBeTruthy(); expect(screen.getByText("Not submitted")).toBeTruthy();
});
it("a previously accepted event retains its decision date after planning ends", async () => {
  api.mockImplementation(async path => path.endsWith("/history") ? { history: [] } : path.endsWith("/change-requests") ? { change_requests: [] } : path.includes("/bookings/event/") ? { bookings: [] } : path.endsWith("/clarification") ? { clarification: null } : { event: { ...base, status: "Completed", decision_by: 2, decision_at: "2099-10-01T00:00:00Z" } });
  render(<Page />); await screen.findByRole("heading", { name: "Workshop" }); expect(screen.getByText(/The Coordinator accepted this request on/)).toBeTruthy();
});
it("updating one change preserves the other change requests", async () => {
  const first = { id: 1, event_id: "event", status: "Pending", description: "First", requested_at: "2099-10-01T00:00:00Z" }, second = { ...first, id: 2, description: "Second" };
  api.mockImplementation(async (path, options) => options?.method === "PATCH" ? { change_request: { ...first, status: "Rejected" } } : path.endsWith("/history") ? { history: [] } : path.endsWith("/change-requests") ? { change_requests: [first, second] } : path.includes("/bookings/event/") ? { bookings: [] } : path.endsWith("/clarification") ? { clarification: null } : { event: base });
  render(<Page />); await screen.findByText("First"); fireEvent.click(screen.getAllByRole("button", { name: "Reject change" })[0]); await waitFor(() => expect(screen.getAllByRole("button", { name: "Reject change" })).toHaveLength(1)); expect(screen.getByText("Second")).toBeTruthy();
});
it("registration details explain one remaining place and a deadline-only withdrawal policy", async () => {
  state.role = "Attendee"; api.mockResolvedValue({ ...offer, event: { ...offer.event, reference: undefined, registration_requirements: null }, capacity: { ...offer.capacity, remaining: 1 }, withdrawal_policy: { closes_at: "2099-10-01T00:00:00Z", unavailable_reason: "", can_withdraw: true } });
  render(<Offer />); await screen.findByText("1 place remaining"); expect(screen.getByText(/Withdrawal conditions: until/)).toBeTruthy();
});
it("registered attendee sees the default deadline explanation when no restriction exists", async () => {
  state.role = "Attendee"; api.mockResolvedValue({ ...offer, registration: { id: "reg", status: "Registered", registered_at: "2099-10-01T00:00:00Z" }, withdrawal_policy: { closes_at: "2099-10-01T00:00:00Z", unavailable_reason: "", can_withdraw: false } });
  render(<Offer />); await screen.findByText(/Withdrawal closes/); expect(screen.getByRole("button", { name: "Withdraw registration" })).toBeTruthy();
});
it("an empty later roster page directs organisers back to earlier registrations", async () => {
  state.role = "Organiser";
  api.mockResolvedValueOnce({ event: base, registrations: [], counts: { registered_count: 0, waitlisted_count: 0, withdrawn_count: 0 }, capacity: null, page: 1, has_more: true }); render(<Roster />); const next = await screen.findByRole("button", { name: "Next" });
  api.mockResolvedValueOnce({ event: base, registrations: [], counts: { registered_count: 0, waitlisted_count: 0, withdrawn_count: 0 }, capacity: null, page: 2, has_more: false }); fireEvent.click(next); await screen.findByText("No registrations on this page. Use Previous to return to an earlier page.");
});
