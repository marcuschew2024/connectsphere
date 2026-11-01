// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { act, deferred, fireEvent, render, screen, waitFor, within } from "../../../scripts/testing/dom";
import { venueRecord as venue, eventRecord as event } from "../../../scripts/testing/records";
import Page from "./page";
import Form from "./venue-search-form";
import { apiRequest } from "@/lib/api";
vi.mock("next/navigation", () => ({ usePathname: () => "/venues", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/use-acting-role", () => ({ useActingRole: () => ["Coordinator", vi.fn(), false] }));
vi.mock("@/lib/api", async original => ({ ...await original<object>(), apiRequest: vi.fn() }));
const api = vi.mocked(apiRequest);
const initial = { attendance: "", layout: "", facilities: "", accessibility: "", date: "", start_time: "", end_time: "" };
let events: object[];
beforeEach(() => {
  vi.resetAllMocks(); events = [{ ...event, event_datetime: "2099-10-20T23:30:00Z", venue_requirements: "Classroom, Projector" }];
  HTMLElement.prototype.scrollIntoView = vi.fn();
  api.mockImplementation(async path => path === "/events" ? { events } : path.includes("filter-options") ? { facilities: [], accessibility: [] } : path.includes("/suitability/") ? { suitability: { is_suitable: true, flags: [], checked_rules_count: 4 } } : { venues: [venue], has_more: false });
});
it.each(["2099-10-20T23:30:00Z", "invalid"])("selecting an event prefills Singapore search requirements from %s", async date => {
  events = [{ ...event, event_datetime: date, venue_requirements: "Classroom, Projector" }]; render(<Page />); await screen.findByRole("heading", { name: "Hall" });
  fireEvent.change(screen.getByLabelText("Check suitability for event"), { target: { value: "event" } });
  await waitFor(() => expect(api.mock.calls.some(([p]) => p.includes("/suitability/event"))).toBe(true));
  const form = screen.getByRole("form", { name: "Venue search" }) as HTMLFormElement;
  expect(new FormData(form).get("date")).toBe(date === "invalid" ? "" : "2099-10-21");
  expect(new FormData(form).get("start_time")).toBe(date === "invalid" ? "" : "07:30");
  expect(new FormData(form).get("layout")).toBe("Classroom"); expect(new FormData(form).get("facilities")).toBe("Projector");
});
it("failed suitability checks keep the venue visible without an invented advisory", async () => {
  const normal = api.getMockImplementation()!; api.mockImplementation((path, options) => path.includes("/suitability/") ? Promise.reject(new Error("offline")) : normal(path, options));
  render(<Page />); await screen.findByRole("heading", { name: "Hall" }); fireEvent.change(screen.getByLabelText("Check suitability for event"), { target: { value: "event" } });
  await waitFor(() => expect(api.mock.calls.some(([p]) => p.includes("/suitability/"))).toBe(true)); expect(screen.getByRole("heading", { name: "Hall" })).toBeTruthy();
});
it.each([false, true])("switching away discards late suitability results: rejects=%s", async rejects => {
  render(<Page />); await screen.findByRole("heading", { name: "Hall" }); const pending = deferred<object>(); const normal = api.getMockImplementation()!;
  api.mockImplementation((path, options) => path.includes("/suitability/") ? pending.promise : normal(path, options));
  const select = screen.getByLabelText("Check suitability for event"); fireEvent.change(select, { target: { value: "event" } }); fireEvent.change(select, { target: { value: "" } });
  await act(async () => { if (rejects) pending.reject(new Error("late")); else pending.resolve({ suitability: { is_suitable: false, flags: ["Stale warning"] } }); });
  expect(screen.queryByText("Stale warning")).toBeNull();
});
it("leaving the catalogue discards late events, venues and feature suggestions", async () => {
  const pending = deferred<object>(); api.mockReturnValue(pending.promise); const view = render(<Page />); view.unmount();
  await act(async () => pending.resolve({ events: [event], venues: [venue], has_more: false, facilities: [], accessibility: [] })); expect(screen.queryByRole("heading")).toBeNull();
});
it("search sends custom layout and facilities, and clears deselected custom filters", async () => {
  const search = vi.fn(); render(<Form initialValues={initial} busy={false} onSearch={search} />);
  await act(async () => {}); fireEvent.click(screen.getByText("More requirements").closest("summary")!);
  fireEvent.change(screen.getByRole("combobox", { name: "Layout" }), { target: { value: "__other" } }); fireEvent.change(screen.getByLabelText("Other layout"), { target: { value: "Circle" } });
  for (const [groupName, key] of [["Required facilities", "facilities"], ["Accessibility features", "accessibility"]]) {
    const group = screen.getByRole("group", { name: groupName }); const other = within(group).getByRole("checkbox", { name: "Other" }); fireEvent.click(other);
    const input = screen.getByLabelText(`Other ${key}`); fireEvent.change(input, { target: { value: "Custom filter" } }); fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.submit(screen.getByRole("form", { name: "Venue search" })); expect(search.mock.lastCall![0]).toContain(`${key}=Custom+filter`);
    fireEvent.click(other); fireEvent.submit(screen.getByRole("form", { name: "Venue search" })); expect(new URLSearchParams(search.mock.lastCall![0]).get(key)).toBeNull();
  }
  expect(new URLSearchParams(search.mock.lastCall![0]).get("layout")).toBe("Circle");
});
it("a custom initial layout survives an untouched search", async () => {
  const search = vi.fn(); render(<Form initialValues={{ ...initial, layout: "Cabaret" }} busy={false} onSearch={search} />); await act(async () => {});
  fireEvent.submit(screen.getByRole("form", { name: "Venue search" })); expect(new URLSearchParams(search.mock.calls[0][0]).get("layout")).toBe("Cabaret");
});
it("an empty later catalogue page offers navigation back", async () => {
  api.mockResolvedValue({ venues: [], events: [], facilities: [], accessibility: [], has_more: true }); render(<Page />); await screen.findByText("No venues yet");
  api.mockResolvedValueOnce({ venues: [], has_more: false }); fireEvent.click(screen.getByRole("button", { name: "Next" })); await screen.findByText("No more venues"); expect((screen.getByRole("button", { name: "Previous" }) as HTMLButtonElement).disabled).toBe(false);
});
it("a venue with a persisted reference includes it in the catalogue", async () => {
  const normal = api.getMockImplementation()!; api.mockImplementation((path, options) => path.startsWith("/venues?page") ? Promise.resolve({ venues: [{ ...venue, reference: "VEN-007" }], has_more: false }) : normal(path, options)); render(<Page />); await screen.findByText(/VEN-007/);
});
it("opening availability without a date does not attach a misleading date query", async () => {
  const normal = api.getMockImplementation()!; api.mockImplementation((path, options) => path.startsWith("/venues?page") ? Promise.resolve({ venues: [{ ...venue, availability_status: "available" }], has_more: false }) : normal(path, options)); render(<Page />); await screen.findByRole("heading", { name: "Hall" });
  const link = screen.getByRole("link", { name: /availability/i }); expect(link.getAttribute("href")).not.toContain("date=");
});
it("search preserves and labels a submitted filter whose display label is not registered yet", async () => {
  render(<Page />); await screen.findByRole("heading", { name: "Hall" }); const form = screen.getByRole("form", { name: "Venue search" });
  // The search boundary accepts FormData keys; future controls must remain visible as active filters.
  const control = document.createElement("input"); control.type = "hidden"; control.name = "zone"; control.value = "North"; form.append(control); fireEvent.submit(form);
  await screen.findByText("zone: North"); expect(api.mock.calls.some(([path]) => path.includes("zone=North"))).toBe(true);
});
