import { fromWallClock, toWallClock } from "./time-zone.js";

/** RFC 5545 weekday codes, Monday first (the default week start). */
export const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;

export type Weekday = (typeof WEEKDAYS)[number];

/**
 * A recurrence rule, modelled on a subset of RFC 5545 RRULE plus EXDATE.
 *
 * Occurrences repeat every `interval` days or weeks from the event's start.
 * `until` (inclusive bound on occurrence starts) and `count` (number of
 * occurrences, counted before exceptions are removed) are mutually exclusive;
 * with neither, the series never ends.
 */
export type RecurrenceRule = {
  frequency: "daily" | "weekly";
  interval: number;
  /** Weekly only. Defaults to the weekday of the event's start. */
  byWeekday?: Weekday[];
  until?: Date;
  count?: number;
  /** Start times of individual occurrences that have been cancelled. */
  exceptions: Date[];
};

/** When an event happens: its first occurrence and how it repeats. */
export type Schedule = {
  start: Date;
  end: Date;
  /** IANA time zone the recurrence is evaluated in. */
  timeZone: string;
  recurrence: RecurrenceRule | null;
};

export type Occurrence = { start: Date; end: Date };

const DAY_MS = 24 * 60 * 60 * 1000;

/** The latest instant a `Date` can represent. */
const END_OF_TIME = new Date(8.64e15);

const addDays = (date: Date, days: number): Date =>
  new Date(date.getTime() + days * DAY_MS);

/** Day of the week of a wall-clock date, counting from Monday = 0. */
const weekdayIndex = (wallClock: Date): number =>
  (wallClock.getUTCDay() + 6) % 7;

/** The local weekday of `instant` in `timeZone`. */
export function weekdayOf(instant: Date, timeZone: string): Weekday {
  return WEEKDAYS[weekdayIndex(toWallClock(instant, timeZone))]!;
}

/**
 * Yields the wall-clock start of every instance the rule generates, in order
 * and without end; `until`, `count` and exceptions are applied by the caller.
 */
function* candidateStarts(
  schedule: Schedule,
  rule: RecurrenceRule,
): Generator<Date> {
  const first = toWallClock(schedule.start, schedule.timeZone);

  if (rule.frequency === "daily") {
    for (let step = 0; ; step++) {
      yield addDays(first, step * rule.interval);
    }
  }

  const weekStart = addDays(first, -weekdayIndex(first));
  const dayOffsets = (
    rule.byWeekday ?? [weekdayOf(schedule.start, schedule.timeZone)]
  )
    .map((weekday) => WEEKDAYS.indexOf(weekday))
    .toSorted((a, b) => a - b);
  for (let week = 0; ; week += rule.interval) {
    for (const offset of dayOffsets) {
      const candidate = addDays(weekStart, week * 7 + offset);
      if (candidate.getTime() >= first.getTime()) yield candidate;
    }
  }
}

/** Yields the start of every instance before `horizon`, honouring `until` and `count`. */
function* instanceStarts(
  schedule: Schedule,
  rule: RecurrenceRule,
  horizon: Date,
): Generator<Date> {
  let generated = 0;
  for (const wallClock of candidateStarts(schedule, rule)) {
    const start = fromWallClock(wallClock, schedule.timeZone);
    if (
      generated === rule.count ||
      (rule.until !== undefined && start > rule.until) ||
      start >= horizon
    ) {
      return;
    }
    generated += 1;
    yield start;
  }
}

/** Expands a schedule into its occurrences starting before `horizon`, in order. */
export function occurrences(schedule: Schedule, horizon: Date): Occurrence[] {
  const duration = schedule.end.getTime() - schedule.start.getTime();
  const rule = schedule.recurrence;
  const starts = rule
    ? Array.from(instanceStarts(schedule, rule, horizon)).filter(
        (start) =>
          !rule.exceptions.some(
            (exception) => exception.getTime() === start.getTime(),
          ),
      )
    : [schedule.start].filter((start) => start < horizon);
  return starts.map((start) => ({
    start,
    end: new Date(start.getTime() + duration),
  }));
}

/** The occurrences of a schedule that overlap the window `[from, to)`. */
export function occurrencesBetween(
  schedule: Schedule,
  from: Date,
  to: Date,
): Occurrence[] {
  return occurrences(schedule, to).filter(
    (occurrence) => occurrence.end > from,
  );
}

/**
 * The latest instant any occurrence of the schedule can end, or `null` if the
 * series repeats forever. For `until`-bounded rules this is an upper bound
 * rather than the exact end, which is all range queries need.
 */
export function seriesEnd(schedule: Schedule): Date | null {
  const rule = schedule.recurrence;
  if (!rule) return schedule.end;
  if (rule.until) {
    const duration = schedule.end.getTime() - schedule.start.getTime();
    return new Date(rule.until.getTime() + duration);
  }
  if (rule.count !== undefined) {
    return occurrences(schedule, END_OF_TIME).at(-1)?.end ?? schedule.end;
  }
  return null;
}
