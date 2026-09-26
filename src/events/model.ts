import type { ObjectId } from "mongodb";
import {
  type RecurrenceRule,
  type Schedule,
  seriesEnd,
  weekdayOf,
} from "./recurrence.js";
import type {
  Event,
  EventInput,
  EventPatch,
  RecurrenceInput,
} from "./schemas.js";
import { isTimeZone } from "./time-zone.js";

const DEFAULT_TIME_ZONE = "Asia/Hong_Kong";

/** The validated, user-editable part of an event, as stored. */
export type EventFields = Schedule & {
  title: string;
  description: string | null;
  location: string | null;
  color: string | null;
  /**
   * Derived from the schedule (see `seriesEnd`) so range queries can skip
   * finished series without expanding them; `null` for endless series.
   */
  seriesEnd: Date | null;
};

/** An event as stored in the `events` collection. */
export type EventDocument = EventFields & {
  _id: ObjectId;
  /** Username of the user the event belongs to. */
  owner: string;
  createdAt: Date;
  updatedAt: Date;
};

/** An event that is well-formed JSON but not a valid schedule. */
export class InvalidEventError extends Error {
  readonly statusCode = 400;
  readonly code = "INVALID_EVENT";

  constructor(problems: string[]) {
    super(problems.join("; "));
    this.name = "InvalidEventError";
  }
}

// Optional keys are left out rather than set to `undefined`: the MongoDB
// driver would persist `undefined` as `null`.
function parseRecurrence(input: RecurrenceInput): RecurrenceRule {
  return {
    frequency: input.frequency,
    interval: input.interval ?? 1,
    ...(input.byWeekday && { byWeekday: input.byWeekday }),
    ...(input.until && { until: new Date(input.until) }),
    ...(input.count !== undefined && { count: input.count }),
    exceptions: (input.exceptions ?? []).map((date) => new Date(date)),
  };
}

function scheduleProblems(schedule: Schedule): string[] {
  const { start, end, timeZone, recurrence: rule } = schedule;
  if (end <= start) return ["`end` must be after `start`"];
  if (!isTimeZone(timeZone)) return [`unknown time zone "${timeZone}"`];
  if (!rule) return [];
  return [
    rule.until &&
      rule.count !== undefined &&
      "`until` and `count` are mutually exclusive",
    rule.until && rule.until < start && "`until` must not be before `start`",
    rule.byWeekday &&
      rule.frequency !== "weekly" &&
      "`byWeekday` requires a weekly frequency",
    rule.byWeekday &&
      !rule.byWeekday.includes(weekdayOf(start, timeZone)) &&
      "`start` must fall on one of `byWeekday` in the event's time zone",
  ].filter((problem) => typeof problem === "string");
}

/**
 * Validates an event beyond what its JSON schema can express, applies
 * defaults, and converts it to its stored form.
 *
 * @throws {InvalidEventError} if the schedule is inconsistent.
 */
export function parseEvent(input: EventInput): EventFields {
  const schedule: Schedule = {
    start: new Date(input.start),
    end: new Date(input.end),
    timeZone: input.timeZone ?? DEFAULT_TIME_ZONE,
    recurrence: input.recurrence ? parseRecurrence(input.recurrence) : null,
  };
  const problems = scheduleProblems(schedule);
  if (problems.length > 0) throw new InvalidEventError(problems);

  return {
    title: input.title,
    description: input.description ?? null,
    location: input.location ?? null,
    color: input.color ?? null,
    ...schedule,
    seriesEnd: seriesEnd(schedule),
  };
}

function formatRecurrence(rule: RecurrenceRule): RecurrenceInput {
  return {
    frequency: rule.frequency,
    interval: rule.interval,
    ...(rule.byWeekday && { byWeekday: rule.byWeekday }),
    ...(rule.until && { until: rule.until.toISOString() }),
    ...(rule.count !== undefined && { count: rule.count }),
    exceptions: rule.exceptions.map((date) => date.toISOString()),
  };
}

/** Converts a stored event to its API representation. */
export function toEvent(document: EventDocument): Event {
  return {
    id: document._id.toHexString(),
    title: document.title,
    description: document.description,
    location: document.location,
    color: document.color,
    start: document.start.toISOString(),
    end: document.end.toISOString(),
    timeZone: document.timeZone,
    recurrence: document.recurrence && formatRecurrence(document.recurrence),
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  };
}

/**
 * Applies a partial update to a stored event, re-validating the result as a
 * whole so that e.g. moving `start` past `end` is rejected.
 *
 * @throws {InvalidEventError} if the patched schedule is inconsistent.
 */
export function applyPatch(
  document: EventDocument,
  patch: EventPatch,
): EventFields {
  // `toEvent` yields a superset of `EventInput`; the extra read-only fields
  // (`id`, timestamps) are ignored by `parseEvent`.
  return parseEvent({ ...toEvent(document), ...patch });
}
