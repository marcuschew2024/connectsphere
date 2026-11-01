import { defineConfig, devices } from "@playwright/test";

// Separate from e2e/: no route fulfillment, demo identity or reused live servers.
export default defineConfig({
  testDir: "./integration",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 90_000,
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-integrated-report", open: "never" }],
    ["junit", { outputFile: "test-results/integrated.xml" }],
  ],
  outputDir: "test-results/integrated",
  use: {
    baseURL: "http://localhost:3107",
    timezoneId: "Asia/Singapore",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "integrated-chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: `${process.env.QA_PYTHON ?? "../api/.venv/bin/python"} ../scripts/qa/serve_api.py`,
      url: "http://localhost:5001/health",
      reuseExistingServer: false,
      env: { POSTGREST_TEST_URL: process.env.POSTGREST_TEST_URL ?? "http://127.0.0.1:55433" },
    },
    {
      command: "npm run start -- --port 3107",
      url: "http://localhost:3107/login",
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
