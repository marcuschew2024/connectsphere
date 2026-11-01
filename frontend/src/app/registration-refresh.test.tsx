// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "../../scripts/testing/dom";
import { eventRecord as event } from "../../scripts/testing/records";
import Registrations from "./registrations/page";
import Roster from "./events/[eventId]/registrations/page";
import Browse from "./events/browse/page";
import Offer from "./events/browse/[eventId]/page";
import { apiRequest } from "@/lib/api";
const state = vi.hoisted(() => ({ role: "Attendee" }));
vi.mock("next/navigation", () => ({ usePathname: () => "/registrations", useParams: () => ({ eventId: "event" }), useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/use-acting-role", () => ({ useActingRole: () => [state.role, vi.fn(), false] }));
vi.mock("@/lib/api", async original => ({ ...await original<object>(), apiRequest: vi.fn() }));
const api = vi.mocked(apiRequest);
beforeEach(() => { vi.resetAllMocks(); state.role = "Attendee"; }); afterEach(() => vi.restoreAllMocks());
it.each([Registrations, Roster])("%s refreshes only when visible and recovers current data on return", async Component => {
  state.role = Component === Roster ? "Organiser" : "Attendee";
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  api.mockResolvedValue({ event, registrations: [], counts: { registered_count: 0, waitlisted_count: 0, withdrawn_count: 0 }, capacity: null, page: 1, has_more: false }); render(<Component />); await screen.findByText("Page 1"); expect(api).toHaveBeenCalledTimes(1);
  visibility.mockReturnValue("hidden"); fireEvent(document, new Event("visibilitychange")); fireEvent.focus(window); await act(async () => {}); expect(api).toHaveBeenCalledTimes(1);
  visibility.mockReturnValue("visible"); fireEvent(document, new Event("visibilitychange")); await waitFor(() => expect(api).toHaveBeenCalledTimes(2)); await screen.findByText("Page 1");
});
it("a registration without its historical event remains visible with its status", async () => {
  api.mockResolvedValue({ registrations: [{ id: "registration", event_id: "event", status: "Registered", event: null, registered_at: "2099-10-01T00:00:00Z" }], page: 1, has_more: false }); render(<Registrations />);
  await screen.findByRole("heading", { name: "Event unavailable" }); expect(screen.getByText("Registered")).toBeTruthy(); expect(screen.queryByRole("link", { name: "View event →" })).toBeNull();
});
it("browse directs a non-attendee to sign in without requesting attendee data", () => {
  state.role = "Organiser"; render(<Browse />); expect(screen.getByRole("alert").textContent).toContain("Sign in with an Attendee account"); expect(api).not.toHaveBeenCalled();
});
it("oversized registration information is rejected before sending a registration", async () => {
  api.mockResolvedValue({ event, capacity: { capacity: 10, registered_count: 0, remaining: 10 }, registration: null, unavailable_reason: null }); render(<Offer />);
  const input = await screen.findByLabelText(/Registration information/); fireEvent.change(input, { target: { value: "x".repeat(4001) } }); fireEvent.submit(screen.getByRole("button", { name: "Register for event" }).closest("form")!);
  expect(screen.getByText("Use at most 4,000 characters for registration information.")).toBeTruthy(); expect(api.mock.calls.some(([, options]) => options?.method === "POST")).toBe(false);
});
it("an open withdrawal policy without a deadline explains the event-start boundary", async () => {
  api.mockResolvedValue({ event, capacity: { capacity: 10, registered_count: 1, remaining: 9 }, registration: { id: "reg", status: "Registered", registered_at: "2099-10-01T00:00:00Z" }, withdrawal_policy: { closes_at: null, unavailable_reason: null }, unavailable_reason: null }); render(<Offer />);
  await screen.findByText("Withdrawal is allowed until the event starts.");
});
it("signup displays an event reference and the default withdrawal boundary", async () => {
  api.mockResolvedValue({ event: { ...event, reference: "EVT-007" }, capacity: { capacity: 10, registered_count: 0, remaining: 10 }, registration: null, withdrawal_policy: { closes_at: null, unavailable_reason: null }, unavailable_reason: null }); render(<Offer />);
  await screen.findByText(/EVT-007/); expect(screen.getByText("Withdrawal conditions: allowed until the event starts.")).toBeTruthy();
});
