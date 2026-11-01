import { afterEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { assignCoordinator, listCoordinators, splitQueue } from "./assignment";
import { formatSlot } from "./bookings";
import { REQUEST_STATUSES } from "./equipment-requests";
import { StatusBadge, type EventRecord } from "./events";
import { eventTime } from "./registrations";
import { groupSupervisedEvents } from "./supervised-events";
import { cn } from "./utils";
import { defaultOpeningHours } from "./venues";
afterEach(() => vi.unstubAllGlobals());
it("loads coordinators with cancellation and submits the selected identity with the session cookie", async () => {
  const coordinators = [{ id: 2, display_name: "Coordinator A" }];
  const assigned = { event: { id: "event", coordinator_id: 2 }, outcome: "assigned" };
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ coordinators })).mockResolvedValueOnce(Response.json(assigned));
  vi.stubGlobal("fetch", fetcher);
  const controller = new AbortController();
  expect(await listCoordinators(controller.signal)).toEqual({ coordinators });
  expect(fetcher.mock.calls[0][0]).toMatch(/\/events\/coordinators$/);
  expect(fetcher.mock.calls[0][1]).toMatchObject({ signal: controller.signal, credentials: "include" });
  expect(await assignCoordinator("event", 2)).toEqual(assigned);
  expect(fetcher.mock.calls[1][0]).toMatch(/\/events\/event\/coordinator$/);
  expect(fetcher.mock.calls[1][1]).toMatchObject({ method: "POST", credentials: "include", body: '{"coordinator_id":2}' });
});
it("keeps legacy requests with missing submission dates visible and stably ordered", () => {
  const rows = ["a", "b", "c"].map(id => ({ id, status: "Submitted", coordinator_id: null, submitted_at: null,
    created_at: `2026-10-0${id === "a" ? 3 : id === "b" ? 1 : 2}T00:00:00Z`,
    updated_at: `2026-10-0${id === "a" ? 3 : id === "b" ? 1 : 2}T00:00:00Z`,
  } as EventRecord));
  expect(splitQueue(rows).unassigned).toEqual(rows);
  expect(groupSupervisedEvents(rows).unassigned.map(row => row.id)).toEqual(["b", "c", "a"]);
  expect(groupSupervisedEvents(rows.map(row => ({ ...row, coordinator_id: 2, coordinator_assigned_at: null })))
    .assigned.map(row => row.id)).toEqual(["a", "c", "b"]);
});
it("formats both ends of a booking in the reader's locale", () => {
  const start = new Date("2026-10-20T06:00:00Z"), end = new Date("2026-10-20T08:00:00Z");
  const label = formatSlot(start.toISOString(), end.toISOString());
  expect(label).toContain(start.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }));
  for (const time of [start, end]) expect(label).toContain(time.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }));
  expect(label).toContain(" – ");
});
it("labels registration times explicitly in Singapore and handles an absent date", () => {
  expect(eventTime(null)).toBe("Date not provided");
  expect(eventTime("2026-10-20T16:00:00Z")).toBe("21 Oct 2026, 12:00 am (Singapore)");
});
it("provides the supported equipment fulfilment choices", () => {
  expect(REQUEST_STATUSES).toEqual(["Requested", "Reserved", "Partially fulfilled", "Unavailable"]);
});
it("renders a missing legacy status using the Planning fallback", () => {
  expect(renderToStaticMarkup(StatusBadge({ status: null as unknown as string }))).toContain(">Planning</span>");
});
it("creates independent weekday opening hours and closes weekends by default", () => {
  const first = defaultOpeningHours(), second = defaultOpeningHours();
  expect(Object.values(first)).toEqual([...Array.from({ length: 5 }, () => ({ opens: "09:00", closes: "18:00" })), null, null]);
  first.monday!.opens = "10:00";
  expect(first.tuesday!.opens).toBe("09:00");
  expect(second.monday!.opens).toBe("09:00");
});
it("exports the shared conditional class-name helper", () => {
  expect(cn("base", false && "hidden", { selected: true, disabled: false })).toBe("base selected");
});
