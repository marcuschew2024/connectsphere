// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, deferred, fireEvent, render, screen, waitFor } from "../../../../../scripts/testing/dom";
import { bookingRecord as booking, venueRecord as venue, eventRecord as event } from "../../../../../scripts/testing/records";
import Decision from "./booking-decision-form";
import Page from "./page";
import Retire from "../../[venueId]/venue-retire-panel";
import Cancel from "../../../events/[eventId]/event-cancel-form";
import { ApiError, apiRequest } from "@/lib/api";
vi.mock("next/navigation", () => ({ useParams: () => ({ bookingId: "booking" }), usePathname: () => "/venues/bookings/booking", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/use-acting-role", () => ({ useActingRole: () => ["Venue Staff"] }));
vi.mock("@/lib/api", async original => ({ ...await original<object>(), apiRequest: vi.fn() }));
const api = vi.mocked(apiRequest), saved = vi.fn();
beforeEach(() => vi.resetAllMocks()); afterEach(() => vi.useRealTimers());
it("already retired venues and final bookings offer no new decision", () => {
  render(<><Retire venue={{ ...venue, is_retired: true }} onRetired={saved} /><Decision booking={{ ...booking, status: "Confirmed" }} onSaved={saved} /></>); expect(screen.queryByRole("button")).toBeNull();
});
it("a tentative hold uses the selected duration and updates only after the response", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2099-10-01T00:00:00Z")); const pending = deferred<object>(); api.mockReturnValue(pending.promise);
  render(<Decision booking={booking} onSaved={saved} />); fireEvent.change(screen.getByLabelText("Hold duration"), { target: { value: "24" } });
  const button = screen.getByRole("button", { name: "Tentatively hold" }); act(() => { fireEvent.click(button); fireEvent.click(button); });
  expect(api).toHaveBeenCalledTimes(1); expect(JSON.parse(api.mock.calls[0][1]!.body as string)).toEqual({ decision: "hold", expires_at: "2099-10-02T00:00:00.000Z" }); expect(saved).not.toHaveBeenCalled();
  await act(async () => pending.resolve({ booking: { ...booking, status: "Held" } })); expect(saved).toHaveBeenCalledTimes(1);
});
it.each([new ApiError("Conflict", 409), new Error("offline")])("booking decision failure does not report a saved change: %s", async error => {
  api.mockRejectedValue(error); render(<Decision booking={{ ...booking, status: "Pending" }} onSaved={saved} />); fireEvent.click(screen.getByRole("button", { name: "Approve" }));
  expect((await screen.findByRole("alert")).textContent).toBe(error instanceof ApiError ? error.message : "Could not save the decision."); expect(saved).not.toHaveBeenCalled();
});
it.each([401, 403])("booking read refusal %s explains the access problem", async status => {
  api.mockRejectedValue(new ApiError("Denied", status)); render(<Page />);
  expect((await screen.findByRole("alert")).textContent).toContain(status === 401 ? "select a demo user" : "do not have access");
});
it("booking timeout is not displayed as a missing booking", async () => {
  vi.useFakeTimers(); api.mockImplementation((_path, options) => new Promise((_resolve, reject) => options?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))));
  render(<Page />); await act(async () => vi.advanceTimersByTimeAsync(8000)); expect(screen.getByRole("alert").textContent).toContain("booking request timed out");
});
it.each(["retirement", "cancellation"])("%s sends only one request before the busy state is rendered", async kind => {
  const pending = deferred<object>(); api.mockReturnValue(pending.promise);
  if (kind === "retirement") { render(<Retire venue={venue} onRetired={saved} />); fireEvent.click(screen.getByText("Retire venue", { selector: "summary" })); fireEvent.click(screen.getByRole("button", { name: "Continue to retirement" })); }
  else { render(<Cancel event={event} onCancelled={saved} />); fireEvent.change(screen.getByLabelText("Reason for cancelling"), { target: { value: "Unavailable" } }); fireEvent.click(screen.getByRole("button", { name: "Continue to cancellation" })); }
  const button = screen.getByRole("button", { name: kind === "retirement" ? "Confirm retirement" : "Confirm cancellation" }); act(() => { fireEvent.click(button); fireEvent.click(button); }); expect(api).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve({ venue, event, kept_confirmed_bookings: 0, released: {}, notified_attendees: 0 })); expect(saved).toHaveBeenCalledTimes(1);
});
it.each(["retirement", "cancellation"])("%s keeps the action recoverable after a network failure", async kind => {
  api.mockRejectedValue(new Error("offline"));
  if (kind === "retirement") { render(<Retire venue={venue} onRetired={saved} />); fireEvent.click(screen.getByText("Retire venue", { selector: "summary" })); fireEvent.click(screen.getByRole("button", { name: "Continue to retirement" })); }
  else { render(<Cancel event={event} onCancelled={saved} />); fireEvent.change(screen.getByLabelText("Reason for cancelling"), { target: { value: "Unavailable" } }); fireEvent.click(screen.getByRole("button", { name: "Continue to cancellation" })); }
  fireEvent.click(screen.getByRole("button", { name: kind === "retirement" ? "Confirm retirement" : "Confirm cancellation" }));
  expect((await screen.findByRole("alert")).textContent).toContain(kind === "retirement" ? "Could not retire" : "Could not cancel"); expect(saved).not.toHaveBeenCalled();
});
it.each(["Rejected", "Confirmed", "Held"] as const)("legacy %s booking without joined display fields remains readable", async status => {
  api.mockResolvedValue({ booking: { ...booking, status, requested_at: "", decision_at: null, venue: null, event: null, expires_at: null } }); render(<Page />);
  await screen.findByRole("heading", { name: "Venue booking" }); expect(screen.getAllByText("Not provided").length).toBeGreaterThan(0); await waitFor(() => expect(screen.queryByText(/Loading booking/)).toBeNull());
});
it("booking history displays its persisted request date", async () => {
  api.mockResolvedValue({ booking }); render(<Page />); await screen.findByRole("heading", { name: "Venue booking" }); expect(screen.getByText(new Date(booking.requested_at).toLocaleDateString())).toBeTruthy();
});
