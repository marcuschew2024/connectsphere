import { ApiError } from "./api";

export type DemoUser = { id: number; display_name: string; role: string };
type Session = { user: DemoUser | null };
type Request = <T>(path: string) => Promise<T>;

export type SwitcherState =
  | { visible: false }
  | { visible: true; users: DemoUser[]; user: DemoUser | null };

// SCRUM-139: the switcher only reads state on load. It never reports a role here —
// /session already resolved the page's identity — so a slow or empty demo-session
// response cannot overwrite a password-authenticated role.
export async function loadSwitcherState(request: Request): Promise<SwitcherState> {
  const auth = await request<Session>("/auth/session");
  if (auth.user) return { visible: false };

  try {
    const [list, session] = await Promise.all([
      request<{ users: DemoUser[] }>("/dev/users"),
      request<Session>("/dev/session"),
    ]);
    return { visible: true, users: list.users, user: session.user };
  } catch (error) {
    // The API hides /dev/* outside explicit development configuration.
    if (error instanceof ApiError && error.status === 404) return { visible: false };
    throw error;
  }
}
