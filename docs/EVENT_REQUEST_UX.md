# Event request usability follow-up

The user requested clearer event-request screens after manually verifying SCRUM-45
on 31 October 2026. This follow-up stays on the SCRUM-45 feature branch and covers
the request form, Organiser request list and shared event detail page.

## What changed

- **Request form:** a short process explanation, three numbered groups (event details,
  date/attendance, optional requirements), wider two-column desktop layout and stacked
  mobile fields. Helpers distinguish description from purpose, expected attendance
  from signup capacity, and saving privately from submitting for review. The success
  screen explains that submission still needs assignment/review and is not confirmation.
- **My requests:** search by event name, EVT reference or category; filter by actual
  request stage; matching count, clear-filters action and an explicit no-results state.
  Cards explain what stage the request has reached. Ownership and draft filtering run
  before these display filters. All records remain visible by default.
- **Event detail:** a clearer event header, a return link for Organisers, a current-step
  explanation and coordination summary, shortcuts to existing sections, and a more
  prominent registration-roster entry. Guidance is specific to the viewing role and
  clarification state; historical clarification does not override a closed-record message.

The customer-facing Planning badge already covers both intake and arrangements.
`requestStage` uses the existing `request_status` to explain the difference without
changing the badge, stored status or transition rules. Assignment guidance no longer
promises an assignment notification that Release 1 does not send (Decision D41).

## Constraints and review

This is presentation and local filtering only. Existing routes, payloads, form fields,
accessible action names, permissions, confirmation gates and database schema remain
the same. No changes to the venue-request permissions/dropdown or waiting-list signup
are included. The root/frontend AGENTS rules and semantic design tokens apply.

Jerome owns the implementation; the requesting project owner reviews the form layout,
stage wording, mobile usability and the clarity of the next step. No independent human
approval, hosted CI run, push or merge is claimed.

## Verification

The existing browser suite is retained. Three added browser tests verify search and
stage filtering (including different actual stages with the same Planning badge),
clear/no-results behaviour, assignment/review guidance, original action discoverability,
closed-record guidance and narrow-screen layouts. Desktop/mobile screenshots were
inspected. **286 browser tests and all four real browser/API/database journeys passed**,
along with the production build, TypeScript check, ESLint and whitespace check.
Backend code is unchanged from the verified SCRUM-45 implementation. Evidence and
screenshots are in `/private/tmp/scrum45-evidence`.

Manual walkthrough: open **New request**, **My requests**, then an owned event. Search
by its EVT reference, switch stages, clear filters and open the result. Check the
next-step message for an unassigned request, an assigned request and a confirmed event.
Use the event shortcuts and **View registrations**. Repeat on a narrow screen.
