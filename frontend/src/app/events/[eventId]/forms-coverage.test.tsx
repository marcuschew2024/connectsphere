// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, deferred, fireEvent, render, screen, waitFor } from "../../../../scripts/testing/dom";
import { eventRecord as event } from "../../../../scripts/testing/records";
import { ApiError, apiRequest } from "@/lib/api";
import Edit from "./event-edit-form";
import Clarify from "./event-clarification-form";
import Resubmit from "./event-resubmit-form";
import Confirm from "./event-confirm-form";
import Complete from "./event-complete-form";
import Decision from "./event-decision-form";
import Safety from "./event-safety-check-form";
import Policy from "./event-withdrawal-policy";
import Capacity from "./event-capacity-panel";
vi.mock("@/lib/api", async original => ({ ...await original<object>(), apiRequest: vi.fn() }));
const api = vi.mocked(apiRequest), saved = vi.fn();
const clarification = { id: 1, event_id: event.id, note: "More details", requested_by: 2, requested_at: "2099-10-01T00:00:00Z", status: "Pending" as const, responded_by: null, responded_at: null };
beforeEach(() => { vi.resetAllMocks(); api.mockResolvedValue({ event }); });
afterEach(() => vi.useRealTimers());
function input(label: string | RegExp, value: string) { fireEvent.change(screen.getByLabelText(label), { target: { value } }); }
function submit(name: string | RegExp) { fireEvent.submit(screen.getByRole("button", { name }).closest("form")!); }
const actions = [
  { name: "confirmation", element: () => <Confirm event={event} onSaved={saved} />, run: () => fireEvent.click(screen.getByRole("button", { name: "Confirm event" })), error: "Could not confirm the event." },
  { name: "decision", element: () => <Decision event={{ ...event, status: "Submitted" }} onSaved={saved} />, run: () => fireEvent.click(screen.getByRole("button", { name: "Approve" })), error: "Could not save the decision." },
  { name: "clarification", element: () => <Clarify event={{ ...event, status: "Submitted" }} onRequested={saved} />, run: () => { input("Clarification note", "Please explain"); fireEvent.click(screen.getByRole("button", { name: "Return for clarification" })); }, error: "Could not request clarification." },
  { name: "completion", element: () => <Complete event={{ ...event, status: "Preparation" }} onCompleted={saved} />, run: () => { fireEvent.click(screen.getByRole("button", { name: "Mark event complete" })); fireEvent.click(screen.getByRole("button", { name: "Confirm completion" })); }, error: "Could not complete the event." },
  { name: "safety", element: () => <Safety event={{ ...event, status: "Confirmed" }} onSaved={saved} />, run: () => fireEvent.click(screen.getByRole("button", { name: "Approve for preparation" })), error: "Could not record the safety decision." },
];
for (const action of actions) {
  it.each([new ApiError("Request refused", 409), new Error("offline")])(`${action.name} explains failure without claiming a saved change: %s`, async error => {
    api.mockRejectedValue(error); render(action.element()); action.run();
    expect((await screen.findByRole("alert")).textContent).toBe(error instanceof ApiError ? "Request refused" : action.error);
    expect(saved).not.toHaveBeenCalled();
  });
}
it("hides lifecycle forms outside their permitted state", () => {
  const closed = { ...event, status: "Completed" as const };
  render(<><Confirm event={closed} onSaved={saved} /><Complete event={closed} onCompleted={saved} /><Decision event={closed} onSaved={saved} /><Clarify event={closed} onRequested={saved} /><Safety event={closed} onSaved={saved} /><Edit event={closed} onSaved={saved} /></>);
  expect(screen.queryByRole("button")).toBeNull(); expect(screen.getByText(/Direct editing is only available/)).toBeTruthy();
});
it.each(["Request changes", "Reject"])("safety %s requires and persists a trimmed reason", async name => {
  render(<Safety event={{ ...event, status: "Confirmed", expected_attendance: null, venue_requirements: null, facility_requirements: null, accessibility_requirements: null, equipment_requirements: null }} onSaved={saved} />);
  expect(screen.getAllByText("Not provided")).toHaveLength(5);
  fireEvent.click(screen.getByRole("button", { name })); expect(screen.getByRole("alert").textContent).toContain("reason is required"); expect(api).not.toHaveBeenCalled();
  input(/Reason \(required/, "  Exit blocked  "); fireEvent.click(screen.getByRole("button", { name })); await waitFor(() => expect(saved).toHaveBeenCalledWith(event));
  expect(JSON.parse(api.mock.calls[0][1]!.body as string)).toEqual({ decision: name === "Reject" ? "reject" : "request_changes", reason: "Exit blocked" });
});
it.each([null, "invalid"])("clears unreadable stored date %s in edit/resubmit forms", value => {
  const view = render(<Edit event={{ ...event, event_datetime: value }} onSaved={saved} />);
  expect((screen.getByLabelText(/Date and time/) as HTMLInputElement).value).toBe(""); view.unmount();
  render(<Resubmit event={{ ...event, event_datetime: value }} clarification={clarification} onSaved={saved} />);
  expect((screen.getByLabelText(/Date and time/) as HTMLInputElement).value).toBe("");
});
it.each([[[], "ordinary", "No changes to save."], [["expected_attendance"], "important", "Recorded as an important change"], [["title"], "ordinary", "Recorded as an ordinary change"]] as const)("edit reports the actual saved change classification %s %s", async (fields, importance, message) => {
  api.mockResolvedValue({ event, changed_fields: fields, importance }); render(<Edit event={event} onSaved={saved} />); submit("Save changes");
  expect((await screen.findByRole("status")).textContent).toContain(message); expect(saved).toHaveBeenCalledWith(event);
});
it.each(["edit", "resubmit"])("%s preserves empty values as null and prevents duplicate pending submissions", async kind => {
  const pending = deferred<object>(); api.mockReturnValue(pending.promise);
  render(kind === "edit" ? <Edit event={event} onSaved={saved} /> : <Resubmit event={event} clarification={clarification} onSaved={saved} />);
  input(/Date and time/, ""); input(/Expected attendance/, "");
  const name = kind === "edit" ? "Save changes" : "Revise and resubmit";
  const form = screen.getByRole("button", { name }).closest("form")!; fireEvent.submit(form); fireEvent.submit(form);
  expect(api).toHaveBeenCalledTimes(1); expect(JSON.parse(api.mock.calls[0][1]!.body as string)).toMatchObject({ event_datetime: null, expected_attendance: null });
  await act(async () => pending.resolve({ event, changed_fields: [], importance: "ordinary" })); expect(saved).toHaveBeenCalledTimes(1);
});
for (const kind of ["edit", "resubmit"]) {
  it.each([new ApiError("Invalid fields", 400, { title: "Bad title", description: "Bad description", event_datetime: "Bad time", expected_attendance: "Bad attendance", equipment_requirements: "Bad equipment" }), new Error("offline")])(`${kind} shows field errors and retains form data: %s`, async error => {
    api.mockRejectedValue(error); render(kind === "edit" ? <Edit event={event} onSaved={saved} /> : <Resubmit event={event} clarification={clarification} onSaved={saved} />);
    submit(kind === "edit" ? "Save changes" : "Revise and resubmit");
    expect((await screen.findByRole("alert")).textContent).toContain(error instanceof ApiError ? "Invalid fields" : kind === "edit" ? "Could not save" : "Could not resubmit");
    if (error instanceof ApiError) expect(screen.getByText("Bad title")).toBeTruthy(); expect(saved).not.toHaveBeenCalled();
  });
}
it("capacity keeps the value and explains an unexpected save failure", async () => {
  api.mockRejectedValue(new Error("offline")); render(<Capacity event={event} actingRole="Organiser" onSaved={saved} />);
  input("Maximum attendees", "30"); submit("Save capacity"); expect((await screen.findByRole("alert")).textContent).toContain("Could not confirm the capacity change"); expect(saved).not.toHaveBeenCalled();
});
it.each([false, true])("ignores a departed withdrawal-policy result: rejects=%s", async rejects => {
  const pending = deferred<object>(); api.mockReturnValue(pending.promise); const view = render(<Policy eventId="event" />); view.unmount();
  await act(async () => { if (rejects) pending.reject(new Error("late")); else pending.resolve({ withdrawal_policy: { closes_at: null, can_edit: true } }); });
  expect(screen.queryByRole("alert")).toBeNull();
});
it("withdrawal load failure can reload the persisted conditions", async () => {
  api.mockRejectedValueOnce(new Error("offline")); render(<Policy eventId="event" />); await screen.findByRole("alert");
  api.mockResolvedValueOnce({ withdrawal_policy: { closes_at: null, can_edit: false } }); fireEvent.click(screen.getByRole("button", { name: "Reload conditions" }));
  await screen.findByText(/Withdrawal is allowed until the event starts.*Conditions are locked/); expect(screen.queryByRole("alert")).toBeNull();
});
it.each([new Error("Lost response"), "network unavailable"])("withdrawal save failure keeps the deadline and allows recovery: %s", async error => {
  api.mockResolvedValueOnce({ withdrawal_policy: { closes_at: null, can_edit: true } }); render(<Policy eventId="event" />);
  await screen.findByLabelText(/Withdrawal deadline/); input(/Withdrawal deadline/, "2099-10-19T12:00"); api.mockRejectedValueOnce(error); submit("Save withdrawal conditions");
  expect((await screen.findByRole("alert")).textContent).toBe(error instanceof Error ? error.message : "Could not confirm the change. Reload conditions before retrying.");
  expect((screen.getByLabelText(/Withdrawal deadline/) as HTMLInputElement).value).toBe("2099-10-19T12:00");
});
it("clearing a withdrawal deadline saves null, once while pending", async () => {
  api.mockResolvedValueOnce({ withdrawal_policy: { closes_at: "2099-10-19T06:00:00Z", can_edit: true } }); render(<Policy eventId="event" />); await screen.findByLabelText(/Withdrawal deadline/);
  input(/Withdrawal deadline/, ""); const pending = deferred<object>(); api.mockReturnValueOnce(pending.promise); const form = screen.getByRole("button", { name: "Save withdrawal conditions" }).closest("form")!;
  fireEvent.submit(form); fireEvent.submit(form); expect(api.mock.calls.filter(([, o]) => o?.method === "PUT")).toHaveLength(1);
  expect(JSON.parse(api.mock.calls[1][1]!.body as string)).toEqual({ closes_at: null });
  await act(async () => pending.resolve({ withdrawal_policy: { closes_at: null, can_edit: true } })); await screen.findByText("Withdrawal conditions saved.");
});
it.each(["load", "save"])("withdrawal %s aborts a stalled request and offers recovery", async phase => {
  vi.useFakeTimers(); const hang = (_path: string, options?: RequestInit) => new Promise((_resolve, reject) => options?.signal?.addEventListener("abort", () => reject(new Error("Timed out"))));
  if (phase === "load") api.mockImplementation(hang); else api.mockResolvedValueOnce({ withdrawal_policy: { closes_at: null, can_edit: true } });
  render(<Policy eventId="event" />); await act(async () => {});
  if (phase === "save") { api.mockImplementation(hang); submit("Save withdrawal conditions"); }
  await act(async () => vi.advanceTimersByTimeAsync(phase === "load" ? 8000 : 10000));
  expect(screen.getByRole("alert").textContent).toContain(phase === "load" ? "Could not load" : "Timed out");
});

it("direct event editing rejects an HTML date beyond JavaScript's supported range", () => {
  render(<Edit event={event} onSaved={saved} />); input(/Date and time/, "999999-12-31T23:59"); submit("Save changes");
  expect(screen.getByText("Choose a valid date and time.")).toBeTruthy(); expect(api).not.toHaveBeenCalled();
});
it("direct event editing explains a partially typed invalid number", () => {
  render(<Edit event={event} onSaved={saved} />);
  // JSDOM cannot represent the browser's partial-number editing state (for example '1e').
  const number = screen.getByLabelText(/Expected attendance/) as HTMLInputElement;
  vi.spyOn(number, "validity", "get").mockReturnValue({ ...number.validity, badInput: true });
  submit("Save changes"); expect(screen.getByText("Enter a whole number between 1 and 10,000.")).toBeTruthy(); expect(api).not.toHaveBeenCalled();
});
it("one confirmation action cannot send two requests before React commits the busy state", async () => {
  const pending = deferred<object>(); api.mockReturnValue(pending.promise); render(<Confirm event={event} onSaved={saved} />);
  const button = screen.getByRole("button", { name: "Confirm event" });
  act(() => { fireEvent.click(button); fireEvent.click(button); });
  expect(api).toHaveBeenCalledTimes(1); await act(async () => pending.resolve({ event }));
});

for (const action of actions) {
  it(`${action.name} deduplicates two activations before the busy render`, async () => {
    const pending = deferred<object>(); api.mockReturnValue(pending.promise); render(action.element());
    if (action.name === "clarification") input("Clarification note", "Please explain");
    if (action.name === "completion") fireEvent.click(screen.getByRole("button", { name: "Mark event complete" }));
    const names: Record<string, string> = { confirmation: "Confirm event", decision: "Approve", clarification: "Return for clarification", completion: "Confirm completion", safety: "Approve for preparation" };
    const button = screen.getByRole("button", { name: names[action.name] });
    act(() => { fireEvent.click(button); fireEvent.click(button); }); expect(api).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve({ event, clarification })); expect(saved).toHaveBeenCalledTimes(1);
  });
}
it.each(["edit", "resubmit"])("%s normalises omitted optional controls as null instead of literal null text", async kind => {
  const legacy = { ...event, title: null, category: null, purpose: null, description: null };
  render(kind === "edit" ? <Edit event={legacy} onSaved={saved} /> : <Resubmit event={legacy} clarification={clarification} onSaved={saved} />);
  // Disabled controls are omitted by native FormData. Exercise that serialization boundary.
  (screen.getByLabelText(/Date and time/) as HTMLInputElement).disabled = true;
  (screen.getByLabelText(/Expected attendance/) as HTMLInputElement).disabled = true;
  api.mockResolvedValue({ event, changed_fields: [], importance: "ordinary" }); submit(kind === "edit" ? "Save changes" : "Revise and resubmit");
  await waitFor(() => expect(saved).toHaveBeenCalled()); expect(JSON.parse(api.mock.calls[0][1]!.body as string)).toMatchObject({ event_datetime: null, expected_attendance: null });
});
