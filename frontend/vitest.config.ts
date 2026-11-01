import { defineConfig } from "vitest/config";

// Fast, isolated unit tests (the base of the testing pyramid).
// Playwright owns e2e/*.spec.ts; Vitest owns src/**/*.test.ts — no overlap.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      // Include unimported UI files too: utility-only coverage is not app coverage.
      all: true,
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/**/*.d.ts"],
      // Enforce full coverage for shared runtime logic while keeping every UI file visible.
      thresholds: { "src/lib/**": { statements: 100, branches: 100, functions: 100, lines: 100 } },
      reporter: ["text", "json", "json-summary", "lcov", "html"],
    },
  },
});
