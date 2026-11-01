import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig({
  ...base,
  testDir: ".",
  testMatch: ["e2e/**/*.spec.ts", "scripts/coverage/collector.spec.ts"],
});
