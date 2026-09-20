"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "./api";

export function useActingRole() {
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const lookup = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    lookup.current = controller;
    apiRequest<{ user: { role: string } | null }>("/session", { signal: controller.signal })
      .then(({ user }) => {
        if (!controller.signal.aborted) {
          setRole(user?.role ?? null);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setRole(null);
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, []);

  const updateRole = useCallback((nextRole: string | null, pending = false) => {
    // A slow page-load response must not overwrite a newer dropdown selection.
    lookup.current?.abort();
    setRole(nextRole);
    setLoading(pending);
  }, []);

  return [role, updateRole, loading] as const;
}
