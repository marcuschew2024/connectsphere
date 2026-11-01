// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, deferred, fireEvent, render, screen, waitFor, within } from "../../scripts/testing/dom";
import { AppShell } from "./app-shell";
import OtherValues from "./other-values-input";
import VenueOptions from "./event-venue-options";
import Withdraw from "./withdraw-registration";
import { apiRequest } from "@/lib/api";
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/events/managed/event", useRouter: () => router }));
vi.mock("@/lib/api", async original => ({ ...await original<object>(), apiRequest: vi.fn() }));
const api = vi.mocked(apiRequest);
beforeEach(() => vi.resetAllMocks()); afterEach(() => vi.useRealTimers());
it("unknown roles receive only Home, and successful logout ends the session before navigation", async () => {
  const pending = deferred<object>(); api.mockReturnValue(pending.promise); render(<AppShell actingRole="Unknown role"><p>Page</p></AppShell>);
  expect(screen.getAllByRole("navigation")[0].querySelectorAll("a")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Sign out" })); expect(router.push).not.toHaveBeenCalled();
  await act(async () => pending.resolve({})); expect(router.push).toHaveBeenCalledWith("/login"); expect(router.refresh).toHaveBeenCalledTimes(1);
});
it("mobile menu closes using its close button, backdrop and navigation link", () => {
  const view = render(<AppShell actingRole="Coordinator">Page</AppShell>);
  function open() { fireEvent.click(screen.getByRole("button", { name: "Open menu" })); expect(screen.getAllByRole("complementary")).toHaveLength(2); }
  open(); fireEvent.click(within(screen.getAllByRole("complementary")[1]).getByRole("button", { name: "Close menu" })); expect(screen.getAllByRole("complementary")).toHaveLength(1);
  open(); fireEvent.click(view.container.querySelector('div[aria-hidden="true"]')!); expect(screen.getAllByRole("complementary")).toHaveLength(1);
  open(); const link = within(screen.getAllByRole("complementary")[1]).getByRole("link", { name: "My events" });
  link.addEventListener("click", event => event.preventDefault()); fireEvent.click(link); expect(screen.getAllByRole("complementary")).toHaveLength(1);
});
it("custom requirement chips reject empty values, deduplicate case-insensitively and remove the chosen item", () => {
  function Editor() { const [value, setValue] = useState("Coffee"); return <OtherValues id="custom" label="Custom" value={value} onChange={setValue} />; }
  render(<Editor />); const input = screen.getByLabelText("Custom");
  fireEvent.keyDown(input, { key: "Enter" }); fireEvent.keyDown(input, { key: "a" });
  fireEvent.change(input, { target: { value: "coffee, Tea, , Water" } }); fireEvent.keyDown(input, { key: "Enter" });
  expect(screen.getAllByRole("button", { name: /^Remove/ })).toHaveLength(3);
  fireEvent.click(screen.getByRole("button", { name: "Remove Tea" })); expect(screen.queryByRole("button", { name: "Remove Tea" })).toBeNull();
});
it("selecting and clearing custom requirements updates the submitted values", () => {
  render(<form aria-label="Requirements"><VenueOptions /></form>);
  for (const [groupName, fieldName] of [["Layouts", "venue_requirements"], ["Facilities", "facility_requirements"], ["Accessibility features", "accessibility_requirements"]]) {
    const group = screen.getByRole("group", { name: groupName }); const preset = within(group).getAllByRole("checkbox")[0];
    fireEvent.click(preset); fireEvent.click(preset);
    const other = within(group).getByRole("checkbox", { name: `${groupName} Other` }); fireEvent.click(other);
    const input = within(group).getByRole("textbox"); fireEvent.change(input, { target: { value: "Custom option" } }); fireEvent.keyDown(input, { key: "Enter" });
    expect(new FormData(screen.getByRole("form") as HTMLFormElement).get(fieldName)).toBe("Custom option");
    fireEvent.click(other); expect(new FormData(screen.getByRole("form") as HTMLFormElement).get(fieldName)).toBe("");
  }
});
it.each(["bad status", "unstructured error"])("withdrawal does not announce completion on %s", async mode => {
  const done = vi.fn(); if (mode === "bad status") api.mockResolvedValue({ registration: { status: "Registered" } }); else api.mockRejectedValue("offline");
  render(<Withdraw eventId="event" onWithdrawn={done} />); fireEvent.click(screen.getByRole("button", { name: "Withdraw registration" })); fireEvent.click(await screen.findByRole("button", { name: "Confirm withdrawal" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Withdrawal was not confirmed"); expect(done).not.toHaveBeenCalled();
  expect((screen.getByRole("button", { name: "Confirm withdrawal" }) as HTMLButtonElement).disabled).toBe(true);
});
it("withdrawal timeout requires refreshing before another attempt", async () => {
  const done = vi.fn(); api.mockImplementation((_path, options) => new Promise((_resolve, reject) => options?.signal?.addEventListener("abort", () => reject(new Error("Timed out")))));
  render(<Withdraw eventId="event" onWithdrawn={done} />); fireEvent.click(screen.getByRole("button", { name: "Withdraw registration" })); await screen.findByRole("dialog");
  vi.useFakeTimers(); fireEvent.click(screen.getByRole("button", { name: "Confirm withdrawal" }));
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" }); expect(screen.getByRole("dialog")).toBeTruthy();
  await act(async () => vi.advanceTimersByTimeAsync(10000)); expect(screen.getByRole("alert").textContent).toContain("Timed out"); expect(done).not.toHaveBeenCalled();
});
it("double withdrawal activation sends only one request", async () => {
  const pending = deferred<object>(); api.mockReturnValue(pending.promise); const done = vi.fn(); render(<Withdraw eventId="event" onWithdrawn={done} />);
  fireEvent.click(screen.getByRole("button", { name: "Withdraw registration" })); const button = await screen.findByRole("button", { name: "Confirm withdrawal" });
  act(() => { fireEvent.click(button); fireEvent.click(button); }); expect(api).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve({ registration: { id: "registration", status: "Withdrawn" } })); await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
});
