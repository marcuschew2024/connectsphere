// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { act, deferred, fireEvent, render, screen, waitFor } from "../../../scripts/testing/dom";
import Modal from "./equipment-availability-modal";
import { apiRequest } from "@/lib/api";
vi.mock("@/lib/api", async original => ({ ...await original<object>(), apiRequest: vi.fn() }));
const api = vi.mocked(apiRequest);
const stock = { equipment_id: "equipment", equipment_type: "Projector", total_quantity: 10,
  operational_status: "Operational", usable_quantity: 10, reserved_quantity: 2, available_quantity: 8,
  requested_quantity: 2, is_sufficient: true, overlapping_reservations_count: 1,
  start_at: "2099-10-20T06:00:00Z", end_at: "2099-10-20T08:00:00Z" };
const props = { equipmentId: "equipment", equipmentType: "Projector", isOpen: true, onClose: vi.fn() };
function times(start = "2099-10-20T14:00", end = "2099-10-20T16:00") {
  fireEvent.change(screen.getByLabelText("Start Date & Time"), { target: { value: start } });
  fireEvent.change(screen.getByLabelText("End Date & Time"), { target: { value: end } });
}
function check() { fireEvent.submit(screen.getByRole("button", { name: "Check Availability" }).closest("form")!); }
beforeEach(() => vi.resetAllMocks());
it("stays closed on request and allows dismissal without changing reservations", () => {
  const view = render(<Modal {...props} isOpen={false} />); expect(screen.queryByRole("dialog")).toBeNull();
  view.rerender(<Modal {...props} />); fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(props.onClose).toHaveBeenCalledOnce(); expect(api).not.toHaveBeenCalled();
});
it("refuses missing or reversed times before requesting stock", () => {
  render(<Modal {...props} />); check(); expect(screen.getByRole("alert").textContent).toContain("both start and end");
  times("2099-10-20T14:00", ""); check(); expect(api).not.toHaveBeenCalled();
  times("2099-10-20T16:00", "2099-10-20T14:00"); check();
  expect(screen.getByRole("alert").textContent).toContain("End time must be after"); expect(api).not.toHaveBeenCalled();
});
it.each([true, false])("shows live stock and only allows Tech Support to reserve sufficient stock: %s", async sufficient => {
  api.mockResolvedValue({ availability: { ...stock, is_sufficient: sufficient } });
  const view = render(<Modal {...props} role="Coordinator" />); times();
  fireEvent.change(screen.getByLabelText("Quantity Needed"), { target: { value: "2" } }); check();
  expect(await screen.findByText(sufficient ? "Sufficient units available" : "Insufficient units available")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Reserve Units" })).toBeNull();
  view.rerender(<Modal {...props} role="Tech Support" />);
  expect(!!screen.queryByRole("button", { name: "Reserve Units" })).toBe(sufficient);
  expect(api.mock.calls[0][0]).toContain("quantity=2");
});
it.each(["", " event-1 "])("reserves the selected quantity and refreshes stock with optional event association %s", async event => {
  const checking = deferred<{ availability: typeof stock }>(); api.mockReturnValueOnce(checking.promise);
  render(<Modal {...props} role="Tech Support" />); times(); check();
  expect((screen.getByRole("button", { name: "Checking…" }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => checking.resolve({ availability: stock }));
  fireEvent.change(screen.getByLabelText("Event Reference (Optional)"), { target: { value: event } });
  const reserving = deferred<{ message: string }>(); api.mockReturnValueOnce(reserving.promise).mockResolvedValueOnce({ availability: { ...stock, available_quantity: 7 } });
  fireEvent.click(screen.getByRole("button", { name: "Reserve Units" }));
  expect((screen.getByRole("button", { name: "Reserving…" }) as HTMLButtonElement).disabled).toBe(true);
  expect(JSON.parse(api.mock.calls[1][1]!.body as string)).toMatchObject({ quantity: 1 });
  expect(JSON.parse(api.mock.calls[1][1]!.body as string).event_id).toBe(event.trim() || undefined);
  await act(async () => reserving.resolve({ message: "Reservation saved" }));
  expect(await screen.findByRole("status")).toHaveProperty("textContent", "Reservation saved");
  expect(screen.getByText("7")).toBeTruthy(); expect(api).toHaveBeenCalledTimes(3);
});
it.each([new Error("Unavailable"), null])("reports check and reservation errors without showing success: %s", async error => {
  render(<Modal {...props} role="Tech Support" />); times(); api.mockRejectedValueOnce(error); check();
  expect((await screen.findByRole("alert")).textContent).toBe(error instanceof Error ? "Unavailable" : "Failed to check equipment availability.");
  api.mockResolvedValueOnce({ availability: stock }); check(); await screen.findByText("Sufficient units available");
  api.mockRejectedValueOnce(error); fireEvent.click(screen.getByRole("button", { name: "Reserve Units" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(error instanceof Error ? "Unavailable" : "Failed to reserve equipment."));
  expect(screen.queryByRole("status")).toBeNull();
});
it("does not reserve a previously checked result after either timestamp is cleared", async () => {
  api.mockResolvedValue({ availability: stock }); render(<Modal {...props} role="Tech Support" />); times(); check();
  await screen.findByText("Sufficient units available"); times("", "2099-10-20T16:00");
  fireEvent.click(screen.getByRole("button", { name: "Reserve Units" })); expect(api).toHaveBeenCalledTimes(1);
  times("2099-10-20T14:00", ""); fireEvent.click(screen.getByRole("button", { name: "Reserve Units" })); expect(api).toHaveBeenCalledTimes(1);
});
