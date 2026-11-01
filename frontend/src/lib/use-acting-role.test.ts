// @vitest-environment jsdom
import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { apiRequest } from "./api";
import { useActingRole } from "./use-acting-role";
vi.mock("./api", () => ({ apiRequest: vi.fn() }));
let root: Root;
let container: HTMLDivElement;
let resolve: (value: unknown) => void;
let reject: (reason: Error) => void;
function Harness({ initialSelection = false }: { initialSelection?: boolean }) {
  const state = useActingRole();
  const updateRole = state[1];
  useLayoutEffect(() => {
    if (initialSelection) updateRole("Coordinator", true);
  }, [initialSelection, updateRole]);
  return createElement("div", null,
    createElement("output", null, JSON.stringify([state[0], state[2], state[3], state[4]])),
    createElement("button", { onClick: () => updateRole("Organiser") }, "Organiser"),
    createElement("button", { onClick: () => updateRole("Coordinator", true) }, "Coordinator"));
}
async function mount(initialSelection = false) {
  await act(async () => root.render(createElement(Harness, { initialSelection })));
}
function expectState(role: string | null, loading: boolean, signedOut: boolean, id: number | null) {
  expect(JSON.parse(container.querySelector("output")!.textContent!)).toEqual([role, loading, signedOut, id]);
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(apiRequest).mockReset();
  vi.mocked(apiRequest).mockReturnValue(new Promise((yes, no) => { resolve = yes; reject = no; }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
it("starts pending, then exposes the signed-in identity", async () => {
  await mount();
  expectState(null, true, false, null);
  expect(apiRequest).toHaveBeenCalledWith("/session", { signal: expect.any(AbortSignal) });
  await act(async () => resolve({ user: { id: 2, role: "Coordinator" } }));
  expectState("Coordinator", false, false, 2);
});
it.each([null, undefined])("does not invent an identity for an absent user (%s)", async user => {
  await mount();
  await act(async () => resolve({ user }));
  expectState(null, false, user === null, null);
});
it("finishes loading on an outage without claiming the user signed out", async () => {
  await mount();
  await act(async () => reject(new Error("offline")));
  expectState(null, false, false, null);
});
it.each(["resolve", "reject"])("a stale lookup cannot overwrite a newer role selection (%s)", async outcome => {
  await mount();
  await act(async () => container.querySelectorAll("button")[0].click());
  expectState("Organiser", false, false, null);
  expect(vi.mocked(apiRequest).mock.calls[0][1]!.signal!.aborted).toBe(true);
  await act(async () => {
    if (outcome === "resolve") resolve({ user: { id: 2, role: "Coordinator" } });
    else reject(new Error("aborted"));
  });
  expectState("Organiser", false, false, null);
});
it("changing the session clears the previous signed-out flag", async () => {
  await mount();
  await act(async () => resolve({ user: null }));
  expectState(null, false, true, null);
  await act(async () => container.querySelectorAll("button")[1].click());
  expectState("Coordinator", true, false, null);
});
it("accepts a selection made during mount before the lookup effect starts", async () => {
  await mount(true);
  expectState("Coordinator", true, false, null);
});
it("cancels the lookup when its page unmounts", async () => {
  await mount();
  const signal = vi.mocked(apiRequest).mock.calls[0][1]!.signal!;
  await act(async () => root.render(null));
  expect(signal.aborted).toBe(true);
  await act(async () => resolve({ user: { id: 2, role: "Coordinator" } }));
  expect(container.textContent).toBe("");
});
