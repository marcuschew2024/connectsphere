// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { act, deferred, fireEvent, render, screen, waitFor } from "../../scripts/testing/dom";
import { equipmentRequest as request, eventRecord as event } from "../../scripts/testing/records";
import { apiRequest } from "@/lib/api";
import Browse from "./events/browse/page";
import Requests from "./equipment/requests/page";
import Confirmations from "./registration-confirmations";
import Equipment from "./equipment/page";
const state = vi.hoisted(() => ({ role: "Attendee", loading: false }));
vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/use-acting-role", () => ({ useActingRole: () => [state.role, vi.fn(), state.loading] }));
vi.mock("@/lib/api", async original => ({ ...await original<object>(), apiRequest: vi.fn() }));
const api = vi.mocked(apiRequest);
beforeEach(() => { vi.resetAllMocks(); state.role = "Attendee"; state.loading = false; });
it("browse pages preserve honest capacity labels and can retry after an error", async () => {
  api.mockRejectedValueOnce("offline"); render(<Browse />); expect((await screen.findByRole("alert")).textContent).toBe("Could not load events.");
  api.mockResolvedValueOnce({ offers: [
    { event: { ...event, reference: "EVT-001" }, capacity: { remaining: 1 }, unavailable_reason: null },
    { event: { ...event, id: "second", title: "Second" }, capacity: { remaining: 2 }, unavailable_reason: null },
    { event: { ...event, id: "full", title: "Full" }, capacity: { remaining: 0 }, unavailable_reason: "Registration closed" },
  ], has_more: true });
  fireEvent.click(screen.getByRole("button", { name: "Try again" })); await screen.findByText("1 place remaining"); expect(screen.getByText("2 places remaining")).toBeTruthy(); expect(screen.getByText("Registration closed")).toBeTruthy();
  api.mockResolvedValueOnce({ offers: [], has_more: false }); fireEvent.click(screen.getByRole("button", { name: "Next" })); await screen.findByText("Page 2"); await screen.findByText("There are no confirmed events to browse yet.");
  api.mockResolvedValueOnce({ offers: [], has_more: true }); fireEvent.click(screen.getByRole("button", { name: "Previous" })); await screen.findByText("Page 1");
  expect(api.mock.calls.map(([p]) => p)).toEqual(["/events/registration-offers?page=1", "/events/registration-offers?page=1", "/events/registration-offers?page=2", "/events/registration-offers?page=1"]);
});
it.each([Browse, Requests])("does not request private lists before the role lookup resolves", Component => {
  state.loading = true; render(<Component />); expect(api).not.toHaveBeenCalled(); expect(screen.getByRole("status").textContent).toMatch(/Loading|Checking access/);
});
it("equipment request pages recover, retain record references and page in both directions", async () => {
  state.role = "Tech Support"; api.mockRejectedValueOnce(new Error("offline")); render(<Requests />); await screen.findByRole("alert");
  api.mockResolvedValueOnce({ requests: [{ ...request, updated_at: "2099-10-02T00:00:00Z" }], has_more: true });
  fireEvent.click(screen.getByRole("button", { name: "Try again" })); await screen.findByRole("heading", { name: "Workshop" });
  expect(screen.getByText("No technical notes.")).toBeTruthy(); expect(screen.getByText(/Last status update/)).toBeTruthy();
  api.mockResolvedValueOnce({ requests: [], has_more: false }); fireEvent.click(screen.getByRole("button", { name: "Next" })); await screen.findByText("No equipment requests on this page.");
  api.mockResolvedValueOnce({ requests: [request], has_more: true }); fireEvent.click(screen.getByRole("button", { name: "Previous" })); await screen.findByRole("heading", { name: "Workshop" });
  expect(api.mock.calls.map(([p]) => p)).toEqual(["/equipment/requests?page=1", "/equipment/requests?page=1", "/equipment/requests?page=2", "/equipment/requests?page=1"]);
});
it("confirmation refresh recovers from an unstructured failure and accepts legacy notices", async () => {
  api.mockRejectedValueOnce("offline"); render(<Confirmations />); expect((await screen.findByRole("alert")).textContent).toBe("Could not load registration confirmations.");
  api.mockResolvedValueOnce({ confirmations: [{ id: 1, event_id: "event", event: null, message: "Registered", created_at: "2099-10-01T00:00:00Z" }] });
  fireEvent.click(screen.getByRole("button", { name: "Refresh confirmations" })); await screen.findByRole("heading", { name: "Registration confirmed" }); expect(screen.getByRole("link").getAttribute("href")).toContain("/events/browse/event");
});
it.each([Browse, Requests, Confirmations])("ignores a successful list response after leaving the page", async Component => {
  state.role = Component === Requests ? "Tech Support" : "Attendee";
  const pending = deferred<object>(); api.mockReturnValue(pending.promise); const view = render(<Component />); view.unmount();
  await act(async () => pending.resolve({ offers: [], requests: [], confirmations: [] })); expect(screen.queryByRole("heading")).toBeNull();
});
it("equipment catalogue opens and dismisses its availability modal", async () => {
  state.role = "Coordinator"; api.mockResolvedValue({ events: [] }); api.mockResolvedValueOnce({ equipment: [{ id: "mic", equipment_type: "Microphone", description: "Wireless", location: "Store", total_quantity: 5, usable_quantity: 5, updated_by: 2, updated_at: "2099-10-01T00:00:00Z", operational_status: "Operational" }], page: 1, has_more: false });
  render(<Equipment />); await screen.findByRole("heading", { name: "Microphone" });
  fireEvent.click(screen.getByRole("button", { name: /Check availability/ })); await screen.findByRole("dialog");
  fireEvent.click(screen.getByRole("button", { name: "Close" })); await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it("equipment catalogue can navigate back from a later page", async () => {
  state.role = "Coordinator"; api.mockResolvedValueOnce({ equipment: [], has_more: true }); render(<Equipment />); await screen.findByText("No equipment on this page");
  api.mockResolvedValueOnce({ equipment: [], has_more: false }); fireEvent.click(screen.getByRole("button", { name: "Next" })); await screen.findByText("Page 2");
  api.mockResolvedValueOnce({ equipment: [], has_more: true }); fireEvent.click(screen.getByRole("button", { name: "Previous" })); await screen.findByText("Page 1"); expect(api.mock.calls[2][0]).toContain("page=1");
});
it("equipment catalogue displays the public reference for a newly numbered record", async () => {
  state.role = "Coordinator"; api.mockResolvedValue({ equipment: [{ id: "mic", reference: "EQP-007", equipment_type: "Microphone", description: "Wireless", location: "Store", total_quantity: 5, usable_quantity: 5, updated_at: "2099-10-01T00:00:00Z", created_at: "2099-10-01T00:00:00Z", operational_status: "Operational" }], page: 1, has_more: false }); render(<Equipment />); await screen.findByText(/EQP-007/);
});
