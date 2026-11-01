// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "../../../scripts/testing/dom";
import { eventRecord as event } from "../../../scripts/testing/records";
import Create from "./new/event-request-form";
import Edit from "./[eventId]/event-edit-form";
import Resubmit from "./[eventId]/event-resubmit-form";
import { apiRequest, ApiError } from "@/lib/api";
vi.mock("@/lib/api", async original => ({ ...await original<object>(), apiRequest: vi.fn() }));
const api = vi.mocked(apiRequest), saved = vi.fn();
const clarification = { id: 1, event_id: "event", note: "Explain", requested_by: 2, requested_at: "2099-10-01T00:00:00Z", status: "Pending" as const, responded_by: null, responded_at: null };
beforeEach(() => { vi.resetAllMocks(); HTMLElement.prototype.scrollIntoView = vi.fn(); api.mockResolvedValue({ event, changed_fields: [], importance: "ordinary" }); });
const forms = [
  ["create", () => <Create canCreate onSaved={saved} />, /Preferred date/, "Submit request"],
  ["edit", () => <Edit event={event} onSaved={saved} />, /^Date/, "Save changes"],
  ["resubmit", () => <Resubmit event={event} clarification={clarification} onSaved={saved} />, /^Date/, "Revise and resubmit"],
] as const;
for (const [name, element, dateLabel, button] of forms) {
  function fill(date: string, start: string, end: string) {
    for (const [label, value] of [[dateLabel, date], [/Start time/, start], [/End time/, end]] as const) fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
  function submit() { fireEvent.submit(screen.getByRole("button", { name: button }).closest("form")!); }
  it.each(["14:00", "13:00"])(`${name} refuses end %s at or before start and allows correction`, async end => {
    render(element()); fill("2099-10-20", "14:00", end); submit(); expect(screen.getByText("Choose an end time after the start time.")).toBeTruthy(); expect(api).not.toHaveBeenCalled();
    fill("2099-10-20", "14:00", "15:00"); submit(); await waitFor(() => expect(saved).toHaveBeenCalled()); const body = JSON.parse(api.mock.calls[0][1]!.body as string);
    expect(body.event_datetime).toBe(new Date("2099-10-20T14:00").toISOString()); expect(body.event_end_datetime).toBe(new Date("2099-10-20T15:00").toISOString()); expect(body).not.toHaveProperty("event_date"); expect(body).not.toHaveProperty("event_start_time"); expect(body).not.toHaveProperty("event_end_time");
  });
  it.each([["23:58", "23:59"], ["", "23:59"], ["23:58", ""]])(`${name} rejects dates outside JavaScript's range (%s to %s) without writing`, (start, end) => {
    render(element()); fill("999999-12-31", start, end); submit(); if (start) expect(screen.getByText("Choose a valid date and time.")).toBeTruthy(); if (end) expect(screen.getByText("Choose a valid end time.")).toBeTruthy(); expect(api).not.toHaveBeenCalled();
  });
  it.each([["", "14:00", "15:00"], ["2099-10-20", "", ""], ["2099-10-20", "", "15:00"], ["2099-10-20", "14:00", ""]])(`${name} serializes partial scheduling values for server validation (%s %s %s)`, async (date, start, end) => {
    render(element()); fill(date, start, end); submit(); await waitFor(() => expect(saved).toHaveBeenCalled()); const body = JSON.parse(api.mock.calls[0][1]!.body as string);
    expect(body.event_datetime).toBe(date && start ? new Date(`${date}T${start}`).toISOString() : null); expect(body.event_end_datetime).toBe(date && end ? new Date(`${date}T${end}`).toISOString() : null);
  });
  it(`${name} treats omitted time controls as missing values`, async () => {
    render(element()); for (const label of [dateLabel, /Start time/, /End time/]) (screen.getByLabelText(label) as HTMLInputElement).disabled = true;
    submit(); await waitFor(() => expect(saved).toHaveBeenCalled()); expect(JSON.parse(api.mock.calls[0][1]!.body as string)).toMatchObject({ event_datetime: null, event_end_datetime: null });
  });
  it(`${name} displays the server end-time error without losing the user's input`, async () => {
    render(element()); fill("2099-10-20", "14:00", "15:00"); api.mockRejectedValue(new ApiError("Invalid", 400, { event_end_datetime: "Review event end" })); submit(); await screen.findByText("Review event end"); expect((screen.getByLabelText(/End time/) as HTMLInputElement).value).toBe("15:00"); expect(saved).not.toHaveBeenCalled();
  });
}
