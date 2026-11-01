// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, deferred, fireEvent, render, screen, waitFor } from "../../scripts/testing/dom";
import { eventRecord } from "../../scripts/testing/records";
import { apiRequest } from "@/lib/api";
import { loadSwitcherState } from "@/lib/dev-switcher";
import Feed from "./notifications-feed";
import Managed from "./events/managed/page";
import Mine from "./events/mine/page";
import Safety from "./events/safety/page";
import Drafts from "./events/drafts/page";
import Draft from "./events/drafts/[eventId]/page";
import EquipmentWorkspace from "./equipment/equipment-workspace";
import VenueWorkspace from "./venues/venue-workspace";
import NewEvent from "./events/new/page";
const state = vi.hoisted(() => ({ role: null as string | null, loading: false, signedOut: false, update: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/", useParams: () => ({ eventId: "event" }), useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/use-acting-role", () => ({ useActingRole: () => [state.role, state.update, state.loading, state.signedOut, 1] }));
vi.mock("@/lib/api", async original => ({ ...await original<object>(), apiRequest: vi.fn() }));
vi.mock("@/lib/dev-switcher", () => ({ loadSwitcherState: vi.fn() }));
const api = vi.mocked(apiRequest);
beforeEach(() => { vi.resetAllMocks(); state.role = null; state.loading = false; state.signedOut = false; vi.mocked(loadSwitcherState).mockResolvedValue({ visible: true, users: [], user: null }); });
afterEach(() => vi.unstubAllEnvs());
it("development Home explains how to select an identity", async () => {
  vi.stubEnv("NODE_ENV", "development"); const { default: Home } = await import("./page"); render(<Home />);
  expect(await screen.findByText("Select a role above to see what it can do.")).toBeTruthy(); expect(await screen.findByLabelText("Act as")).toBeTruthy();
});
it("a newly introduced role receives a safe Home feed until its actions exist", async () => {
  state.role = "Guest Reviewer"; api.mockResolvedValue({ notifications: [] }); const { default: Home } = await import("./page"); render(<Home />);
  await screen.findByText("No notifications yet."); expect(screen.getByText(/No actions are available for the/)).toBeTruthy(); expect(screen.queryByRole("region", { name: "Quick actions" })).toBeNull();
});
it.each(["equipment", "venues", "event"])("development %s workspace allows selecting an account", async area => {
  vi.stubEnv("NODE_ENV", "development");
  render(area === "equipment" ? <EquipmentWorkspace title="Equipment" description="Catalogue">{() => "Records"}</EquipmentWorkspace> : area === "venues" ? <VenueWorkspace title="Venues" description="Catalogue">{() => "Records"}</VenueWorkspace> : <NewEvent />);
  await screen.findByLabelText("Act as"); expect(screen.queryByText("Records")).toBeNull();
  if (area === "event") expect(screen.getByText(/above to start a request/)).toBeTruthy();
});
it("the default notification audience includes clarification requests", async () => {
  api.mockResolvedValue({ notifications: [{ id: 1, event_id: "event", notification_type: "event_clarification", message: "Please explain", created_at: "2099-10-01T00:00:00Z", event: { title: "Workshop" } }] }); render(<Feed />);
  await screen.findByText("Please explain"); expect(screen.getByText("Clarification requested")).toBeTruthy();
});
it("notification failures retain an explicit recovery action", async () => {
  api.mockRejectedValue("offline"); render(<Feed />); expect((await screen.findByRole("alert")).textContent).toBe("Could not load notifications.");
  api.mockResolvedValueOnce({ notifications: [] }); fireEvent.click(screen.getByRole("button", { name: "Refresh" })); await screen.findByText("No notifications yet.");
});
it.each([false, true])("notification responses cannot revive a departed feed: rejects=%s", async rejects => {
  const pending = deferred<object>(); api.mockReturnValue(pending.promise); const view = render(<Feed />); const signal = api.mock.calls[0][1]!.signal!; view.unmount();
  await act(async () => { if (rejects) pending.reject("offline"); else pending.resolve({ notifications: [] }); }); expect(signal.aborted).toBe(true); expect(screen.queryByRole("alert")).toBeNull();
});
const legacyEvent = { ...eventRecord, reference: undefined, title: "", category: null, event_datetime: null, request_status: undefined };
it("managed events retain useful fallbacks for incomplete historical records", async () => {
  state.role = "Coordinator"; api.mockResolvedValue({ events: [{ ...legacyEvent, is_mine: true }] }); render(<Managed />);
  await screen.findByText("Untitled event request"); expect(screen.getByText("Category not provided")).toBeTruthy(); expect(screen.getByRole("link", { name: /Untitled event request/ }).getAttribute("href")).toBe(`/events/${eventRecord.id}`);
});
it("organiser requests classify historical records using status when request_status is absent", async () => {
  state.role = "Organiser"; api.mockResolvedValue({ events: [legacyEvent, { ...legacyEvent, id: "past", title: "Past", status: "Completed" }, { ...legacyEvent, id: "draft", title: "Private draft", status: "Draft" }] }); render(<Mine />);
  await screen.findByText("Untitled event request"); expect(screen.getAllByText("Event date not provided")).toHaveLength(2); expect(screen.getByText("Past")).toBeTruthy(); expect(screen.queryByText("Private draft")).toBeNull();
});
it.each([false, true])("unknown organiser identity remains private: signedOut=%s", signedOut => {
  state.signedOut = signedOut; render(<Mine />); expect(screen.getByRole("alert").textContent).toContain(signedOut ? "Sign in as an Organiser" : "Could not verify your account"); expect(api).not.toHaveBeenCalled(); expect(screen.getByRole("link", { name: "Go to sign in" })).toBeTruthy();
});
it("safety queue shows an explicit missing date for a legacy event", async () => {
  state.role = "Safety Officer"; api.mockResolvedValue({ events: [{ ...legacyEvent, title: "Safety", status: "Confirmed" }] }); render(<Safety />); await screen.findByText("Date not provided");
});
it("legacy draft lists retain editing links without a display reference", async () => {
  state.role = "Organiser"; api.mockResolvedValue({ events: [{ ...legacyEvent, id: "draft", status: "Draft" }] }); render(<Drafts />); await waitFor(() => expect(screen.getByRole("link", { name: /Untitled request/ }).getAttribute("href")).toBe("/events/drafts/draft"));
});
it("a legacy draft can be submitted and leaves the editable workspace", async () => {
  state.role = "Organiser"; api.mockResolvedValueOnce({ event: { ...eventRecord, status: "Draft", request_status: undefined } }); render(<Draft />);
  const submit = await screen.findByRole("button", { name: "Submit request" }); api.mockResolvedValueOnce({ event: { ...eventRecord, status: "Submitted", request_status: undefined } }); fireEvent.click(submit);
  await screen.findByText(/has been submitted/); expect(screen.queryByRole("button", { name: "Submit request" })).toBeNull();
});
it.each([[Managed, "Coordinator"], [Safety, "Safety Officer"], [Drafts, "Organiser"]] as const)("%s displays a persisted event reference", async (Component, role) => {
  state.role = role; api.mockResolvedValue({ events: [{ ...eventRecord, reference: "EVT-007", status: Component === Drafts ? "Draft" : Component === Safety ? "Confirmed" : "Planning", is_mine: true }] }); render(<Component />);
  await screen.findByText(/EVT-007/);
});
