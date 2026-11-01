// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { act, deferred, fireEvent, render, screen, waitFor } from "../../scripts/testing/dom";
import DevRoleSwitcher from "./dev-role-switcher";
import { apiRequest } from "@/lib/api";
import { loadSwitcherState } from "@/lib/dev-switcher";
vi.mock("@/lib/api", async original => ({ ...await original<object>(), apiRequest: vi.fn() }));
vi.mock("@/lib/dev-switcher", () => ({ loadSwitcherState: vi.fn() }));
const coordinator = { id: 2, display_name: "Coordinator A", role: "Coordinator" };
const load = vi.mocked(loadSwitcherState), api = vi.mocked(apiRequest);
beforeEach(() => { vi.resetAllMocks(); load.mockResolvedValue({ visible: true, users: [coordinator], user: null }); });

it("loads through an abortable session request and stays hidden when development switching is disabled", async () => {
  load.mockImplementation(async request => { await request("/dev/users"); return { visible: false }; });
  api.mockResolvedValue({});
  const view = render(<DevRoleSwitcher />);
  await waitFor(() => expect(screen.queryByRole("region")).toBeNull());
  const options = api.mock.calls[0][1]!;
  expect(options.signal).toBeInstanceOf(AbortSignal);
  view.unmount();
  expect(options.signal!.aborted).toBe(true);
});
it.each([false, true])("switches and clears identities using the selected numeric user (compact=%s)", async compact => {
  const changed = vi.fn();
  render(<DevRoleSwitcher compact={compact} onRoleChange={changed} />);
  const select = await screen.findByRole("combobox");
  await waitFor(() => expect((select as HTMLSelectElement).disabled).toBe(false));
  const pending = deferred<{ user: typeof coordinator }>(); api.mockReturnValueOnce(pending.promise);
  fireEvent.change(select, { target: { value: "2" } });
  expect(changed).toHaveBeenLastCalledWith(null, true);
  expect((select as HTMLSelectElement).disabled).toBe(true);
  expect(api).toHaveBeenLastCalledWith("/dev/session", { method: "POST", body: '{"user_id":2}' });
  await act(async () => pending.resolve({ user: coordinator }));
  expect(changed).toHaveBeenLastCalledWith("Coordinator");
  expect(screen.getByText("Acting as: Coordinator A (Coordinator)")).toBeTruthy();
  api.mockResolvedValueOnce({ user: null });
  fireEvent.change(select, { target: { value: "" } });
  await waitFor(() => expect(changed).toHaveBeenLastCalledWith(null));
  expect(api).toHaveBeenLastCalledWith("/dev/session", { method: "DELETE", body: undefined });
  expect(screen.queryByRole("button", { name: "Test action" }) === null).toBe(compact);
});
it("attributes a test action to the returned actor with or without a role callback", async () => {
  load.mockResolvedValue({ visible: true, users: [coordinator], user: coordinator });
  const view = render(<DevRoleSwitcher />);
  const button = await screen.findByRole("button", { name: "Test action" });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  api.mockResolvedValue({ actor: coordinator });
  fireEvent.click(button);
  expect(await screen.findByRole("status")).toHaveProperty("textContent", "Test action attributed to Coordinator A (Coordinator).");
  const changed = vi.fn(); view.rerender(<DevRoleSwitcher onRoleChange={changed} />);
  fireEvent.click(button);
  await waitFor(() => expect(changed).toHaveBeenCalledWith("Coordinator"));
});
it.each([new Error("Offline"), "opaque failure"])("reports loading failures without enabling actions: %s", async error => {
  load.mockRejectedValue(error); render(<DevRoleSwitcher />);
  expect((await screen.findByRole("alert")).textContent).toBe(error instanceof Error ? "Offline" : "Could not load demo users.");
  expect((screen.getByRole("combobox") as HTMLSelectElement).disabled).toBe(true);
});
it.each([new Error("Denied"), null])("refuses failed switches and test actions: %s", async error => {
  load.mockResolvedValue({ visible: true, users: [coordinator], user: coordinator });
  render(<DevRoleSwitcher />);
  const select = await screen.findByRole("combobox");
  await waitFor(() => expect((select as HTMLSelectElement).disabled).toBe(false));
  api.mockRejectedValue(error);
  fireEvent.click(screen.getByRole("button", { name: "Test action" }));
  expect((await screen.findByRole("alert")).textContent).toBe(error instanceof Error ? "Denied" : "Could not perform test action.");
  fireEvent.change(select, { target: { value: "" } });
  await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(error instanceof Error ? "Denied" : "Could not switch users."));
  expect(screen.getByText("No acting user selected.")).toBeTruthy();
});
it.each(["resolve", "reject"])("ignores late load completion after unmount: %s", async outcome => {
  const pending = deferred<Awaited<ReturnType<typeof loadSwitcherState>>>(); load.mockReturnValue(pending.promise);
  const changed = vi.fn(), view = render(<DevRoleSwitcher onRoleChange={changed} />); view.unmount();
  await act(async () => { if (outcome === "resolve") pending.resolve({ visible: true, users: [], user: null }); else pending.reject(new Error("late")); });
  expect(changed).not.toHaveBeenCalled();
});
