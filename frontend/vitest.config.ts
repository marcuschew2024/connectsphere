import { defineConfig } from "vitest/config";

// Fast, isolated unit tests (the base of the testing pyramid).
// Playwright owns e2e/*.spec.ts; Vitest owns src/**/*.test.ts — no overlap.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
