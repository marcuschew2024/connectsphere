// Send the session cookie with API calls so Flask knows the selected acting user.
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5001";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body) headers.set("Content-Type", "application/json");

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
    credentials: "include",
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new ApiError(
      data.error ?? `API request failed (${response.status}).`,
      response.status,
      data.fields ?? {},
    );
  }
  return response.json();
}
