// Exercises the events API end to end: the whole app is booted against an
// in-memory MongoDB (or MONGO_TEST_URI) and requests go through real
// authentication as the sample users alice and bob.

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import Fastify, { type InjectOptions } from "fastify";
import fp from "fastify-plugin";
import App from "../../src/app.js";
import type { Event, EventOccurrence } from "../../src/events/schemas.js";

const app = Fastify({ pluginTimeout: 5 * 60 * 1000 });

beforeAll(async () => {
  await app.register(fp(App), {
    test: true,
    mongoUri: undefined,
    mongoTestUri: Bun.env.MONGO_TEST_URI,
    authSkip: false,
  });
  await app.ready();
});

afterAll(() => app.close());

beforeEach(async () => {
  await app.collections.events.deleteMany({});
});

type User = "alice" | "bob";

const request = (user: User, options: InjectOptions) =>
  app.inject({
    ...options,
    headers: { authorization: `Bearer ${user}-dev-token`, ...options.headers },
  });

/** Mondays and Wednesdays, 09:30–10:50 Hong Kong time, until end of term. */
const LECTURE = {
  title: "COMP 3111 Lecture",
  location: "LTA",
  start: "2026-09-28T01:30:00.000Z",
  end: "2026-09-28T02:50:00.000Z",
  recurrence: {
    frequency: "weekly",
    byWeekday: ["MO", "WE"],
    until: "2026-11-30T16:00:00.000Z",
  },
};

async function create(user: User, payload: object = LECTURE): Promise<Event> {
  const res = await request(user, { method: "POST", url: "/events", payload });
  expect(res.statusCode).toBe(201);
  return res.json<Event>();
}

describe("CRUD", () => {
  test("creating an event applies defaults and returns its location", async () => {
    const res = await request("alice", {
      method: "POST",
      url: "/events",
      payload: LECTURE,
    });

    expect(res.statusCode).toBe(201);
    const event = res.json<Event>();
    expect(res.headers.location).toBe(`/events/${event.id}`);
    expect(event).toMatchObject({
      ...LECTURE,
      description: null,
      color: null,
      timeZone: "Asia/Hong_Kong",
      recurrence: { ...LECTURE.recurrence, interval: 1, exceptions: [] },
    });
    expect(event.createdAt).toBe(event.updatedAt);
  });

  test("created events can be fetched and listed", async () => {
    const created = await create("alice");

    const fetched = await request("alice", { url: `/events/${created.id}` });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json<Event>()).toEqual(created);

    const listed = await request("alice", { url: "/events" });
    expect(listed.json<Event[]>()).toEqual([created]);
  });

  test("patching changes only the given fields", async () => {
    const created = await create("alice");

    const res = await request("alice", {
      method: "PATCH",
      url: `/events/${created.id}`,
      payload: { title: "COMP 3111 Tutorial", location: null },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      ...created,
      title: "COMP 3111 Tutorial",
      location: null,
      updatedAt: expect.any(String),
    });
  });

  test("patches are validated against the merged event", async () => {
    const created = await create("alice");

    const res = await request("alice", {
      method: "PATCH",
      url: `/events/${created.id}`,
      payload: { start: "2026-09-28T03:00:00.000Z" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain("`end` must be after `start`");
  });

  test("deleted events are gone", async () => {
    const created = await create("alice");

    const deleted = await request("alice", {
      method: "DELETE",
      url: `/events/${created.id}`,
    });
    expect(deleted.statusCode).toBe(204);

    const fetched = await request("alice", { url: `/events/${created.id}` });
    expect(fetched.statusCode).toBe(404);
  });

  test("malformed event IDs are rejected", async () => {
    const res = await request("alice", { url: "/events/not-an-id" });
    expect(res.statusCode).toBe(400);
  });
});

describe("validation", () => {
  test.each([
    [{ ...LECTURE, end: LECTURE.start }, "`end` must be after `start`"],
    [{ ...LECTURE, timeZone: "Mars/Olympus_Mons" }, "unknown time zone"],
    [
      { ...LECTURE, recurrence: { ...LECTURE.recurrence, count: 10 } },
      "mutually exclusive",
    ],
    [
      { ...LECTURE, recurrence: { frequency: "daily", byWeekday: ["MO"] } },
      "requires a weekly frequency",
    ],
    [
      { ...LECTURE, recurrence: { frequency: "weekly", byWeekday: ["TU"] } },
      "`start` must fall on one of `byWeekday`",
    ],
  ])("rejects inconsistent schedules (%#)", async (payload, message) => {
    const res = await request("alice", {
      method: "POST",
      url: "/events",
      payload,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: "INVALID_EVENT" });
    expect(res.json().message).toContain(message);
  });

  test("rejects bodies that do not match the schema", async () => {
    const res = await request("alice", {
      method: "POST",
      url: "/events",
      payload: { ...LECTURE, title: "" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("FST_ERR_VALIDATION");
  });
});

describe("authorization", () => {
  test("requests without a token are rejected", async () => {
    const res = await app.inject({ url: "/events" });
    expect(res.statusCode).toBe(401);
  });

  test("users only see their own events", async () => {
    await create("alice");
    const bobs = await create("bob", { ...LECTURE, title: "Bob's event" });

    const res = await request("bob", { url: "/events" });
    expect(res.json<Event[]>()).toEqual([bobs]);
  });

  test("other users' events cannot be read, changed or deleted", async () => {
    const alices = await create("alice");
    const url = `/events/${alices.id}`;

    const responses = await Promise.all([
      request("bob", { url }),
      request("bob", { method: "PATCH", url, payload: { title: "Mine now" } }),
      request("bob", { method: "DELETE", url }),
    ]);
    expect(responses.map((res) => res.statusCode)).toEqual([404, 404, 404]);

    const unchanged = await request("alice", { url });
    expect(unchanged.json<Event>()).toEqual(alices);
  });
});

describe("occurrences", () => {
  test("expands recurring and one-off events within the window", async () => {
    const lecture = await create("alice", {
      ...LECTURE,
      recurrence: {
        ...LECTURE.recurrence,
        exceptions: ["2026-10-05T01:30:00.000Z"],
      },
    });
    const meeting = await create("alice", {
      title: "Club meeting",
      start: "2026-10-02T10:00:00.000Z",
      end: "2026-10-02T11:00:00.000Z",
    });
    await create("bob");

    const res = await request("alice", {
      url: "/events/occurrences?from=2026-09-28T00:00:00Z&to=2026-10-08T00:00:00Z",
    });

    expect(res.statusCode).toBe(200);
    expect(
      res
        .json<EventOccurrence[]>()
        .map(({ eventId, start }) => [eventId, start]),
    ).toEqual([
      [lecture.id, "2026-09-28T01:30:00.000Z"],
      [lecture.id, "2026-09-30T01:30:00.000Z"],
      [meeting.id, "2026-10-02T10:00:00.000Z"],
      [lecture.id, "2026-10-07T01:30:00.000Z"],
    ]);
  });

  test("skips series that ended before the window", async () => {
    await create("alice");

    const res = await request("alice", {
      url: "/events/occurrences?from=2027-01-01T00:00:00Z&to=2027-02-01T00:00:00Z",
    });
    expect(res.json<EventOccurrence[]>()).toEqual([]);
  });

  test.each([
    ["2026-10-01T00:00:00Z", "2026-09-01T00:00:00Z"],
    ["2026-01-01T00:00:00Z", "2027-06-01T00:00:00Z"],
  ])("rejects the window %s to %s", async (from, to) => {
    const res = await request("alice", {
      url: `/events/occurrences?from=${from}&to=${to}`,
    });
    expect(res.statusCode).toBe(400);
  });
});
