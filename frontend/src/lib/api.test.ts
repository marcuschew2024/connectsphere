import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiRequest } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ApiError", () => {
  it("carries message, status and fields", () => {
    const err = new ApiError("bad request", 400, { title: "required" });
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("bad request");
    expect(err.status).toBe(400);
    expect(err.fields).toEqual({ title: "required" });
  });

  it("defaults fields to an empty object", () => {
    const err = new ApiError("boom", 500);
    expect(err.fields).toEqual({});
  });
});

describe("apiRequest", () => {
  it("returns parsed JSON on a successful response", async () => {
    const payload = { user: { role: "organiser" } };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })),
    );

    const result = await apiRequest<typeof payload>("/session");
    expect(result).toEqual(payload);
  });

  it("throws ApiError with the server's error message and fields on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "email taken", fields: { email: "taken" } }), {
            status: 409,
          }),
      ),
    );

    await expect(
      apiRequest("/auth/register", { method: "POST", body: JSON.stringify({}) }),
    ).rejects.toMatchObject({ status: 409, message: "email taken", fields: { email: "taken" } });
  });

  it("falls back to a generic message when the error body is not valid JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>500</html>", { status: 500 })),
    );

    await expect(apiRequest("/session")).rejects.toMatchObject({
      status: 500,
      fields: {},
    });
  });
});
