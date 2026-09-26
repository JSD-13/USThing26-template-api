# timetable-api

The backend for custom events in the USThing timetable. Users create, update and delete their own events next to their class schedule; events can repeat (every Monday and Wednesday until the end of term, every other day ten times, …), and a user's whole timetable can be exported to any calendar app as an `.ics` file.

Built on the USThing Fastify + TypeScript + MongoDB template, running on Bun. For the architecture, data model and the reasoning behind the design, see [docs/design.md](docs/design.md).

## Running it

You need Bun 1.4.2 or newer (older versions break the MongoDB driver).

```sh
bun install
bun run dev
```

That serves http://localhost:3000 against a throwaway in-memory MongoDB, downloaded once (~150 MB) on first run.

### With Docker

```sh
docker compose up -d --build
```

This builds the service image and starts it on http://localhost:3000 next to a persistent MongoDB. To develop locally against that database instead, run `docker compose up -d mongodb`, copy `.env.example` to `.env`, and `bun run dev`.

## Environment

| Variable | What it does |
| --- | --- |
| `MONGO_URI` | MongoDB URI. Unset means in-memory in development; required in production (`NODE_ENV=production`). |
| `MONGO_TEST_URI` | Same thing, but for `bun test`. |
| `AUTH_SKIP` | Set to `true` to turn auth off locally; every request then acts as the user `anonymous`. |

## Authentication

Every endpoint takes a bearer token. The users and their tokens live in [src/auth/users.ts](src/auth/users.ts); two sample users, alice and bob, come with it. Their tokens act as passwords, so replace them before deploying anything real.

```sh
curl -H "Authorization: Bearer alice-dev-token" http://localhost:3000/me
# {"username":"alice","name":"Alice"}
```

Each user sees only their own events: another user's event responds exactly like one that does not exist (`404`).

## API

Interactive docs, generated from the route schemas, are served at http://localhost:3000/reference (Scalar) and http://localhost:3000/documentation (Swagger UI).

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/me` | The authenticated user. |
| `GET` | `/events` | All of the user's events, ordered by first occurrence. |
| `POST` | `/events` | Create an event. `201` with a `Location` header. |
| `GET` | `/events/{id}` | One event. |
| `PATCH` | `/events/{id}` | Change some fields of an event. |
| `DELETE` | `/events/{id}` | Delete an event and all its occurrences. `204`. |
| `GET` | `/events/occurrences?from=&to=` | Every occurrence in a time window, recurrences expanded. |
| `GET` | `/events/calendar.ics` | All events as an iCalendar file. |

### An event

```jsonc
{
  "id": "66f5a1c2e4b0a1b2c3d4e5f6",
  "title": "COMP 3111 Lecture",
  "description": null,
  "location": "LTA",
  "color": "#1e88e5",
  "start": "2026-09-28T01:30:00.000Z",   // first occurrence
  "end": "2026-09-28T02:50:00.000Z",
  "timeZone": "Asia/Hong_Kong",          // where "Monday" and "09:30" are evaluated
  "recurrence": {                        // null for a one-off event
    "frequency": "weekly",               // or "daily"
    "interval": 1,                       // every n days / weeks
    "byWeekday": ["MO", "WE"],           // weekly only
    "until": "2026-11-30T16:00:00.000Z", // or "count": 26, or neither for no end
    "exceptions": ["2026-10-05T01:30:00.000Z"] // cancelled occurrences
  },
  "createdAt": "2026-09-26T08:00:00.000Z",
  "updatedAt": "2026-09-26T08:00:00.000Z"
}
```

Times are ISO 8601 instants. `POST` takes the same shape without `id` and the timestamps; only `title`, `start` and `end` are required, and `timeZone` defaults to `Asia/Hong_Kong`. `PATCH` takes any subset of those fields: omitted fields are kept, `null` clears `description`, `location`, `color` or `recurrence`, and `recurrence` is replaced as a whole.

### Common tasks

Create a weekly lecture:

```sh
curl -X POST http://localhost:3000/events \
  -H "Authorization: Bearer alice-dev-token" -H "Content-Type: application/json" \
  -d '{"title":"COMP 3111 Lecture","location":"LTA",
       "start":"2026-09-28T01:30:00Z","end":"2026-09-28T02:50:00Z",
       "recurrence":{"frequency":"weekly","byWeekday":["MO","WE"],"until":"2026-11-30T16:00:00Z"}}'
```

Render one week of the timetable:

```sh
curl "http://localhost:3000/events/occurrences?from=2026-09-27T16:00:00Z&to=2026-10-04T16:00:00Z" \
  -H "Authorization: Bearer alice-dev-token"
```

Cancel a single class: `PATCH` the event with its `recurrence`, adding the occurrence's `start` (as returned by `/events/occurrences`) to `exceptions`.

### Errors

Errors are JSON, e.g.

```json
{ "error": "Bad Request", "code": "INVALID_EVENT", "message": "`end` must be after `start`", "statusCode": 400 }
```

`400` is a malformed request (`FST_ERR_VALIDATION`) or an inconsistent schedule (`INVALID_EVENT`), and `404` an event that does not exist or belongs to someone else. Authentication failures come from the template's auth plugin as plain text: `401` for a missing or unknown token, `400` for a malformed `Authorization` header.

## Scripts

| Script | What it does |
| --- | --- |
| `bun run dev` | Dev server, watch mode, debug logs |
| `bun run start` | Same without watch, info logs |
| `bun run test` | Tests, with coverage |
| `bun run compile` | Type-check `src` and `test` with `tsc` |
| `bun run check` | Read-only formatting + lint check |
| `bun run lint` | Auto-fix lint issues |
| `bun run fmt` | Auto-format the repo |

## Where things live

```
src/
  app.ts               # Fastify app: options, plugins, OpenAPI
  options.ts           # Environment variable parsing
  auth/users.ts        # Users and tokens
  events/              # The events domain, independent of HTTP
    schemas.ts         #   Request/response schemas (TypeBox → validation + OpenAPI)
    model.ts           #   Stored document, validation, conversion to API shape
    recurrence.ts      #   Recurrence expansion
    time-zone.ts       #   Wall-clock arithmetic in IANA time zones
    ical.ts            #   iCalendar serialisation
    store.ts           #   Owner-scoped MongoDB access (the authorization boundary)
  plugins/
    auth.ts            # Bearer-token auth + fastify.withAuth scopes
    init-mongo.ts      # MongoDB connection, collections and indexes
    sensible.ts        # HTTP error helpers
  routes/
    events/            # /events
    me/                # /me
test/
  events/              # Unit tests: recurrence and iCalendar
  routes/              # HTTP tests; events.test.ts boots the full app
```
