"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "./api";

export function useActingRole() {
  const [role, setRole] = useState<string | null>(null);
  // The signed-in user's id, for record-level UI such as "is this my event?" (SCRUM-69).
  const [userId, setUserId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  // True only when the API answered that nobody is signed in — not when it was unreachable.
  const [signedOut, setSignedOut] = useState(false);
  const lookup = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    lookup.current = controller;
    apiRequest<{ user: { id: number; role: string } | null }>("/session", { signal: controller.signal })
      .then(({ user }) => {
        if (!controller.signal.aborted) {
          setRole(user?.role ?? null);
          setUserId(user?.id ?? null);
          setSignedOut(user === null);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setRole(null);
          setUserId(null);
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, []);

  const updateRole = useCallback((nextRole: string | null, pending = false) => {
    // A slow page-load response must not overwrite a newer dropdown selection.
    lookup.current?.abort();
    setRole(nextRole);
    // The dropdown changes the session user; the page reloads before the id is used.
    setUserId(null);
    setSignedOut(false);
    setLoading(pending);
  }, []);

  return [role, updateRole, loading, signedOut, userId] as const;
}
