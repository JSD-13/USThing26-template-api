import { expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import { toICalendar } from "../../src/events/ical.js";
import type { EventDocument } from "../../src/events/model.js";

const ID = new ObjectId("66f5a0000000000000000001");

function event(overrides: Partial<EventDocument> = {}): EventDocument {
  return {
    _id: ID,
    owner: "alice",
    title: "COMP 3111 Lecture",
    description: null,
    location: null,
    color: null,
    start: new Date("2026-09-28T01:30:00Z"),
    end: new Date("2026-09-28T02:50:00Z"),
    timeZone: "Asia/Hong_Kong",
    recurrence: null,
    seriesEnd: new Date("2026-09-28T02:50:00Z"),
    createdAt: new Date("2026-09-01T00:00:00Z"),
    updatedAt: new Date("2026-09-02T00:00:00Z"),
    ...overrides,
  };
}

const lines = (calendar: string) => calendar.split("\r\n");

test("wraps events in a VCALENDAR with CRLF line endings", () => {
  const calendar = toICalendar([event()]);
  expect(calendar.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
  expect(calendar.endsWith("END:VCALENDAR\r\n")).toBe(true);
  expect(calendar.replaceAll("\r\n", "")).not.toContain("\n");
});

test("writes start and end as local times in the event's time zone", () => {
  expect(lines(toICalendar([event()]))).toEqual(
    expect.arrayContaining([
      `UID:${ID.toHexString()}@timetable.usthing`,
      "DTSTAMP:20260902T000000Z",
      "DTSTART;TZID=Asia/Hong_Kong:20260928T093000",
      "DTEND;TZID=Asia/Hong_Kong:20260928T105000",
      "SUMMARY:COMP 3111 Lecture",
    ]),
  );
});

test("omits empty optional properties", () => {
  const calendar = toICalendar([event()]);
  expect(calendar).not.toContain("LOCATION");
  expect(calendar).not.toContain("DESCRIPTION");
  expect(calendar).not.toContain("RRULE");
});

test("escapes TEXT values", () => {
  const calendar = toICalendar([
    event({ location: "LTA, Academic Building", description: "a;b\\c\nd" }),
  ]);
  expect(lines(calendar)).toEqual(
    expect.arrayContaining([
      "LOCATION:LTA\\, Academic Building",
      "DESCRIPTION:a\\;b\\\\c\\nd",
    ]),
  );
});

test("exports recurrence as RRULE and EXDATE", () => {
  const calendar = toICalendar([
    event({
      recurrence: {
        frequency: "weekly",
        interval: 1,
        byWeekday: ["MO", "WE"],
        until: new Date("2026-11-30T16:00:00Z"),
        exceptions: [
          new Date("2026-10-05T01:30:00Z"),
          new Date("2026-10-07T01:30:00Z"),
        ],
      },
    }),
  ]);
  expect(lines(calendar)).toEqual(
    expect.arrayContaining([
      "RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE;UNTIL=20261130T160000Z",
      "EXDATE;TZID=Asia/Hong_Kong:20261005T093000,20261007T093000",
    ]),
  );
});

test("folds long lines at 75 octets without splitting characters", () => {
  const description = "課".repeat(60); // 3 octets each in UTF-8
  const calendar = toICalendar([event({ description })]);
  const encoder = new TextEncoder();

  expect(
    lines(calendar).every((line) => encoder.encode(line).length <= 75),
  ).toBe(true);
  // Unfolding (RFC 5545 §3.1) restores the original value.
  expect(calendar.replaceAll("\r\n ", "")).toContain(
    `DESCRIPTION:${description}`,
  );
});
