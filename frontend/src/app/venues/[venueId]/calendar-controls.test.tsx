// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "../../../../scripts/testing/dom";
import Calendar from "./venue-availability-calendar";
import { defaultOpeningHours } from "@/lib/venues";
it("a forward-only calendar exposes only its provided navigation action", () => {
  const next = vi.fn(); render(<Calendar hours={defaultOpeningHours()} bookings={[]} weekStart={Date.UTC(2099, 9, 18, 16)} onNextWeek={next} />);
  expect(screen.queryByRole("button", { name: "Previous week" })).toBeNull(); expect(screen.queryByRole("button", { name: "This week" })).toBeNull(); fireEvent.click(screen.getByRole("button", { name: "Next week" })); expect(next).toHaveBeenCalledTimes(1);
});
it("a read-only calendar without navigation still renders availability", () => {
  render(<Calendar hours={defaultOpeningHours()} bookings={[]} weekStart={Date.UTC(2099, 9, 18, 16)} />); expect(screen.getByRole("region", { name: "Venue availability" })).toBeTruthy(); expect(screen.queryByRole("button")).toBeNull();
});
