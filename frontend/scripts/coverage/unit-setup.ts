import { afterAll } from "vitest";
import { writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

afterAll(() => {
  const coverage = (globalThis as typeof globalThis & { __coverage__?: object }).__coverage__;
  if (coverage) writeFileSync(join(process.cwd(), ".coverage-data/unit", `${randomUUID()}.json`), JSON.stringify(coverage));
});
