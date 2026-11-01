// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "../../../scripts/testing/dom";
import { Select, SelectGroup, SelectLabel, SelectValue, SelectTrigger, SelectContent, SelectItem, SelectSeparator } from "./select";
import { Toaster } from "./sonner";
import { toast } from "sonner";
const state = vi.hoisted(() => ({ theme: undefined as string | undefined }));
vi.mock("next-themes", () => ({ useTheme: () => ({ theme: state.theme }) }));
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })));
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { toast.dismiss(); vi.unstubAllGlobals(); });
it.each(["popper", "item-aligned"] as const)("select exposes named groups and options with %s placement", async position => {
  const changed = vi.fn(); render(<Select defaultOpen onValueChange={changed}><SelectTrigger aria-label="Choose room" {...(position === "popper" ? { size: "sm" } : {})}><SelectValue placeholder="Room" /></SelectTrigger>
    <SelectContent {...(position === "popper" ? { position, align: "start" } : {})}><SelectGroup><SelectLabel>Campus rooms</SelectLabel><SelectItem value="hall">Hall</SelectItem><SelectSeparator /><SelectItem value="lab">Lab</SelectItem><SelectItem value="closed" disabled>Closed</SelectItem></SelectGroup></SelectContent>
  </Select>);
  expect(await screen.findByRole("listbox")).toBeTruthy(); expect(screen.getByRole("group", { name: "Campus rooms" })).toBeTruthy();
  expect(screen.getByRole("option", { name: "Closed" }).getAttribute("aria-disabled")).toBe("true");
  fireEvent.keyDown(screen.getByRole("option", { name: "Lab" }), { key: "Enter" }); expect(changed).toHaveBeenCalledWith("lab");
});
it.each([undefined, "dark"])("toast uses theme %s and announces an operation result", async theme => {
  state.theme = theme; const view = render(<Toaster />);
  await act(async () => { toast.success("Booking saved"); });
  expect(await screen.findByText("Booking saved")).toBeTruthy();
  expect(view.container.querySelector("[data-sonner-toaster]")?.getAttribute("data-sonner-theme")).toBe(theme ?? "light");
});
