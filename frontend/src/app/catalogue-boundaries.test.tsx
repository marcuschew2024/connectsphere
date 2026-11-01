// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { act, deferred, fireEvent, render, screen, waitFor, within } from "../../scripts/testing/dom";
import { eventRecord, equipmentRequest, venueRecord } from "../../scripts/testing/records";
import { apiRequest, ApiError } from "@/lib/api";
import EquipmentForm from "./equipment/equipment-form";
import NewRequest from "./equipment/requests/new/page";
import Request from "./equipment/requests/[requestId]/page";
import VenueForm from "./venues/new/venue-form";
import VenueEdit from "./venues/[venueId]/edit/page";
import Review from "./events/review/page";
import Supervised from "./events/supervised/page";
const state = vi.hoisted(() => ({ role: "Tech Support" }));
vi.mock("next/navigation", () => ({ usePathname: () => "/equipment", useParams: () => ({ venueId: "venue" }), useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/use-acting-role", () => ({ useActingRole: () => [state.role, vi.fn(), false, false, 2] }));
vi.mock("@/lib/api", async original => ({ ...await original<object>(), apiRequest: vi.fn() }));
const api = vi.mocked(apiRequest);
const params = Promise.resolve({ requestId: "request" });
beforeEach(() => { vi.resetAllMocks(); state.role = "Tech Support"; });
it.each([new Error("offline"), new ApiError("Invalid", 400, { equipment_type: "Type required", description: "Describe equipment", location: "Location required" })])("equipment keeps edits after a failed save and suppresses pending duplicates: %s", async failure => {
  const pending = deferred<object>(); api.mockReturnValue(pending.promise); render(<EquipmentForm />);
  fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Handheld" } });
  const form = screen.getByRole("button", { name: "Save equipment" }).closest("form")!;
  fireEvent.submit(form); fireEvent.submit(form); expect(api).toHaveBeenCalledTimes(1);
  await act(async () => pending.reject(failure)); await screen.findByRole("alert");
  expect((screen.getByLabelText("Description") as HTMLInputElement).value).toBe("Handheld");
  if (failure instanceof ApiError) expect(screen.getByText("Describe equipment")).toBeTruthy();
  else expect(screen.getByRole("link", { name: "Check catalogue" })).toBeTruthy();
});
it("venue custom requirements and closed days are persisted exactly once", async () => {
  render(<VenueForm />);
  for (const [toggle, label, value] of [["Facilities Other", "Other facilities", "Video wall"], ["Accessibility features Other", "Other accessibility features", "Tactile maps"], ["Supported layouts Other", "Other supported layouts", "Cabaret"]]) {
    fireEvent.click(screen.getByLabelText(toggle)); fireEvent.change(screen.getByLabelText(label), { target: { value } }); fireEvent.keyDown(screen.getByLabelText(label), { key: "Enter" });
  }
  fireEvent.click(screen.getByLabelText("monday open")); fireEvent.click(screen.getByLabelText("monday open")); fireEvent.click(screen.getByLabelText("tuesday open"));
  const pending = deferred<object>(); api.mockReturnValueOnce(pending.promise);
  const form = screen.getByRole("button", { name: "Save venue" }).closest("form")!;
  fireEvent.submit(form); fireEvent.submit(form); expect(api).toHaveBeenCalledTimes(1);
  expect(JSON.parse(api.mock.calls[0][1]!.body as string)).toMatchObject({ facilities: ["Video wall"], accessibility: ["Tactile maps"], supported_layouts: ["Cabaret"], operating_hours: { monday: { opens: "09:00", closes: "18:00" }, tuesday: null } });
  await act(async () => pending.resolve({ venue: venueRecord })); await screen.findByRole("heading", { name: "Venue added" });
});
it.each([new Error("offline"), new ApiError("Invalid", 400, { name: "Name required", location: "Location required", setup_time_minutes: "Invalid setup", turnaround_time_minutes: "Invalid turnaround", supported_layouts: "Choose a layout" })])("venue failure retains the form and connects field feedback: %s", async failure => {
  api.mockRejectedValue(failure); render(<VenueForm />); fireEvent.submit(screen.getByRole("button", { name: "Save venue" }).closest("form")!);
  await screen.findByRole("alert");
  if (failure instanceof ApiError) { expect(screen.getByLabelText("Setup buffer (mins)").getAttribute("aria-describedby")).toBe("setup_time_minutes-error"); expect(screen.getByText("Choose a layout")).toBeTruthy(); }
  else expect(screen.getByRole("alert").textContent).toContain("Check the catalogue");
});
it("venue editing explains an unavailable version migration instead of allowing unsafe writes", async () => {
  state.role = "Venue Staff"; api.mockResolvedValue({ venue: { ...venueRecord, revision: undefined } }); render(<VenueEdit />);
  expect((await screen.findByRole("alert")).textContent).toContain("Venue editing is not set up yet"); expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
});
it("coordinator review distinguishes owned requests from incomplete view-only records", async () => {
  state.role = "Coordinator"; api.mockResolvedValue({ events: [{ ...eventRecord, status: "Submitted", title: "", category: null, event_datetime: null, reference: undefined, is_mine: false }] });
  render(<Review />); await screen.findByText("Untitled event request");
  expect(screen.getByText(/Assigned to another coordinator/)).toBeTruthy(); expect(screen.queryByText("Open request →")).toBeNull(); expect(screen.getByText("Category not provided")).toBeTruthy();
});
it("lead can go back through the assignment queue without submitting an empty assignment", async () => {
  state.role = "Event Coordinator Lead";
  const events = Array.from({ length: 13 }, (_, i) => ({ ...eventRecord, id: `e${i}`, title: i ? `Request ${i}` : "", reference: undefined, status: "Submitted", request_status: "Submitted", coordinator_id: null, category: null, expected_attendance: null, submitted_at: null, event_datetime: null }));
  api.mockImplementation(async path => path === "/events" ? { events } : { coordinators: [{ id: 2, display_name: "Coordinator A" }] });
  render(<Supervised />); await screen.findByText("Untitled event request");
  let form = screen.getByRole("button", { name: "Assign Untitled event request" }).closest("form")!;
  fireEvent.submit(form); expect(api.mock.calls.filter(([, options]) => options?.method)).toHaveLength(0);
  const nav = screen.getByRole("navigation", { name: "Unassigned queue pages" }); fireEvent.click(within(nav).getByRole("button", { name: "Next" })); expect(screen.queryByText("Untitled event request")).toBeNull();
  fireEvent.click(within(nav).getByRole("button", { name: "Previous" })); expect(screen.getByText("Untitled event request")).toBeTruthy();
  form = screen.getByRole("button", { name: "Assign Untitled event request" }).closest("form")!;
  fireEvent.change(screen.getByLabelText("Assign Untitled event request to"), { target: { value: "2" } });
  const pending = deferred<object>(); api.mockReturnValueOnce(pending.promise); fireEvent.submit(form); fireEvent.submit(form);
  expect(api.mock.calls.filter(([, options]) => options?.method)).toHaveLength(1);
  await act(async () => pending.reject("connection lost")); expect((await screen.findByRole("alert")).textContent).toContain("Could not assign");
});
it("lead explains that the current coordinator is the only available coordinator", async () => {
  state.role = "Event Coordinator Lead"; api.mockImplementation(async path => path === "/events" ? { events: [{ ...eventRecord, reference: undefined }] } : { coordinators: [{ id: 2, display_name: "Coordinator A" }] });
  render(<Supervised />); await screen.findByText("No other Coordinator available"); expect(screen.getAllByText("1 event")).toHaveLength(2);
});
function requestOptions(path: string) { return path.includes("/requests/events") ? { events: [{ ...eventRecord }], has_more: false } : { equipment: [{ id: "mic", equipment_type: "Microphone", location: "Store", operational_status: "Operational" }], has_more: false }; }
it.each([new Error("offline"), new ApiError("Invalid", 400)])("equipment submission remains recoverable after %s and sends no duplicate", async failure => {
  state.role = "Coordinator"; api.mockImplementation(async path => requestOptions(path)); render(<NewRequest />);
  const button = await screen.findByRole("button", { name: "Submit equipment request" }); const pending = deferred<object>(); api.mockReturnValueOnce(pending.promise);
  fireEvent.submit(button.closest("form")!); fireEvent.submit(button.closest("form")!); expect(api.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1);
  await act(async () => pending.reject(failure)); await screen.findByRole("alert"); expect(screen.getByRole("link", { name: "Check requests" })).toBeTruthy();
});
it("equipment history includes saved reservation quantities and missing notes", async () => {
  api.mockImplementation(async path => path.includes("/history") ? { history: [{ revision: 1, from_status: "Requested", status: "Reserved", actor_name: "Tech", changed_at: "2099-10-01T00:00:00Z", notes: "", reservation_snapshot: { start_at: "2099-10-20T01:00:00Z", end_at: "2099-10-20T02:00:00Z", items: [{ equipment_type: "Microphone", quantity: 2 }] } }], has_more: false } : { request: { ...equipmentRequest, reported_status: "Reserved", items: equipmentRequest.items.map(item => ({ ...item, unusable_reserved_quantity: 2, technical_notes: "" })) } });
  await act(async () => { render(<Request params={params} />); }); await screen.findByText("Microphone: 2 reserved"); expect(screen.getByText("No update notes.")).toBeTruthy(); expect(screen.getAllByText(/units are on stock/).length).toBe(2);
});
it.each([new Error("offline"), new ApiError("Invalid", 400), new ApiError("Unavailable", 503)])("equipment status handles %s without blindly repeating writes", async failure => {
  api.mockImplementation(async path => path.includes("/history") ? { history: [], has_more: false } : { request: equipmentRequest });
  await act(async () => { render(<Request params={params} />); }); const form = await screen.findByRole("form", { name: "Update request status" });
  fireEvent.change(screen.getByLabelText("New status"), { target: { value: "Unavailable" } });
  const pending = deferred<object>(); api.mockReturnValueOnce(pending.promise); fireEvent.submit(form); fireEvent.submit(form); expect(api.mock.calls.filter(([, options]) => options?.method === "PATCH")).toHaveLength(1);
  await act(async () => pending.reject(failure)); await screen.findByRole("alert");
  const needsReload = !(failure instanceof ApiError) || failure.status >= 500;
  if (needsReload) { expect(screen.getByRole("button", { name: "Reload latest request" })).toBeTruthy(); fireEvent.submit(form); expect(api.mock.calls.filter(([, options]) => options?.method === "PATCH")).toHaveLength(1); }
  else await waitFor(() => expect((screen.getByRole("button", { name: "Save status" }) as HTMLButtonElement).disabled).toBe(false));
});
it("an omitted equipment quantity is sent for required-field validation as null", async () => {
  api.mockRejectedValue(new ApiError("Required", 400, { total_quantity: "Enter quantity" })); render(<EquipmentForm />); (screen.getByLabelText("Total quantity") as HTMLInputElement).disabled = true;
  fireEvent.submit(screen.getByRole("button", { name: "Save equipment" }).closest("form")!); await screen.findByText("Enter quantity"); expect(JSON.parse(api.mock.calls[0][1]!.body as string).total_quantity).toBeNull();
});
it("omitted optional venue buffers default to zero", async () => {
  api.mockResolvedValue({ venue: venueRecord }); render(<VenueForm />); for (const label of ["Setup buffer (mins)", "Turnaround buffer (mins)"]) (screen.getByLabelText(label) as HTMLInputElement).disabled = true;
  fireEvent.submit(screen.getByRole("button", { name: "Save venue" }).closest("form")!); await screen.findByRole("heading", { name: "Venue added" });
  expect(JSON.parse(api.mock.calls[0][1]!.body as string)).toMatchObject({ setup_time_minutes: 0, turnaround_time_minutes: 0 });
});
it.each([false, true])("new equipment request does not revive departed options: rejects=%s", async rejects => {
  state.role = "Coordinator"; const pending = deferred<object>(); api.mockReturnValue(pending.promise); const view = render(<NewRequest />); const signals = api.mock.calls.map(([, options]) => options!.signal!); view.unmount();
  await act(async () => { if (rejects) pending.reject(new Error("offline")); else pending.resolve({ events: [], equipment: [], has_more: false }); }); expect(signals.every(signal => signal.aborted)).toBe(true); expect(screen.queryByRole("alert")).toBeNull();
});
it("new equipment request can recover from an unexpected options failure", async () => {
  state.role = "Coordinator"; api.mockRejectedValueOnce(new Error("offline")); api.mockResolvedValue({ equipment: [], has_more: false }); render(<NewRequest />);
  expect((await screen.findByRole("alert")).textContent).toContain("Could not load request options.");
});
it.each([false, true])("new equipment request explains missing options: noEvents=%s", async noEvents => {
  state.role = "Coordinator"; api.mockImplementation(async path => path.includes("/requests/events") ? { events: noEvents ? [] : [eventRecord], has_more: false } : { equipment: [], has_more: false }); render(<NewRequest />);
  await screen.findByText(noEvents ? "No assigned events are in Planning. Approve an event before requesting equipment." : "The equipment catalogue is empty. Tech Support needs to add equipment first."); expect(screen.queryByRole("button", { name: "Submit equipment request" })).toBeNull();
});
it("equipment requests include events on later option pages", async () => {
  state.role = "Coordinator"; api.mockImplementation(async path => path.includes("/requests/events?page=1") ? { events: [], has_more: true } : requestOptions(path)); render(<NewRequest />);
  await screen.findByRole("option", { name: /Workshop/ }); expect(api.mock.calls.some(([path]) => path.includes("events?page=2"))).toBe(true);
});
it.each([false, true])("departed equipment history ignores late results: rejects=%s", async rejects => {
  const history = deferred<object>(); api.mockImplementation(path => path.includes("/history") ? history.promise : Promise.resolve({ request: equipmentRequest }));
  let view: ReturnType<typeof render>; await act(async () => { view = render(<Request params={params} />); }); await screen.findByText("Loading history…"); const signal = api.mock.calls.find(([path]) => path.includes("/history"))![1]!.signal!; view!.unmount();
  await act(async () => { if (rejects) history.reject(new Error("offline")); else history.resolve({ history: [], has_more: false }); }); expect(signal.aborted).toBe(true); expect(screen.queryByRole("alert")).toBeNull();
});
it("equipment history reports an unexpected failure without inventing an empty history", async () => {
  api.mockImplementation(async path => { if (path.includes("/history")) throw new Error("offline"); return { request: equipmentRequest }; }); await act(async () => { render(<Request params={params} />); });
  await screen.findByText("Could not load status history."); expect(screen.getByRole("button", { name: "Retry history" })).toBeTruthy(); expect(screen.queryByText("No status updates on this page.")).toBeNull();
});
it("a status response arriving during refresh cannot restore the old request snapshot", async () => {
  const pending = deferred<object>(), refresh = deferred<object>();
  api.mockImplementation(async path => path.includes("/history") ? { history: [], has_more: false } : { request: equipmentRequest }); await act(async () => { render(<Request params={params} />); });
  const form = await screen.findByRole("form", { name: "Update request status" }); fireEvent.change(screen.getByLabelText("New status"), { target: { value: "Unavailable" } }); api.mockReturnValueOnce(pending.promise); fireEvent.submit(form);
  api.mockReturnValueOnce(refresh.promise); fireEvent.click(screen.getByRole("button", { name: "Refresh request" })); await screen.findByText("Loading equipment request…");
  await act(async () => pending.resolve({ request: { status: "Unavailable", revision: 2 } })); expect(screen.getByText("Loading equipment request…")).toBeTruthy();
  await act(async () => refresh.resolve({ request: { ...equipmentRequest, revision: 3, status: "Requested", update_notes: "Newer arrangement" } })); await screen.findByText("Newer arrangement");
});
it("review queue shows the submitted request's public reference", async () => {
  state.role = "Coordinator"; api.mockResolvedValue({ events: [{ ...eventRecord, reference: "EVT-007", status: "Submitted", is_mine: true }] }); render(<Review />); await screen.findByText(/EVT-007/);
});
it("a single unusable reserved unit is described accurately", async () => {
  api.mockImplementation(async path => path.includes("/history") ? { history: [], has_more: false } : { request: { ...equipmentRequest, items: [{ ...equipmentRequest.items[0], unusable_reserved_quantity: 1 }] } }); await act(async () => { render(<Request params={params} />); });
  await screen.findByText(/1 reserved unit is on stock.*does not count/);
});
