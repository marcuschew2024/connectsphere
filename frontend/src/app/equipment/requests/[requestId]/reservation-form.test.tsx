// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { act, deferred, fireEvent, render, screen, waitFor } from "../../../../../scripts/testing/dom";
import { equipmentRequest as request } from "../../../../../scripts/testing/records";
import Form from "./reservation-form";
import { apiRequest, ApiError } from "@/lib/api";
vi.mock("@/lib/api", async original => ({ ...await original<object>(), apiRequest: vi.fn() }));
const api = vi.mocked(apiRequest), saved = vi.fn(), reload = vi.fn();
const reservation = { id: "existing", equipment_id: "mic", quantity: 1, start_at: "2099-10-20T06:00:00Z", end_at: "2099-10-20T07:00:00Z", status: "Confirmed" };
beforeEach(() => { vi.resetAllMocks(); api.mockResolvedValue({}); });
function input(name: string | RegExp, value: string) { fireEvent.change(screen.getByLabelText(name), { target: { value } }); }
function submit() { fireEvent.submit(screen.getByRole("form", { name: "Reserve requested equipment" })); }
it("links an existing booking without changing other item quantities", async () => {
  render(<Form request={{ ...request, existing_reservations: [reservation] }} onSaved={saved} onReload={reload} />);
  input("Existing booking — Microphone", "existing"); expect((screen.getByLabelText("Reserved quantity — Microphone") as HTMLInputElement).value).toBe("1");
  input("Reserved quantity — Projector", "1"); input("Reservation notes (optional)", "Ready"); submit(); await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
  expect(JSON.parse(api.mock.calls[0][1]!.body as string)).toEqual({ start_at: "2099-10-20T06:00:00.000Z", end_at: "2099-10-20T07:00:00.000Z", revision: 1, notes: "Ready", items: [{ equipment_id: "mic", quantity: 1, reservation_id: "existing" }, { equipment_id: "projector", quantity: 1 }] });
});
it("switches back to a new reservation and permits editing the slot and amounts", async () => {
  render(<Form request={{ ...request, existing_reservations: [reservation] }} onSaved={saved} onReload={reload} />);
  input("Existing booking — Microphone", "existing"); input("Existing booking — Microphone", ""); input("Reservation start (SGT)", "2099-10-21T14:00"); input("Reservation end (SGT)", "2099-10-21T15:00");
  input("Reserved quantity — Microphone", "2"); submit(); await waitFor(() => expect(saved).toHaveBeenCalled());
  expect(JSON.parse(api.mock.calls[0][1]!.body as string).items[0]).toEqual({ equipment_id: "mic", quantity: 2 });
});
it("refuses a backwards time interval without writing", () => {
  render(<Form request={request} onSaved={saved} onReload={reload} />); input("Reservation end (SGT)", "2000-01-01T00:00"); submit(); expect(screen.getByRole("alert").textContent).toContain("after the start"); expect(api).not.toHaveBeenCalled();
});
it.each([new ApiError("Bad quantity", 400), new ApiError("Conflict", 409), new ApiError("Server unavailable", 503), new Error("offline")])("save failure preserves the reservation and correctly requires reload: %s", async error => {
  api.mockRejectedValue(error); render(<Form request={request} onSaved={saved} onReload={reload} />); input("Reservation end (SGT)", "2099-10-20T15:00"); submit();
  const alert = await screen.findByRole("alert"); expect(alert.textContent).toContain(error instanceof ApiError ? error.message : "Could not confirm the save"); expect(saved).not.toHaveBeenCalled();
  if (!(error instanceof ApiError) || error.status !== 400) { submit(); expect(api).toHaveBeenCalledTimes(1); fireEvent.click(screen.getByRole("button", { name: "Reload latest request" })); expect(reload).toHaveBeenCalledTimes(1); }
  else expect(screen.queryByRole("button", { name: "Reload latest request" })).toBeNull();
});
it("ignores duplicate pending form submissions", async () => {
  const pending = deferred<object>(); api.mockReturnValue(pending.promise); render(<Form request={{ ...request, reservations: [reservation], existing_reservations: [reservation] }} onSaved={saved} onReload={reload} />);
  expect(screen.queryByLabelText("Existing booking — Microphone")).toBeNull(); input("Reservation end (SGT)", "2099-10-20T15:00"); submit(); submit(); expect(api).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve({})); expect(saved).toHaveBeenCalledTimes(1);
});
it("equipment reservation defaults use the event end unless a saved reservation overrides it", () => {
  const withEnd = { ...request, event: { ...request.event, event_end_datetime: "2099-10-20T07:00:00Z" } };
  const view = render(<Form request={withEnd} onSaved={saved} onReload={reload} />); expect((screen.getByLabelText("Reservation end (SGT)") as HTMLInputElement).value).toBe("2099-10-20T15:00"); view.unmount();
  render(<Form request={{ ...withEnd, reservation_end_at: "2099-10-20T08:00:00Z" }} onSaved={saved} onReload={reload} />); expect((screen.getByLabelText("Reservation end (SGT)") as HTMLInputElement).value).toBe("2099-10-20T16:00");
});
