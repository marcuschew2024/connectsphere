// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { act, deferred, fireEvent, render, screen, waitFor, within } from "../../../../../scripts/testing/dom";
import Page from "./page";
import { ApiError, apiRequest } from "@/lib/api";
vi.mock("next/navigation", () => ({ usePathname: () => "/venues/bookings/new", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/use-acting-role", () => ({ useActingRole: () => ["Coordinator"] }));
vi.mock("@/lib/api", async original => ({ ...await original<object>(), apiRequest: vi.fn() }));
const api = vi.mocked(apiRequest);
const event = { id: "event", title: "Workshop", status: "Planning", is_mine: true, event_datetime: "2099-10-20T06:00:00Z", expected_attendance: 20, venue_requirements: "Classroom", facility_requirements: "", accessibility_requirements: "" };
const venue = { id: "room", name: "Seminar room", capacity: 30, operating_hours: {} };
let events: object[], venues: object[], saveResult: object, failure: unknown;
function options() {
  api.mockImplementation(async (path, options) => {
    if (options?.method === "POST") { if (failure) throw failure; return saveResult; }
    if (path === "/events") return { events };
    if (path.startsWith("/venues?page=")) return { venues, has_more: false };
    return { suitability: { is_suitable: true, flags: [], checked_rules_count: 4 } };
  });
}
beforeEach(() => { vi.resetAllMocks(); events = [event]; venues = [venue]; saveResult = { booking: { id: "booking" } }; failure = null; options(); });
async function open() { render(<Page />); await screen.findByText("Seminar room · capacity 30"); await screen.findByRole("status", { name: "Venue suitability passed" }); }
function change(label: string | RegExp, value: string) { fireEvent.change(screen.getByLabelText(label), { target: { value } }); }
function submit() { fireEvent.submit(screen.getByRole("button", { name: /Submit booking request|Submitting/ }).closest("form")!); }
function timing() { change("Start", "2099-10-20T14:00"); change("End", "2099-10-20T15:00"); }
it.each([new ApiError("Unavailable", 503), new Error("network")])("explains an options failure: %s", async error => {
  api.mockRejectedValue(error); render(<Page />);
  expect((await screen.findByRole("alert")).textContent).toBe(error instanceof ApiError ? error.message : "Could not load booking options.");
});
it("does not submit without a selected venue", async () => {
  venues = []; events = []; render(<Page />); await screen.findByText("No venues available"); submit();
  expect((await screen.findByRole("alert")).textContent).toBe("Choose a venue.");
  expect(api.mock.calls.some(([, o]) => o?.method === "POST")).toBe(false);
});
it.each([
  ["Start", "", "valid start and end"], ["End", "", "valid start and end"],
  ["End", "2099-10-20T13:00", "after the start"], ["End", "2099-10-21T15:00", "same day"],
  [/Expected attendance/, "0", "whole-number attendance"], [/Expected attendance/, "1.5", "whole-number attendance"],
] as const)("rejects invalid %s %s without a write", async (label, value, message) => {
  await open(); timing(); change(label, value); submit();
  expect((await screen.findByRole("alert")).textContent).toContain(message);
  expect(api.mock.calls.some(([, o]) => o?.method === "POST")).toBe(false);
});
it.each([
  [{ monday: { opens: "09:00", closes: "17:00" } }, "14:00", "15:00", "closed on the selected day"],
  [{ tuesday: { opens: "09:00", closes: "17:00" } }, "08:00", "10:00", "opening hours"],
  [{ tuesday: { opens: "09:00", closes: "17:00" } }, "16:00", "18:00", "opening hours"],
] as const)("enforces the published opening-hours boundary: %s %s %s", async (hours, start, end, message) => {
  venues = [{ ...venue, operating_hours: hours }]; await open(); change("Start", `2099-10-20T${start}`); change("End", `2099-10-20T${end}`); submit();
  expect((await screen.findByRole("alert")).textContent).toContain(message);
  expect(api.mock.calls.some(([, o]) => o?.method === "POST")).toBe(false);
});
it("requires a layout after deselecting the event default", async () => {
  await open(); timing(); fireEvent.click(screen.getByRole("checkbox", { name: "Classroom" })); submit();
  expect((await screen.findByRole("alert")).textContent).toBe("Enter a layout.");
});
it("submits edited requirements, including custom values, without removed options", async () => {
  venues = [{ ...venue, operating_hours: { tuesday: { opens: "09:00", closes: "17:00" } } }]; await open(); timing();
  for (const name of ["Classroom", "Theatre"]) { fireEvent.click(screen.getByRole("checkbox", { name })); fireEvent.click(screen.getByRole("checkbox", { name })); }
  for (const [groupName, label, value] of [["Layout", "Other layouts", "Circle"], ["Facilities", "Other facilities", "Coffee"], ["Accessibility", "Other accessibility features", "Interpreter"]]) {
    const group = screen.getByRole("group", { name: new RegExp(groupName) });
    const other = within(group).getByRole("checkbox", { name: "Other" });
    fireEvent.click(other); change(label, `${value}, ${value.toLowerCase()}, `);
    fireEvent.keyDown(screen.getByLabelText(label), { key: "Enter" });
    expect(within(group).getByRole("button", { name: `Remove ${value}` })).toBeTruthy();
    fireEvent.click(other); fireEvent.click(other); change(label, value); fireEvent.keyDown(screen.getByLabelText(label), { key: "Enter" });
  }
  for (const groupName of ["Facilities", "Accessibility"]) {
    const checkbox = within(screen.getByRole("group", { name: groupName })).getAllByRole("checkbox")[0];
    fireEvent.click(checkbox); fireEvent.click(checkbox);
  }
  submit(); await screen.findByRole("heading", { name: "Booking request submitted" });
  const call = api.mock.calls.find(([, o]) => o?.method === "POST")!;
  expect(JSON.parse(call[1]!.body as string)).toMatchObject({ event_id: "event", venue_id: "room", layout: "Classroom, Circle", special_requirements: "Coffee, Interpreter" });
});
it.each([new ApiError("Conflict", 409, { event_id: "Not assigned" }), new Error("offline")])("retains entered booking details after save failure: %s", async error => {
  failure = error; await open(); timing(); submit();
  expect((await screen.findByRole("alert")).textContent).toBe(error instanceof ApiError ? "Conflict" : "Could not submit the booking request.");
  expect((screen.getByLabelText("End") as HTMLInputElement).value).toBe("2099-10-20T15:00");
  if (error instanceof ApiError) expect(screen.getByText("Not assigned")).toBeTruthy();
});
it("does not announce a saved request when the response lacks its reference", async () => {
  saveResult = { booking: {} }; await open(); timing(); submit(); await waitFor(() => expect((screen.getByRole("button", { name: "Submit booking request" }) as HTMLButtonElement).disabled).toBe(false));
  expect(screen.queryByText("Booking request submitted")).toBeNull();
});
it("changing event resets requirements, and a late suitability result cannot overwrite the new selection", async () => {
  events = [event, { ...event, id: "second", title: "Second", event_datetime: null, expected_attendance: null, venue_requirements: "Circle", facility_requirements: "Coffee", accessibility_requirements: "Interpreter" }];
  venues = [venue, { ...venue, id: "other", name: "Other room" }]; await open();
  const late = deferred<object>(); api.mockReturnValueOnce(late.promise);
  fireEvent.change(screen.getByRole("combobox", { name: /^Venue/ }), { target: { value: "other" } });
  fireEvent.change(screen.getByRole("combobox", { name: /^Event/ }), { target: { value: "second" } });
  await act(async () => late.resolve({ suitability: { is_suitable: false, flags: ["Stale warning"] } }));
  expect(screen.queryByText("Stale warning")).toBeNull(); expect((screen.getByLabelText("Start") as HTMLInputElement).value).toBe("");
  expect(within(screen.getByRole("group", { name: /Layout/ })).getByRole("button", { name: "Remove Circle" })).toBeTruthy();
});
it.each([new Error("offline"), new DOMException("aborted", "AbortError")])("allows manual planning when suitability fails: %s", async error => {
  const original = api.getMockImplementation()!;
  api.mockImplementation((path, options) => path.includes("/suitability/") ? Promise.reject(error) : original(path, options));
  render(<Page />); await screen.findByText("Seminar room · capacity 30"); await waitFor(() => expect(screen.queryByText("Checking venue suitability…")).toBeNull());
  expect(screen.queryByRole("region", { name: "Venue suitability advisory" })).toBeNull();
  timing(); submit(); await screen.findByText("Booking request submitted");
});
it("omitted booking times remain invalid instead of becoming dates from literal null text", async () => {
  await open(); for (const label of ["Start", "End"]) (screen.getByLabelText(label) as HTMLInputElement).disabled = true;
  submit(); expect((await screen.findByRole("alert")).textContent).toContain("valid start and end"); expect(api.mock.calls.some(([, o]) => o?.method === "POST")).toBe(false);
});
it("changing to an undated event clears previously entered booking times", async () => {
  events = [event, { ...event, id: "undated", title: "Undated", event_datetime: null }]; venues = [{ ...venue, operating_hours: undefined }]; await open(); timing(); change("Event", "undated");
  expect((screen.getByLabelText("Start") as HTMLInputElement).value).toBe(""); expect((screen.getByLabelText("End") as HTMLInputElement).value).toBe("");
  timing(); submit(); await screen.findByRole("heading", { name: "Booking request submitted" });
});
it("switching to another dated event prefills its own Singapore start and resets the end", async () => {
  events = [event, { ...event, id: "second", title: "Second", event_datetime: "2099-10-21T01:00:00Z" }]; await open(); timing(); change("Event", "second");
  expect((screen.getByLabelText("Start") as HTMLInputElement).value).toBe("2099-10-21T09:00"); expect((screen.getByLabelText("End") as HTMLInputElement).value).toBe("");
});
it("booking preserves canonical preset spelling and separate custom layouts", async () => {
  events = [{ ...event, venue_requirements: "cLaSsRoOm, Cabaret" }]; await open(); timing(); submit(); await screen.findByRole("heading", { name: "Booking request submitted" });
  expect(JSON.parse(api.mock.calls.find(([, options]) => options?.method === "POST")![1]!.body as string).layout).toBe("Classroom, Cabaret");
});
it("booking defaults follow the selected event's start and end", async () => {
  events = [{ ...event, event_end_datetime: "2099-10-20T07:00:00Z" }, { ...event, id: "second", title: "Second", event_datetime: "2099-10-21T01:00:00Z", event_end_datetime: "2099-10-21T03:00:00Z" }]; await open();
  expect((screen.getByLabelText("End") as HTMLInputElement).value).toBe("2099-10-20T15:00"); change("Event", "second"); expect((screen.getByLabelText("Start") as HTMLInputElement).value).toBe("2099-10-21T09:00"); expect((screen.getByLabelText("End") as HTMLInputElement).value).toBe("2099-10-21T11:00");
});
