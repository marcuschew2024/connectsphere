import { afterEach, expect, it, vi } from "vitest";
import { API_URL, apiRequest } from "./api";

afterEach(() => vi.unstubAllGlobals());

it("sends the requested method, JSON body and session credentials to the API", async () => {
  const fetchMock = vi.fn(async () => new Response('{"saved":true}', { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  const body = JSON.stringify({ title: "Campus fair" });

  await expect(apiRequest("/events", {
    method: "POST", body, headers: { "X-Request-ID": "test-reference" },
  })).resolves.toEqual({ saved: true });

  const [url, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe(`${API_URL}/events`);
  expect(options.method).toBe("POST");
  expect(options.body).toBe(body);
  expect(options.credentials).toBe("include");
  const headers = new Headers(options.headers);
  expect(headers.get("Content-Type")).toBe("application/json");
  expect(headers.get("X-Request-ID")).toBe("test-reference");
});

it("does not add a JSON content type to a bodyless request", async () => {
  const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  await apiRequest("/session");
  const [, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(new Headers(options.headers).has("Content-Type")).toBe(false);
});

it("provides the HTTP status in its fallback error when JSON has no error message", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
  await expect(apiRequest("/events")).rejects.toMatchObject({
    status: 503, message: "API request failed (503).", fields: {},
  });
});

it("propagates connection failures without claiming a successful response", async () => {
  const failure = new TypeError("Connection unavailable");
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(failure));
  await expect(apiRequest("/events")).rejects.toBe(failure);
});
