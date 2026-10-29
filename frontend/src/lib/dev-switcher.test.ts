import { describe, expect, it, vi } from "vitest";
import { ApiError } from "./api";
import { loadSwitcherState } from "./dev-switcher";

const demo = { id: 2, display_name: "Demo Coordinator", role: "Coordinator" };

function api(responses: Record<string, unknown>) {
  return vi.fn(async (path: string) => {
    const value = responses[path];
    if (value instanceof Error) throw value;
    return value;
  }) as unknown as (<T>(path: string) => Promise<T>) & ReturnType<typeof vi.fn>;
}

describe("loadSwitcherState", () => {
  it("hides the switcher and never touches demo endpoints for a password session", async () => {
    const request = api({ "/auth/session": { user: { id: 99, display_name: "Real", role: "Attendee" } } });

    expect(await loadSwitcherState(request)).toEqual({ visible: false });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).not.toHaveBeenCalledWith("/dev/session");
  });

  it("shows demo users and the current selection when nobody is signed in", async () => {
    const request = api({
      "/auth/session": { user: null },
      "/dev/users": { users: [demo] },
      "/dev/session": { user: demo },
    });

    expect(await loadSwitcherState(request)).toEqual({ visible: true, users: [demo], user: demo });
  });

  it("hides itself when the API has the switcher disabled", async () => {
    const request = api({
      "/auth/session": { user: null },
      "/dev/users": new ApiError("Not Found", 404),
      "/dev/session": new ApiError("Not Found", 404),
    });

    expect(await loadSwitcherState(request)).toEqual({ visible: false });
  });

  it("surfaces other failures instead of guessing an identity", async () => {
    const request = api({
      "/auth/session": { user: null },
      "/dev/users": new ApiError("No demo users found.", 503),
      "/dev/session": { user: null },
    });

    await expect(loadSwitcherState(request)).rejects.toThrow("No demo users found.");
  });
});
