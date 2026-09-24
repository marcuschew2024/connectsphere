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

