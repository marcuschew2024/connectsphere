import { defineConfig, mergeConfig } from "vitest/config";
import { createRequire } from "node:module";
import base from "./vitest.config";
const require = createRequire(import.meta.url);
const { eligible, instrument } = require("./scripts/coverage/instrument.cjs");

// The exact same pre-transform counters run in Vitest and the Next browser build.
export default mergeConfig(base, defineConfig({
  plugins: [{ name: "combined-source-coverage", enforce: "pre", transform(source, id) {
    if (eligible(id)) {
      const { code, map } = instrument(source, id);
      return { code, map };
    }
  } }],
  test: {
    coverage: { enabled: false },
    setupFiles: ["./scripts/coverage/unit-setup.ts"],
  },
}));
