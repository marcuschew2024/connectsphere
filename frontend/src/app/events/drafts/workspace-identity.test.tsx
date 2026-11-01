// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "../../../../scripts/testing/dom";
import Workspace from "./draft-workspace";
import { apiRequest } from "@/lib/api";
import { loadSwitcherState } from "@/lib/dev-switcher";
const state = vi.hoisted(() => ({ role: "Organiser" as string | null, loading: false, update: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/events/drafts", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/use-acting-role", () => ({ useActingRole: () => [state.role, state.update, state.loading] }));
vi.mock("@/lib/api", async original => ({ ...await original<object>(), apiRequest: vi.fn() }));
vi.mock("@/lib/dev-switcher", () => ({ loadSwitcherState: vi.fn() }));
const user = { id: 1, role: "Organiser", display_name: "Organiser A" }, next = { ...user, id: 2, display_name: "Organiser B" };
beforeEach(() => { vi.resetAllMocks(); state.role = "Organiser"; state.loading = false; vi.stubEnv("NODE_ENV", "development"); vi.mocked(loadSwitcherState).mockResolvedValue({ visible: true, users: [user, next], user }); });
afterEach(() => vi.unstubAllEnvs());
it("switching Organiser identity clears the previous account's in-memory draft", async () => {
  vi.mocked(apiRequest).mockResolvedValue({ user: next }); render(<Workspace title="Drafts" description="Private"><label>Private note<input defaultValue="" /></label></Workspace>);
  const select = await screen.findByRole("combobox"); await waitFor(() => expect((select as HTMLSelectElement).disabled).toBe(false));
  fireEvent.change(screen.getByLabelText("Private note"), { target: { value: "Organiser A private text" } }); fireEvent.change(select, { target: { value: "2" } });
  await waitFor(() => expect(state.update).toHaveBeenCalledWith("Organiser", false));
  expect((screen.getByLabelText("Private note") as HTMLInputElement).value).toBe(""); expect(state.update).toHaveBeenCalledWith(null, true);
});
it.each([true, false])("private workspace is withheld until an Organiser is available: loading=%s", async loading => {
  state.role = null; state.loading = loading; render(<Workspace title="Drafts" description="Private">Private records</Workspace>); await act(async () => {});
  expect(screen.queryByText("Private records")).toBeNull(); expect(screen.getByText(loading ? "Getting your workspace ready…" : "Select an Organiser above to continue.")).toBeTruthy();
});
