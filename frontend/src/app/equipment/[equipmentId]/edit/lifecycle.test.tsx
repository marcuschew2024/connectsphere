// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { act, deferred, render, screen } from "../../../../../scripts/testing/dom";
import { apiRequest } from "@/lib/api";
import Page from "./page";
vi.mock("next/navigation", () => ({ usePathname: () => "/equipment/mic/edit", useParams: () => ({ equipmentId: "mic" }), useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/use-acting-role", () => ({ useActingRole: () => ["Tech Support"] }));
vi.mock("@/lib/api", async original => ({ ...await original<object>(), apiRequest: vi.fn() }));
beforeEach(() => vi.resetAllMocks());
it("leaving an equipment editor cancels the load and ignores a late failure", async () => {
  const pending = deferred<object>(); vi.mocked(apiRequest).mockReturnValue(pending.promise); const view = render(<Page />); const signal = vi.mocked(apiRequest).mock.calls[0][1]!.signal!; view.unmount();
  await act(async () => pending.reject(new Error("offline"))); expect(signal.aborted).toBe(true); expect(screen.queryByRole("alert")).toBeNull();
});
