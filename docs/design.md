# Design

How the timetable events service is put together, and why. For running the service and a tour of the endpoints, see the [README](../README.md); the complete interface is the OpenAPI document served at `/documentation/json`.

## Layers

```
routes/events  ──►  events/model  ──►  events/recurrence ──► events/time-zone
     │                                  events/ical
     └──────────►  events/store  ──►  MongoDB (collections.events)
```

- **Routes** (`src/routes/events`) own HTTP: schemas, status codes, headers, and turning "not found" into `404`. Each handler is a few lines of wiring.
- **The events domain** (`src/events`) knows nothing about Fastify. Validation, recurrence and iCalendar generation are pure functions over plain data, so almost all the logic is unit-tested without a server or database (`test/events`).
- **The store** (`src/events/store.ts`) is the only code that queries the `events` collection.

## Schemas and validation

Request and response shapes are TypeBox schemas (`src/events/schemas.ts`). One definition gives three things: Ajv validation at the edge, TypeScript types for handlers, and the OpenAPI document. Responses are serialised through their schemas as well, so internal fields like `owner` and `seriesEnd` cannot leak.

A JSON schema cannot express rules that relate fields ("`end` after `start`", "`start` falls on one of `byWeekday`"). Those live in `parseEvent`, which throws an `InvalidEventError` with status `400` and code `INVALID_EVENT`. The error lists every problem at once, so a client can fix them all in one go.

Two details of Fastify's Ajv configuration shaped the schemas:

- Request schemas declare no `default`s. Ajv applies defaults while validating, so a default on `timeZone` would inject `"Asia/Hong_Kong"` into every `PATCH` and silently overwrite the stored zone. Defaults are applied in `parseEvent` instead.
- Nullable fields put `null` first in the union. Ajv coerces types, and a `string` branch tried first turns `null` into `""`.

## API design

- **Resource-oriented REST.** `/events` is a collection and `/events/{id}` a member. `POST` returns `201` with a `Location` header, and `DELETE` returns `204`.
- **`PATCH` for updates.** Omitted fields are kept and `null` clears a nullable field, in the style of JSON Merge Patch (RFC 7396). The only exception is `recurrence`, which is replaced as a whole: merging parts of two recurrence rules rarely means anything sensible. The merged event is validated as a whole, so moving `start` past `end` fails even though each field is valid on its own.
- **Series and occurrences are separate views.** `GET /events` returns what the user edits, one entry per series. `GET /events/occurrences?from&to` returns what the timetable renders: concrete, sorted time slots for a window. Keeping them apart means clients never implement recurrence themselves, and the edit view never needs a date range.
- **Bounded work per request.** The occurrences window is capped at 366 days. Recurrence `count` (≤ 1000), `interval` (≤ 52) and string lengths are capped by the schema.

## Authentication and authorization

**Authentication** reuses the template's bearer-token plugin. Every route sits inside `fastify.withAuth`, which resolves the token to `request.user` or rejects the request. Its error responses are documented automatically. The user table is static (`src/auth/users.ts`). In production it would be replaced by verifying the university SSO's tokens, without touching the events code.

**Authorization** is ownership: a user can do anything to their own events and nothing to anyone else's. It is enforced in one place. `eventStore(collection, owner)` builds every query from a filter containing `owner`, and handlers receive only a store bound to `request.user.username`. A handler cannot forget an ownership check, because there is no unscoped query available to it.

Other users' events answer `404`, never `403`. A `403` would confirm that an ID exists. ObjectIds are partly predictable (timestamp and counter), so that would leak information.

## Data model

One collection, `events`, with one document per event series:

| Field | Type | Notes |
| --- | --- | --- |
| `_id` | ObjectId | Exposed as `id`. |
| `owner` | string | Username; set from the token, never from the body. |
| `title`, `description`, `location`, `color` | string / null | Absent optional fields are stored as `null`, so documents have one shape. |
| `start`, `end` | Date | The first occurrence. Every occurrence has the same duration. |
| `timeZone` | string | IANA zone used to evaluate the recurrence. |
| `recurrence` | object / null | See below. `until` and `exceptions` are Dates. |
| `seriesEnd` | Date / null | Derived: latest end of any occurrence; `null` if the series never ends. |
| `createdAt`, `updatedAt` | Date | |

Dates are stored as BSON dates, not strings, so they compare and index correctly.

**Index.** `{ owner: 1, start: 1 }` serves every query the store makes. All of them filter by `owner`; the list sorts by `start`; the occurrences query range-filters on it.

**Why `seriesEnd`.** Finding the events that overlap a window needs "starts before the window ends, and ends after it starts". For a recurring event, "ends" means the end of its last occurrence, which the rule defines only implicitly. Storing it when the event is written makes the query a plain `start < to AND (seriesEnd IS NULL OR seriesEnd > from)`. The alternative is expanding every series the user has ever created on every request. For `until`-bounded rules `seriesEnd` is an upper bound rather than the exact end, which is all the query needs.

Occurrences are never stored. They are computed from the rule, so editing a series (moving the lecture to another room) updates all of them for free.

## Recurrence

The rule is a deliberately small subset of iCalendar's RRULE: `DAILY` or `WEEKLY`, with `INTERVAL`, `BYDAY` (weekly only), and `UNTIL` or `COUNT`. `EXDATE`-style `exceptions` cancel single occurrences. That covers what a student's timetable needs (weekly classes, every-other-week labs, daily revision sessions), and it maps one-to-one onto RRULE, so the `.ics` export is lossless. The semantics follow RFC 5545 where it has an opinion:

- `count` counts occurrences before exceptions are removed, so cancelling one class does not push the series a week longer.
- `until` is an inclusive bound on occurrence starts.
- The first occurrence is `start` itself, so `start` must fall on one of `byWeekday`. Rejecting a mismatch avoids RFC 5545's ambiguous behaviour when it doesn't.

### Time zones

Recurrence is evaluated in the event's time zone, not in UTC, and this matters even in Hong Kong. A lecture at 07:30 on Monday is 23:30 on *Sunday* in UTC, so a UTC-based "every Monday" puts every occurrence after the first on the wrong day. `src/events/time-zone.ts` converts instants to "wall-clock" dates, and the expansion steps through those in whole days before converting back. Weekdays and times of day therefore stay local. In zones with daylight saving time, 09:00 stays 09:00 across the transition (the test suite checks this for New York). There are no dependencies: the offsets come from `Intl.DateTimeFormat`, which ships the IANA database with the runtime.

The expansion is a lazy generator, stopped by `count`, `until`, or the caller's horizon (the end of the requested window), so endless series are safe to expand.

## iCalendar export

`GET /events/calendar.ics` renders RFC 5545 by hand (`src/events/ical.ts`); the format is small enough that a dependency would cost more than it saves. The serializer covers:

- text escaping
- folding at 75 octets without splitting UTF-8 sequences
- CRLF line endings
- stable `UID`s derived from the event ID, so re-importing updates events instead of duplicating them

Series export as `RRULE` and `EXDATE`, not as expanded occurrences, so a calendar app keeps a single editable series.

Times are written in local time with `TZID=Asia/Hong_Kong` (or the event's zone), for the same weekday reason as above. RFC 5545 asks for a `VTIMEZONE` definition of each `TZID`. Google Calendar, Apple Calendar and Outlook all resolve IANA names themselves, so these are omitted.

## Known limitations and next steps

- **Editing one occurrence** (moving a single class) is not supported; only cancelling one is. Supporting it would mean override records keyed by original start, like iCalendar's `RECURRENCE-ID`.
- **Monthly and yearly rules** are not supported; they can be added in `candidateStarts` without changing the storage format.
- **Calendar subscriptions**: calendar apps cannot send a bearer header. A per-user secret feed URL would let them subscribe to `/events/calendar.ics` instead of importing it once.
- **Pagination** of `GET /events` is omitted because a personal timetable is small. The occurrences endpoint is the one that scales with time, and it is bounded by its window.
- **Concurrent edits**: `PATCH` reads, merges and writes, so two simultaneous patches to the same event can lose one update. Conditioning the write on `updatedAt` (optimistic concurrency, `409` on conflict) would close that gap.
