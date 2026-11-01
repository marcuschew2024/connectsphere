// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { act, deferred, fireEvent, render, screen } from "../../../../scripts/testing/dom";
import Form from "./event-request-form";
import { apiRequest, ApiError } from "@/lib/api";
import { eventRecord as event } from "../../../../scripts/testing/records";
vi.mock("@/lib/api", async original => ({ ...await original<object>(), apiRequest: vi.fn() }));
const api = vi.mocked(apiRequest);
beforeEach(() => { vi.resetAllMocks(); HTMLElement.prototype.scrollIntoView = vi.fn(); });
function form() { return screen.getByRole("button", { name: "Submit request" }).closest("form")!; }
it("request creation rejects an unsupported date before calling the API", () => {
  render(<Form canCreate />); fireEvent.change(screen.getByLabelText(/Preferred date/i), { target: { value: "999999-12-31" } }); fireEvent.change(screen.getByLabelText(/Start time/), { target: { value: "23:59" } }); fireEvent.submit(form());
  expect(screen.getByText("Choose a valid date and time.")).toBeTruthy(); expect(api).not.toHaveBeenCalled();
});
it("request creation explains a browser partial-number input", () => {
  render(<Form canCreate />); const number = screen.getByLabelText(/Expected attendance/) as HTMLInputElement;
  // JSDOM lacks the native partial-number editor state, so provide its validity result.
  vi.spyOn(number, "validity", "get").mockReturnValue({ ...number.validity, badInput: true }); fireEvent.submit(form());
  expect(screen.getByText("Enter a whole number between 1 and 10,000.")).toBeTruthy(); expect(api).not.toHaveBeenCalled();
});
it.each([new Error("offline"), new ApiError("Invalid", 400, { title: "Title error", description: "Description error", event_datetime: "Time error", equipment_requirements: "Equipment error" })])("request save failure preserves fields and reports uncertainty: %s", async error => {
  api.mockRejectedValue(error); render(<Form canCreate />); fireEvent.submit(form());
  expect((await screen.findByRole("alert")).textContent).toContain(error instanceof ApiError ? "Invalid" : "Could not confirm that the request was saved");
  if (error instanceof ApiError) expect(screen.getByText("Equipment error")).toBeTruthy();
});
it("a pending request cannot be submitted again", async () => {
  const pending = deferred<object>(); api.mockReturnValue(pending.promise); render(<Form canCreate />); const element = form(); fireEvent.submit(element); fireEvent.submit(element); expect(api).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve({ event: { ...event, status: "Draft", registration_capacity: null } })); expect(screen.getByRole("link", { name: "Set registration capacity" }).getAttribute("href")).toBe("/events/drafts/event");
});
it("a draft with omitted scheduling controls stores null values", async () => {
  api.mockResolvedValue({ event: { ...event, status: "Draft" } }); render(<Form canCreate />);
  (screen.getByLabelText(/Preferred date/) as HTMLInputElement).disabled = true;
  (screen.getByLabelText(/Expected attendance/) as HTMLInputElement).disabled = true;
  fireEvent.click(screen.getByRole("button", { name: "Save as draft" })); await screen.findByText(/Draft saved/);
  expect(JSON.parse(api.mock.calls[0][1]!.body as string)).toMatchObject({ event_datetime: null, expected_attendance: null });
});
