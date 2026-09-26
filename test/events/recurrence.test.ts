import { describe, expect, test } from "bun:test";
import {
  occurrences,
  occurrencesBetween,
  type RecurrenceRule,
  type Schedule,
  seriesEnd,
  weekdayOf,
} from "../../src/events/recurrence.js";

const HONG_KONG = "Asia/Hong_Kong";
const FAR_FUTURE = new Date("2100-01-01T00:00:00Z");

/** A 1h20m slot starting Monday 28 Sep 2026, 09:30 in Hong Kong. */
function lecture(recurrence: Partial<RecurrenceRule> | null): Schedule {
  return {
    start: new Date("2026-09-28T01:30:00Z"),
    end: new Date("2026-09-28T02:50:00Z"),
    timeZone: HONG_KONG,
    recurrence: recurrence && {
      frequency: "weekly",
      interval: 1,
      exceptions: [],
      ...recurrence,
    },
  };
}

const starts = (schedule: Schedule, horizon = FAR_FUTURE) =>
  occurrences(schedule, horizon).map(({ start }) => start.toISOString());

describe("occurrences", () => {
  test("a one-off event occurs once", () => {
    expect(occurrences(lecture(null), FAR_FUTURE)).toEqual([
      {
        start: new Date("2026-09-28T01:30:00Z"),
        end: new Date("2026-09-28T02:50:00Z"),
      },
    ]);
  });

  test("daily rules step by the interval", () => {
    expect(
      starts(lecture({ frequency: "daily", interval: 2, count: 3 })),
    ).toEqual([
      "2026-09-28T01:30:00.000Z",
      "2026-09-30T01:30:00.000Z",
      "2026-10-02T01:30:00.000Z",
    ]);
  });

  test("weekly rules repeat on every listed weekday", () => {
    expect(starts(lecture({ byWeekday: ["WE", "MO"], count: 4 }))).toEqual([
      "2026-09-28T01:30:00.000Z",
      "2026-09-30T01:30:00.000Z",
      "2026-10-05T01:30:00.000Z",
      "2026-10-07T01:30:00.000Z",
    ]);
  });

  test("weekly intervals skip whole weeks", () => {
    expect(
      starts(lecture({ interval: 2, byWeekday: ["MO", "FR"], count: 3 })),
    ).toEqual([
      "2026-09-28T01:30:00.000Z",
      "2026-10-02T01:30:00.000Z",
      "2026-10-12T01:30:00.000Z",
    ]);
  });

  test("weekdays are evaluated in the event's time zone, not UTC", () => {
    // 07:00 on a Monday in Hong Kong is still Sunday in UTC.
    const earlyMonday: Schedule = {
      start: new Date("2026-09-27T23:00:00Z"),
      end: new Date("2026-09-28T00:00:00Z"),
      timeZone: HONG_KONG,
      recurrence: {
        frequency: "weekly",
        interval: 1,
        byWeekday: ["MO", "TU"],
        count: 3,
        exceptions: [],
      },
    };
    expect(weekdayOf(earlyMonday.start, HONG_KONG)).toBe("MO");
    expect(starts(earlyMonday)).toEqual([
      "2026-09-27T23:00:00.000Z",
      "2026-09-28T23:00:00.000Z",
      "2026-10-04T23:00:00.000Z",
    ]);
  });

  test("local time of day is kept across a DST change", () => {
    // 09:00 in New York is 13:00Z in EDT and 14:00Z once DST ends on 1 Nov.
    const standup: Schedule = {
      start: new Date("2026-10-26T13:00:00Z"),
      end: new Date("2026-10-26T13:15:00Z"),
      timeZone: "America/New_York",
      recurrence: {
        frequency: "weekly",
        interval: 1,
        count: 2,
        exceptions: [],
      },
    };
    expect(occurrences(standup, FAR_FUTURE)).toEqual([
      {
        start: new Date("2026-10-26T13:00:00Z"),
        end: new Date("2026-10-26T13:15:00Z"),
      },
      {
        start: new Date("2026-11-02T14:00:00Z"),
        end: new Date("2026-11-02T14:15:00Z"),
      },
    ]);
  });

  test("count includes cancelled occurrences, as in RFC 5545", () => {
    const schedule = lecture({
      count: 3,
      exceptions: [new Date("2026-10-05T01:30:00Z")],
    });
    expect(starts(schedule)).toEqual([
      "2026-09-28T01:30:00.000Z",
      "2026-10-12T01:30:00.000Z",
    ]);
  });

  test("until is an inclusive bound on occurrence starts", () => {
    expect(
      starts(lecture({ until: new Date("2026-10-12T01:30:00Z") })),
    ).toEqual([
      "2026-09-28T01:30:00.000Z",
      "2026-10-05T01:30:00.000Z",
      "2026-10-12T01:30:00.000Z",
    ]);
  });

  test("endless series stop at the horizon", () => {
    expect(starts(lecture({}), new Date("2026-10-12T01:30:00Z"))).toEqual([
      "2026-09-28T01:30:00.000Z",
      "2026-10-05T01:30:00.000Z",
    ]);
  });
});

describe("occurrencesBetween", () => {
  test("includes occurrences already in progress at the window start", () => {
    const window = occurrencesBetween(
      lecture({}),
      new Date("2026-10-05T02:00:00Z"),
      new Date("2026-10-06T00:00:00Z"),
    );
    expect(window.map(({ start }) => start.toISOString())).toEqual([
      "2026-10-05T01:30:00.000Z",
    ]);
  });
});

describe("seriesEnd", () => {
  test("is the end of a one-off event", () => {
    expect(seriesEnd(lecture(null))).toEqual(new Date("2026-09-28T02:50:00Z"));
  });

  test("is the end of the last occurrence of a counted series", () => {
    expect(seriesEnd(lecture({ count: 3 }))).toEqual(
      new Date("2026-10-12T02:50:00Z"),
    );
  });

  test("bounds an until series by its last possible start", () => {
    expect(
      seriesEnd(lecture({ until: new Date("2026-12-01T00:00:00Z") })),
    ).toEqual(new Date("2026-12-01T01:20:00Z"));
  });

  test("is null for an endless series", () => {
    expect(seriesEnd(lecture({}))).toBeNull();
  });
});
