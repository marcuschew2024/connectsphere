import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StatusBadge, ChangeRequestStatusBadge } from "./events";
import { BookingStatusBadge, type BookingStatus } from "./bookings";
import { equipmentTimestamp } from "./equipment";

const text = (html: string) => html.replace(/<[^>]*>/g, "");

describe("event and arrangement status labels", () => {
  it.each(["Planning", "Confirmed", "Preparation", "Completed", "Rejected", "Cancelled"])("keeps %s visible to the user", (status) => {
    const html = renderToStaticMarkup(createElement(StatusBadge, { status }));
    expect(text(html)).toBe(status);
    expect(html).toContain('data-testid="event-status-badge"');
    expect(html).not.toContain("undefined");
  });
  it("shows an unfamiliar event state without giving it the confirmed colour", () => {
    const unknown = renderToStaticMarkup(createElement(StatusBadge, { status: "Unknown" }));
    expect(text(unknown)).toBe("Unknown");
    expect(unknown).toContain("bg-slate-100");
    expect(unknown).not.toContain("bg-emerald-100");
  });
  it("keeps significant approval visibly awaiting re-review", () => {
    const significant = renderToStaticMarkup(createElement(ChangeRequestStatusBadge, { status: "Approved", reReview: true }));
    const ordinary = renderToStaticMarkup(createElement(ChangeRequestStatusBadge, { status: "Approved" }));
    expect(text(significant)).toBe("Approved · Re-review in progress");
    expect(text(ordinary)).toBe("Approved");
  });
  it.each(["Requested", "Pending", "Held", "Confirmed", "Rejected", "Blocked", "Cancelled", "Expired"] as BookingStatus[])("does not mislabel a %s booking as another state", (status) => {
    const html = renderToStaticMarkup(createElement(BookingStatusBadge, { status }));
    expect(text(html)).toBe(status);
    expect(html).not.toContain("undefined");
  });
  it("renders an unknown booking state neutrally", () => {
    const html = renderToStaticMarkup(createElement(BookingStatusBadge, { status: "Unexpected" as BookingStatus }));
    expect(text(html)).toBe("Unexpected");
    expect(html).toContain("bg-slate-100");
  });
});

describe("equipment audit timestamps", () => {
  it("uses Singapore time across a UTC date boundary", () => {
    expect(equipmentTimestamp("2026-10-31T18:05:00Z")).toBe("1 Nov 2026, 2:05 am");
  });
  it("formats equivalent instants consistently regardless of the supplied offset", () => {
    expect(equipmentTimestamp("2026-11-01T02:05:00+08:00")).toBe(equipmentTimestamp("2026-10-31T18:05:00Z"));
  });
});
