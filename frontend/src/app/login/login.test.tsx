// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { act, deferred, fireEvent, render, screen } from "../../../scripts/testing/dom";
import Login from "./page";
import { ApiError, apiRequest } from "@/lib/api";
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/lib/api", async original => ({ ...await original<object>(), apiRequest: vi.fn() }));
const api = vi.mocked(apiRequest);
beforeEach(() => vi.resetAllMocks());
it.each([new ApiError("Locked", 429), new ApiError("Invalid credentials", 401), new Error("offline")])("login explains failure and stays on the login form: %s", async error => {
  api.mockRejectedValue(error); render(<Login />); fireEvent.change(screen.getByLabelText("Email"), { target: { value: "attendee@example.test" } });
  fireEvent.submit(screen.getByRole("button", { name: "Sign in" }).closest("form")!);
  expect((await screen.findByRole("alert")).textContent).toContain(error instanceof ApiError ? error.status === 429 ? "Account temporarily locked" : "Invalid credentials" : "Could not reach the server");
  expect(router.push).not.toHaveBeenCalled(); expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("attendee@example.test");
});
it("does not submit again while login is pending", async () => {
  const pending = deferred<object>(); api.mockReturnValue(pending.promise); render(<Login />); const form = screen.getByRole("button", { name: "Sign in" }).closest("form")!;
  fireEvent.submit(form); fireEvent.submit(form); expect(api).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve({ user: {} })); expect(router.push).toHaveBeenCalledWith("/");
});
it("omitted credentials are sent as empty values and never treated as literal null credentials", async () => {
  api.mockRejectedValue(new ApiError("Invalid credentials", 401)); render(<Login />);
  (screen.getByLabelText("Email") as HTMLInputElement).disabled = true; (screen.getByLabelText("Password") as HTMLInputElement).disabled = true;
  fireEvent.submit(screen.getByRole("button", { name: "Sign in" }).closest("form")!); await screen.findByRole("alert");
  expect(JSON.parse(api.mock.calls[0][1]!.body as string)).toEqual({ email: "", password: "" }); expect(router.push).not.toHaveBeenCalled();
});
