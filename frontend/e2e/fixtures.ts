import { test as base } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
export { expect } from "@playwright/test";
export type * from "@playwright/test";

type Snapshot = { documentId: string; coverage: Record<string, unknown> };
type CoverageWindow = Window & {
  __coverage__?: Record<string, unknown>;
  __coverageDocumentId: string;
};

export const test = base.extend<{ sourceCoverage: void }>({
  sourceCoverage: [async ({ context }, use, testInfo) => {
    if (process.env.COMBINED_COVERAGE !== "1") { await use(); return; }
    const snapshots = new Map<string, Snapshot>();
    await context.addInitScript(() => {
      const target = window as unknown as CoverageWindow;
      target.__coverageDocumentId = crypto.randomUUID();
      // Unload-time protocol messages can be lost. Synchronous tab storage survives
      // reloads and same-origin full navigations until the collector reads it.
      addEventListener("pagehide", () => {
        if (!target.__coverage__) return;
        const key = "__connectsphere_source_coverage__";
        try {
          const stored = JSON.parse(sessionStorage.getItem(key) ?? "{}");
          stored[target.__coverageDocumentId] = target.__coverage__;
          sessionStorage.setItem(key, JSON.stringify(stored));
        } catch (error) {
          sessionStorage.removeItem(key);
          sessionStorage.setItem(`${key}_error`, String(error));
        }
      });
    });
    await use();
    for (const page of context.pages()) {
      if (page.isClosed()) continue;
      const result = await page.evaluate(() => {
        const target = window as unknown as CoverageWindow;
        const key = "__connectsphere_source_coverage__";
        const stored = JSON.parse(sessionStorage.getItem(key) ?? "{}") as Record<string, Record<string, unknown>>;
        if (target.__coverage__) stored[target.__coverageDocumentId] = target.__coverage__;
        return { error: sessionStorage.getItem(`${key}_error`),
          snapshots: Object.entries(stored).map(([documentId, coverage]) => ({ documentId, coverage })) };
      });
      if (result.error) throw new Error(`Coverage snapshot storage failed: ${result.error}`);
      for (const snapshot of result.snapshots) snapshots.set(snapshot.documentId, snapshot);
    }
    // A server-only page can pass its UI test without executing application JS.
    // Keep that test receipt and its zero contribution instead of dropping the file.
    // Each document's final snapshot replaces earlier snapshots, so revisiting a page
    // never adds the same counters twice. Different tests/documents remain independent.
    await writeFile(join(process.cwd(), ".coverage-data/browser", `${randomUUID()}.json`),
      JSON.stringify({ title: testInfo.titlePath, status: testInfo.status, snapshots: [...snapshots.values()] }));
  }, { auto: true }],
});
