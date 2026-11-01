// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "../../../scripts/testing/dom";
import Link from "next/link";
import { Badge } from "./badge";
import { Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent, CardFooter } from "./card";
import { Separator } from "./separator";
import { RadioGroup, RadioGroupItem } from "./radio-group";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "./dialog";
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from "./tooltip";

// JSDOM has no layout observer; placement itself is covered in real browsers.
beforeEach(() => vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} }));
afterEach(() => vi.unstubAllGlobals());

it.each(["default", "sm"] as const)("preserves card content and accessible navigation at size %s", size => {
  render(<Card {...(size === "sm" ? { size } : {})} aria-label="Event summary"><CardHeader>
    <CardTitle>Workshop</CardTitle><CardDescription>Campus event</CardDescription><CardAction>
      <Badge asChild variant="outline"><Link href="/events/event">Open event</Link></Badge>
    </CardAction></CardHeader><CardContent>20 places</CardContent><CardFooter><Badge>Planning</Badge></CardFooter></Card>);
  expect(screen.getByText("Workshop")).toBeTruthy(); expect(screen.getByText("20 places")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Open event" }).getAttribute("href")).toBe("/events/event");
  expect(screen.getByText("Planning")).toBeTruthy();
});
it("distinguishes decorative dividers from meaningful vertical separation", () => {
  const view = render(<Separator />); expect(screen.queryByRole("separator")).toBeNull();
  view.rerender(<Separator decorative={false} orientation="vertical" />);
  expect(screen.getByRole("separator").getAttribute("aria-orientation")).toBe("vertical");
});
it("lets the user select one radio option and prevents selecting a disabled option", () => {
  render(<RadioGroup defaultValue="first" aria-label="Room"><RadioGroupItem value="first" aria-label="Hall" />
    <RadioGroupItem value="second" aria-label="Seminar room" /><RadioGroupItem value="third" disabled aria-label="Unavailable room" /></RadioGroup>);
  fireEvent.click(screen.getByRole("radio", { name: "Seminar room" }));
  expect(screen.getByRole("radio", { name: "Seminar room" }).getAttribute("aria-checked")).toBe("true");
  expect(screen.getByRole("radio", { name: "Hall" }).getAttribute("aria-checked")).toBe("false");
  fireEvent.click(screen.getByRole("radio", { name: "Unavailable room" }));
  expect(screen.getByRole("radio", { name: "Unavailable room" }).getAttribute("aria-checked")).toBe("false");
});
it.each([false, true])("provides a named dialog with the configured close control (footer=%s)", async footer => {
  render(<Dialog><DialogTrigger>Open details</DialogTrigger><DialogContent {...(footer ? { showCloseButton: false } : {})}>
    <DialogHeader><DialogTitle>Venue details</DialogTitle><DialogDescription>Check the room before booking.</DialogDescription></DialogHeader>
    <DialogFooter {...(footer ? { showCloseButton: true } : {})}><DialogClose>Cancel review</DialogClose></DialogFooter>
  </DialogContent></Dialog>);
  expect(screen.queryByRole("dialog")).toBeNull(); fireEvent.click(screen.getByRole("button", { name: "Open details" }));
  expect(await screen.findByRole("dialog", { name: "Venue details" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Close" })); expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Open details" }));
  fireEvent.click(await screen.findByRole("button", { name: "Cancel review" })); expect(screen.queryByRole("dialog")).toBeNull();
});
it.each([false, true])("exposes tooltip content using default and explicit placement options: %s", async custom => {
  render(<TooltipProvider {...(custom ? { delayDuration: 10 } : {})}><Tooltip open>
    <TooltipTrigger>Capacity help</TooltipTrigger><TooltipContent {...(custom ? { sideOffset: 4 } : {})}>Maximum registered attendees</TooltipContent>
  </Tooltip></TooltipProvider>);
  expect((await screen.findByRole("tooltip")).textContent).toContain("Maximum registered attendees");
});
