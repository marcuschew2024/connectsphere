import { describe, expect, it } from "vitest";
import { recordReference } from "./record-reference";

describe("readable record references", () => {
  it("shows the stable reference and the Singapore calendar date", () => {
    expect(recordReference({ id: "internal-id", reference: "EVT-001" }, "2026-10-30T18:00:00Z"))
      .toBe("EVT-001 · 31 Oct 2026");
  });
  it("keeps numbers above 999 intact and does not invent a missing date", () => {
    expect(recordReference({ id: "internal-id", reference: "BKG-1000" })).toBe("BKG-1000");
    expect(recordReference({ id: "internal-id", reference: "REG-002" }, "invalid")).toBe("REG-002");
  });
  it("supports older API responses without inventing a reference", () => {
    expect(recordReference({ id: "legacy-id" })).toBe("legacy-id");
  });
});
