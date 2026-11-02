// SCRUM-79 + SCRUM-129: the wording the hold and buffer-conflict screens depend on.
// These are pure so each fallback is asserted directly rather than through a rendered page.
import { describe, expect, it } from "vitest";
import { holdDeadlineClause } from "./bookings";
import { conflictCountLabel, conflictEventLabel } from "./venues";

describe("holdDeadlineClause", () => {
  it("names the deadline when the hold has one", () => {
    const clause = holdDeadlineClause("2099-10-02T00:00:00Z");
    expect(clause.startsWith(" until ")).toBe(true);
    expect(clause).toContain(new Date("2099-10-02T00:00:00Z").toLocaleString());
  });

  it.each([null, undefined, ""])("reads correctly without a deadline (%s)", (value) => {
    // "This booking is tentatively held." must still be a sentence.
    expect(holdDeadlineClause(value)).toBe("");
  });
});

describe("conflictCountLabel", () => {
  it("uses the singular for one affected booking", () => {
    expect(conflictCountLabel(1)).toBe("1 existing booking now conflict");
  });

  it.each([0, 2, 7])("uses the plural for %i", (count) => {
    expect(conflictCountLabel(count)).toBe(`${count} existing bookings now conflict`);
  });
});

describe("conflictEventLabel", () => {
  it("prefers the event's own title", () => {
    expect(conflictEventLabel("Science Fair", "Untitled event")).toBe("Science Fair");
  });

  it.each([
    [null, "Untitled event"],
    [undefined, "another booking"],
  ])("falls back to the caller's stand-in for %s", (title, fallback) => {
    expect(conflictEventLabel(title, fallback)).toBe(fallback);
  });
});
