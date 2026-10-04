import { expect, test, type Page } from "@playwright/test";

const API = "http://localhost:5001";
const ID = "11111111-1111-4111-8111-111111111111";
const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const venue = {
  id: ID, name: "Seminar Room A", location: "Building B, Level 2", capacity: 100,
  facilities: ["Projector", "Wi-Fi"], accessibility: ["Step-free access"],
  supported_layouts: ["Classroom"],
  operating_hours: Object.fromEntries(DAYS.map((day, i) => [day, i < 5 ? {opens:"09:00", closes:"18:00"} : null])),
  timezone:"Asia/Singapore", created_by:3, created_at:"2026-09-24T06:00:00Z",
  creator:{display_name:"Demo Venue Staff"},
};

test.beforeEach(async ({page}) => {
  await page.route(API + "/venues/filter-options", (route) => route.fulfill({json:{
    facilities:["Projector", "Wi-Fi"], accessibility:["Step-free access"],
  }}));
  await page.route(API + "/session", (route) => route.fulfill({json:{user:{id:3, role:"Venue Staff"}}}));
});

async function fillVenue(page: Page) {
  await page.getByLabel("Venue name").fill(venue.name);
  await page.getByLabel("Location", {exact:false}).fill(venue.location);
  await page.getByLabel("Capacity", {exact:false}).fill("100");
  await page.getByLabel("Facilities", {exact:true}).fill("Projector, Wi-Fi");
  await page.getByLabel("Accessibility features", {exact:true}).fill("Step-free access");
  await page.getByRole("checkbox", {name:"Classroom", exact:true}).check();
}

test("Venue Staff can create a venue and reopen it in the shared catalogue", async ({page}) => {
  let saved = false;
  await page.route(API + "/venues", (route) => {
    const body = route.request().postDataJSON();
    expect(body.name).toBe(venue.name);
    expect(body.capacity).toBe(100);
    expect(body.facilities).toEqual(["Projector", "Wi-Fi"]);
    expect(body.supported_layouts).toEqual(["Classroom"]);
    expect(body.operating_hours.saturday).toBeNull();
    expect(body.operating_hours.monday).toEqual({opens:"09:00", closes:"18:00"});
    expect(body).not.toHaveProperty("created_by");
    expect(body).not.toHaveProperty("created_at");
    saved = true;
    return route.fulfill({status:201, json:{venue}});
  });
  await page.route(API + "/venues?*", (route) => route.fulfill({json:{venues:saved ? [venue] : [], page:1, has_more:false}}));
  await page.goto("/");
  await page.getByRole("link", {name:"Add a venue", exact:true}).click();
  await fillVenue(page);
  await page.getByRole("button", {name:"Save venue", exact:true}).click();
  await expect(page.getByRole("heading", {name:"Venue added"})).toBeVisible();
  await page.getByRole("link", {name:"View catalogue"}).click();
  await expect(page.getByRole("heading", {name:venue.name, exact:true})).toBeVisible();
  await expect(page.getByText("100 people")).toBeVisible();
  await expect(page.getByText("Projector · Wi-Fi")).toBeVisible();
  await page.locator("summary").filter({hasText:"Opening hours"}).click();
  await expect(page.getByText("09:00 – 18:00").first()).toBeVisible();
  await expect(page.getByText("Closed").first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", {name:venue.name, exact:true})).toBeVisible();
});

test("Coordinator reads the catalogue without a create action", async ({page}) => {
  await page.route(API + "/session", (route) => route.fulfill({json:{user:{id:2, role:"Coordinator"}}}));
  await page.route(API + "/venues?*", (route) => route.fulfill({json:{venues:[venue], page:1, has_more:false}}));
  await page.goto("/");
  await expect(page.getByRole("link", {name:"Add a venue", exact:true})).toHaveCount(0);
  await page.getByRole("link", {name:"Venue catalogue", exact:true}).click();
  await expect(page.getByRole("heading", {name:venue.name, exact:true})).toBeVisible();
  await expect(page.getByRole("link", {name:"Add a venue"})).toHaveCount(0);
});

for (const role of ["Coordinator", "Organiser", "Tech Support", "Attendee", null]) {
  test("direct creation is blocked for " + (role ?? "no session"), async ({page}) => {
    let writes = 0;
    await page.route(API + "/session", (route) => route.fulfill({json:{user:role ? {id:2, role} : null}}));
    await page.route(API + "/venues", (route) => { writes++; return route.fulfill({status:403, json:{error:"Forbidden"}}); });
    await page.goto("/venues/new");
    await expect(page.getByRole("status")).toHaveText(role ? "Only Venue Staff can add a venue." : "Sign in or select a demo user to continue.");
    await expect(page.getByRole("button", {name:"Save venue"})).toHaveCount(0);
    expect(writes).toBe(0);
  });
}

for (const role of ["Organiser", "Tech Support", "Attendee", null]) {
  test("catalogue is not fetched for " + (role ?? "no session"), async ({page}) => {
    let reads = 0;
    await page.route(API + "/session", (route) => route.fulfill({json:{user:role ? {id:1, role} : null}}));
    await page.route(API + "/venues?*", (route) => { reads++; return route.fulfill({json:{venues:[venue]}}); });
    await page.goto("/venues");
    await expect(page.getByRole("status")).toHaveText(role ? "The venue catalogue is available to Venue Staff and Coordinators." : "Sign in or select a demo user to continue.");
    expect(reads).toBe(0);
  });
}

test("validation errors keep the entered venue and point to the relevant fields", async ({page}) => {
  await page.route(API + "/venues", (route) => route.fulfill({status:400, json:{
    error:"Please check the highlighted fields.", fields:{capacity:"Enter a positive whole number.", "operating_hours.monday":"Closing must be later than opening."},
  }}));
  await page.goto("/venues/new");
  await fillVenue(page);
  await page.getByLabel("Capacity", {exact:false}).fill("0");
  await page.getByLabel("monday closes", {exact:true}).fill("08:00");
  await page.getByRole("button", {name:"Save venue"}).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("highlighted fields");
  await expect(page.getByLabel("Capacity", {exact:false})).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("monday closes", {exact:true})).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("Venue name")).toHaveValue(venue.name);
  await expect(page.getByLabel("monday closes", {exact:true})).toHaveValue("08:00");
});

for (const status of [409, 503]) {
  test("save failure " + status + " preserves input without claiming success", async ({page}) => {
    await page.route(API + "/venues", (route) => route.fulfill({status, json:{error:status===409 ? "A venue with this name and location already exists." : "Could not confirm the venue was saved. Check the catalogue before retrying."}}));
    await page.goto("/venues/new");
    await fillVenue(page);
    await page.getByRole("button", {name:"Save venue"}).click();
    await expect(page.locator("main").getByRole("alert")).toBeVisible();
    await expect(page.getByRole("heading", {name:"Venue added"})).toHaveCount(0);
    await expect(page.getByLabel("Venue name")).toHaveValue(venue.name);
    await expect(page.getByRole("checkbox", {name:"Classroom", exact:true})).toBeChecked();
  });
}

test("the catalogue offers a retry and an honest empty state", async ({page}) => {
  let attempts = 0;
  await page.route(API + "/venues?*", (route) => route.fulfill(++attempts===1 ? {status:503, json:{error:"Could not load the venue catalogue."}} : {json:{venues:[], page:1, has_more:false}}));
  await page.goto("/venues");
  await expect(page.locator("main").getByRole("alert")).toContainText("Could not load");
  await page.getByRole("button", {name:"Try again"}).click();
  await expect(page.getByRole("heading", {name:"No venues yet"})).toBeVisible();
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
});

test("catalogue pagination and venue form fit a mobile screen", async ({page}) => {
  await page.setViewportSize({width:375, height:812});
  await page.emulateMedia({reducedMotion:"reduce"});
  await page.route(API + "/venues?*", (route) => {
    const pageNumber = new URL(route.request().url()).searchParams.get("page");
    return route.fulfill({json:{venues:[{...venue, name:pageNumber==="2" ? "Second page venue" : venue.name}], page:Number(pageNumber), has_more:pageNumber==="1"}});
  });
  await page.goto("/venues");
  await page.getByRole("button", {name:"Next", exact:true}).click();
  await expect(page.getByRole("heading", {name:"Second page venue"})).toBeVisible();
  await expect(page.getByRole("button", {name:"Next", exact:true})).toBeDisabled();
  await page.getByRole("button", {name:"Previous"}).click();
  await expect(page.getByRole("heading", {name:venue.name})).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("link", {name:"Add a venue"}).click();
  await fillVenue(page);
  await expect(page.getByRole("button", {name:"Save venue"})).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("a successful save can start a clean second venue", async ({page}) => {
  await page.route(API + "/venues", (route) => route.fulfill({status:201, json:{venue}}));
  await page.goto("/venues/new");
  await fillVenue(page);
  await page.getByRole("button", {name:"Save venue"}).click();
  await page.getByRole("button", {name:"Add another venue"}).click();
  await expect(page.getByLabel("Venue name")).toHaveValue("");
  await expect(page.getByRole("checkbox", {name:"Classroom", exact:true})).not.toBeChecked();
});

test("Coordinator can combine filters, paginate results and clear back to page one", async ({page}) => {
  const queries: URLSearchParams[] = [];
  await page.route(API + "/session", (route) => route.fulfill({json:{user:{id:2, role:"Coordinator"}}}));
  await page.route(API + "/venues?*", (route) => {
    const query = new URL(route.request().url()).searchParams;
    queries.push(query);
    return route.fulfill({json:{venues:[{
      ...venue, name:query.get("page") === "2" ? "Second result" : venue.name,
      search_availability:query.has("date") ? "available" : "not_checked",
    }], has_more:query.get("page") === "1"}});
  });
  await page.goto("/venues");
  await page.getByRole("button", {name:"Next", exact:true}).click();
  await expect(page.getByRole("heading", {name:"Second result"})).toBeVisible();
  await page.getByText("More requirements", {exact:true}).click();
  await page.getByLabel("Location", {exact:true}).fill("Building B");
  await page.getByLabel("Expected attendance", {exact:true}).fill("80");
  await page.getByLabel("Minimum capacity", {exact:true}).fill("100");
  await page.getByLabel("Layout", {exact:true}).selectOption("Classroom");
  await page.getByLabel("Required facilities").fill("Projector, Wi-Fi");
  await page.getByLabel("Accessibility features", {exact:true}).fill("Step-free access");
  await page.getByLabel("Date", {exact:true}).fill("2026-10-05");
  await page.getByLabel("Start time", {exact:true}).fill("09:00");
  await page.getByLabel("End time", {exact:true}).fill("10:00");
  await page.getByRole("button", {name:"Search venues", exact:true}).click();
  await expect(page.getByText("Available for selected time", {exact:true})).toBeVisible();
  expect(Object.fromEntries(queries.at(-1)!)).toEqual({
    page:"1", location:"Building B", attendance:"80", capacity:"100", layout:"Classroom",
    facilities:"Projector, Wi-Fi", accessibility:"Step-free access",
    date:"2026-10-05", start_time:"09:00", end_time:"10:00",
  });
  await page.getByRole("button", {name:"Next", exact:true}).click();
  await expect(page.getByRole("heading", {name:"Second result"})).toBeVisible();
  expect(queries.at(-1)!.get("location")).toBe("Building B");
  await page.getByRole("button", {name:"Clear filters", exact:true}).click();
  await expect(page.getByRole("heading", {name:venue.name, exact:true})).toBeVisible();
  expect(Object.fromEntries(queries.at(-1)!)).toEqual({page:"1"});
  await expect(page.getByLabel("Location", {exact:true})).toHaveValue("");
  await expect(page.getByLabel("Date", {exact:true})).toHaveValue("");
});

test("search explains invalid input, unavailable venues and no matching results", async ({page}) => {
  await page.setViewportSize({width:375, height:812});
  await page.route(API + "/venues?*", (route) => {
    const query = new URL(route.request().url()).searchParams;
    if (query.has("date") && !query.has("start_time")) {
      return route.fulfill({status:400, json:{error:"Choose a date, start time and end time together (Singapore time)."}});
    }
    return route.fulfill({json:{venues:query.has("location") ? [] : [
      {...venue, id:"retired", name:"Retired hall", is_retired:true},
      {...venue, id:"closed", name:"Closed hall", search_availability:"closed"},
      {...venue, id:"blocked", name:"Blocked hall", search_availability:"blocked"},
      {...venue, id:"booked", name:"Booked hall", search_availability:"booked"},
    ], has_more:false}});
  });
  await page.goto("/venues");
  for (const label of ["retired venue", "outside opening hours", "blocked for selected time", "confirmed booking"]) {
    await expect(page.getByText(`Unavailable — ${label}`, {exact:true})).toBeVisible();
  }
  await page.getByLabel("Date", {exact:true}).fill("2026-10-05");
  await page.getByRole("button", {name:"Search venues", exact:true}).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("start time and end time");
  await expect(page.getByLabel("Date", {exact:true})).toHaveValue("2026-10-05");
  await page.getByLabel("Start time", {exact:true}).fill("09:00");
  await page.getByLabel("End time", {exact:true}).fill("10:00");
  await page.getByText("More requirements", {exact:true}).click();
  await page.getByLabel("Location", {exact:true}).fill("Unknown location");
  await page.getByRole("button", {name:"Search venues", exact:true}).click();
  await expect(page.getByRole("heading", {name:"No venues match", exact:true})).toBeVisible();
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("a failed availability check can be retried with the same search", async ({page}) => {
  let failed = false;
  await page.route(API + "/venues?*", (route) => {
    const query = new URL(route.request().url()).searchParams;
    if (query.has("date") && !failed) {
      failed = true;
      return route.fulfill({status:503, json:{error:"Could not check venue availability. Contact the team."}});
    }
    return route.fulfill({json:{venues:[{...venue, search_availability:query.has("date") ? "available" : "not_checked"}], has_more:false}});
  });
  await page.goto("/venues");
  await page.getByLabel("Date", {exact:true}).fill("2026-10-05");
  await page.getByLabel("Start time", {exact:true}).fill("09:00");
  await page.getByLabel("End time", {exact:true}).fill("10:00");
  await page.getByRole("button", {name:"Search venues", exact:true}).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("Could not check venue availability");
  await expect(page.getByText("Available for selected time", {exact:true})).toHaveCount(0);
  await page.getByRole("button", {name:"Try again", exact:true}).click();
  await expect(page.getByText("Available for selected time", {exact:true})).toBeVisible();
});

test("event-first search offers catalogue choices and available-only results", async ({page}, testInfo) => {
  const queries: URLSearchParams[] = [];
  await page.route(API + "/venues?*", (route) => {
    const query = new URL(route.request().url()).searchParams;
    queries.push(query);
    return route.fulfill({json:{venues:[{...venue,
      search_availability: query.has("date") ? "available" : "not_checked",
    }], has_more:false}});
  });
  await page.goto("/venues");
  await expect(page.getByLabel("Location", {exact:true})).not.toBeVisible();
  await expect(page.getByLabel("Expected attendance", {exact:true})).toBeVisible();
  await expect(page.getByLabel("Only show available venues")).toBeDisabled();
  await page.getByLabel("Date", {exact:true}).fill("2026-10-05");
  await page.getByLabel("Start time", {exact:true}).fill("09:00");
  await page.getByLabel("End time", {exact:true}).fill("10:00");
  await page.getByLabel("Only show available venues").check();
  await page.getByText("More requirements", {exact:true}).click();
  await page.getByRole("button", {name:"+ Projector", exact:true}).click();
  await expect(page.getByLabel("Required facilities")).toHaveValue("Projector");
  await expect(page.getByRole("button", {name:"✓ Projector", exact:true})).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", {name:"+ Step-free access", exact:true}).click();
  await page.getByRole("button", {name:"Search venues", exact:true}).click();
  await expect(page.getByText("Available for selected time", {exact:true})).toBeVisible();
  expect(queries.at(-1)!.get("available_only")).toBe("true");
  expect(queries.at(-1)!.get("facilities")).toBe("Projector");
  expect(queries.at(-1)!.get("accessibility")).toBe("Step-free access");
  await expect(page.getByLabel("Applied filters")).toContainText("Available venues only");
  await page.screenshot({path: testInfo.outputPath("search-desktop.png"), fullPage:true});
  await page.setViewportSize({width:375, height:812});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path: testInfo.outputPath("search-mobile.png"), fullPage:true});
  await page.getByRole("button", {name:"✓ Projector", exact:true}).click();
  await expect(page.getByLabel("Required facilities")).toHaveValue("");
  await page.getByRole("button", {name:"Clear filters", exact:true}).click();
  await expect(page.getByLabel("Only show available venues")).not.toBeChecked();
  await expect(page.getByLabel("Applied filters")).toHaveCount(0);
});

test("invalid timing is caught before search and suggestions can fail independently", async ({page}) => {
  let reads = 0;
  await page.route(API + "/venues/filter-options", (route) => route.fulfill({status:503, json:{error:"Unavailable"}}));
  await page.route(API + "/venues?*", (route) => { reads++; return route.fulfill({json:{venues:[], has_more:false}}); });
  await page.goto("/venues");
  await expect(page.getByRole("heading", {name:"No venues yet", exact:true})).toBeVisible();
  await page.getByLabel("Date", {exact:true}).fill("2026-10-05");
  await page.getByLabel("Start time", {exact:true}).fill("10:00");
  await page.getByLabel("End time", {exact:true}).fill("09:00");
  await page.getByRole("button", {name:"Search venues", exact:true}).click();
  await expect(page.locator("main").getByRole("alert")).toHaveText("End time must be after start time on the same day.");
  expect(reads).toBe(1);
  await page.getByLabel("End time", {exact:true}).fill("11:00");
  await page.getByText("More requirements", {exact:true}).click();
  await page.getByLabel("Required facilities").fill("Projector");
  await page.getByRole("button", {name:"Search venues", exact:true}).click();
  await expect(page.getByRole("heading", {name:"No venues match", exact:true})).toBeVisible();
  await page.getByRole("button", {name:"Reset search", exact:true}).click();
  await expect(page.getByRole("heading", {name:"No venues yet", exact:true})).toBeVisible();
  await expect(page.getByLabel("Required facilities")).toHaveValue("");
  await expect(page.getByLabel("Date", {exact:true})).toHaveValue("");
});
