# SCRUM-168 — Propose-values panel crams the venue options into one grid cell

**Type:** bug fix (frontend, cosmetic) · **Owner:** Jessica Ang
**Branch:** `fix/SCRUM-168-change-request-venue-options-layout`

## The defect

In the event change-request flow, the "Propose new values (optional)" panel opened a
`grid gap-3 sm:grid-cols-2` and rendered `<EventVenueOptions>` as its **first child** —
one cell of that grid. The component is itself a two-column block whose Accessibility
group expects the full panel width, so inside half a row its checkbox groups collapsed to
one pill per line, the "Other layouts" / "Other facilities" inputs shrank to roughly
150px beside their Add buttons, and the eight plain inputs flowed around it instead of
forming their own block.

`/events/new`, `/events/{id}/edit` and the resubmit form were unaffected — all three
already place the component as a full-width block inside a `fieldset`.

## The fix

`event-change-requests.tsx`

- The field grid now holds only the simple inputs. Title and registration requirements
  carry `sm:col-span-2`; the remaining six pair up two to a row:

  | | |
  | --- | --- |
  | New title | *(full width)* |
  | New date and time | New expected attendance |
  | New category | New purpose |
  | New event description | New equipment requirements |
  | New registration requirements | *(full width)* |

  The pairing is deliberate: date and attendance are the two fields that flag a re-review
  when approved (`SIGNIFICANT_FIELDS`), category and purpose are both short
  classifications, description and equipment are both long free text. The two full-width
  fields are the event's identity and its longest free-text field.

- `<EventVenueOptions>` moved below that grid as its own full-width block.

`event-venue-options.tsx` — **deviation from the ticket**, which assumed this component
would stay unchanged. The owner asked for Layouts, Facilities and Accessibility features
each on their own row in this panel. That is a new `stacked` prop, defaulting to `false`,
so the request, edit and resubmit forms render exactly as before.

Two things had to change behind that flag, not one. Dropping `sm:grid-cols-2` from the
root was not enough: the Accessibility wrapper's `sm:col-span-2` **creates** an implicit
second column in a grid with no explicit template, so the browser rebuilt the two-column
grid and auto-placed Layouts and Facilities side by side again. A stacked grid therefore
spans nothing.

## Scope

No change to submitted data, change-request fields, API or authorisation. The hidden
inputs `EventVenueOptions` emits are untouched, so the request body is byte-identical.
No Decision Log entry: no contract, schema or domain rule changed.

## Verification

| Lane | Test | Proves |
| --- | --- | --- |
| frontend | `panels-coverage.test.tsx` — "keeps the venue options out of the grid that lays out the simple fields" | the venue groups are not descendants of the field grid |
| browser | `change-requests.spec.ts` — "the propose-values panel gives the venue options their own full-width rows" | measured geometry: full-width title and registration, date/attendance paired, each venue group on its own row at panel width |

The browser assertions are geometric on purpose. A class-name assertion would have passed
against the broken layout, and would also have passed against the half-fixed version that
still paired Layouts and Facilities through the implicit column.

- `npm run lint`, `npm run build` clean
- `npm run test:coverage:combined` — 100% statements, branches, functions and lines
- `python scripts/qa/report.py --validate` — 26 requirement mappings validated;
  CORE-07 now lists SCRUM-168 with both checks

## Human review

- The `stacked` prop is used by one of four call sites. There is no design reason the
  change-request panel should differ from the other three forms; the flag exists to keep
  this fix from restyling pages the ticket does not cover. If stacked is the layout the
  team prefers, a follow-up should make all four consistent and delete the prop.
- Stacked groups make each checkbox pill roughly twice as wide. Confirm that reads
  acceptably before merge.
