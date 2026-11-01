// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, deferred, render, screen } from "../../scripts/testing/dom";
import { ApiError, apiRequest } from "@/lib/api";
import Equipment from "./equipment/page";
import Requests from "./equipment/requests/page";
import RequestDetail from "./equipment/requests/[requestId]/page";
import Browse from "./events/browse/page";
import Offer from "./events/browse/[eventId]/page";
import Roster from "./events/[eventId]/registrations/page";
import EventPage from "./events/[eventId]/page";
import Managed from "./events/managed/page";
import Mine from "./events/mine/page";
import Review from "./events/review/page";
import Safety from "./events/safety/page";
import Supervised from "./events/supervised/page";
import Drafts from "./events/drafts/page";
import Draft from "./events/drafts/[eventId]/page";
import Registrations from "./registrations/page";
import Confirmations from "./registration-confirmations";
import Venues from "./venues/page";
import VenueEdit from "./venues/[venueId]/edit/page";
import Booking from "./venues/bookings/[bookingId]/page";
const state = vi.hoisted(() => ({ role: "Coordinator", loading: false, query: new URLSearchParams() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }), useParams: () => ({ eventId: "event", venueId: "venue", bookingId: "booking", requestId: "request" }), useSearchParams: () => state.query }));
vi.mock("@/lib/use-acting-role", () => ({ useActingRole: () => [state.role, vi.fn(), state.loading, false, 2] }));
vi.mock("@/lib/api", async original => ({ ...await original<object>(), apiRequest: vi.fn() }));
const api = vi.mocked(apiRequest);
const requestParams = Promise.resolve({ requestId: "request" });
function RequestPage() { return <RequestDetail params={requestParams} />; }
const pages = [
  ["equipment", Equipment, "Tech Support"], ["equipment requests", Requests, "Tech Support"], ["equipment detail", RequestPage, "Tech Support"],
  ["browse", Browse, "Attendee"], ["offer", Offer, "Attendee"], ["roster", Roster, "Organiser"],
  ["event", EventPage, "Coordinator"], ["managed", Managed, "Coordinator"], ["mine", Mine, "Organiser"],
  ["review", Review, "Coordinator"], ["safety", Safety, "Safety Officer"], ["supervised", Supervised, "Event Coordinator Lead"],
  ["drafts", Drafts, "Organiser"], ["draft", Draft, "Organiser"], ["registrations", Registrations, "Attendee"],
  ["confirmations", Confirmations, "Attendee"], ["venues", Venues, "Coordinator"], ["venue edit", VenueEdit, "Venue Staff"], ["booking", Booking, "Venue Staff"],
] as const;
beforeEach(() => { vi.resetAllMocks(); state.loading = false; state.query = new URLSearchParams(); });
afterEach(() => vi.useRealTimers());
for (const [name, Component, role] of pages) {
  it.each([new ApiError("Service unavailable", 503), new Error("Network interrupted"), "offline"])(`${name} reports a failed load instead of a false empty result: %s`, async error => {
    state.role = role; api.mockRejectedValue(error); await act(async () => { render(<Component />); });
    expect((await screen.findAllByRole("alert")).some(alert => /unavailable|Network interrupted|Could not|Unable/i.test(alert.textContent ?? ""))).toBe(true);
  });
  it(`${name} cancels outstanding work when leaving the page`, async () => {
    state.role = role; const pending = deferred<object>(); api.mockReturnValue(pending.promise); const view = render(<Component />);
    expect(api.mock.calls.length).toBeGreaterThan(0); const signals = api.mock.calls.map(([, o]) => o?.signal).filter(Boolean);
    view.unmount(); await act(async () => pending.reject(new DOMException("aborted", "AbortError")));
    expect(signals.every(signal => signal?.aborted)).toBe(true); expect(screen.queryByRole("alert")).toBeNull();
  });
}
for (const [name, Component, role] of [pages[3], pages[4], pages[5], pages[14], pages[15], pages[17], pages[6], pages[11], pages[7], pages[8]] as const) {
  it(`${name} aborts a stalled load and shows a recovery message`, async () => {
    state.role = role; vi.useFakeTimers(); api.mockImplementation((_path, options) => new Promise((_resolve, reject) => options?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))));
    render(<Component />); await act(async () => vi.advanceTimersByTimeAsync(8100));
    expect(screen.getAllByRole("alert").some(alert => /timed out|too long/i.test(alert.textContent ?? ""))).toBe(true);
  });
}

for (const [name, Component, role] of pages) {
  it(`${name} does not revive stale data after a successful late response`, async () => {
    state.role = role; const pending = deferred<object>(); api.mockReturnValue(pending.promise); const view = render(<Component />);
    const signals = api.mock.calls.map(([, o]) => o?.signal).filter(Boolean); view.unmount();
    await act(async () => pending.resolve({ events: [], venues: [], offers: [], confirmations: [], registrations: [], requests: [], coordinators: [], history: [], change_requests: [], clarification: null, event: {}, venue: { revision: 1 }, request: {}, booking: {}, equipment: [] }));
    expect(signals.every(signal => signal?.aborted)).toBe(true); expect(screen.queryByRole("heading")).toBeNull();
  });
}
it.each([401, 403])("event read refusal %s has a clear recovery message", async status => {
  state.role = "Coordinator"; api.mockRejectedValue(new ApiError("Denied", status)); render(<EventPage />);
  expect((await screen.findByRole("alert")).textContent).toContain(status === 401 ? "select a demo user" : "do not have access");
});
