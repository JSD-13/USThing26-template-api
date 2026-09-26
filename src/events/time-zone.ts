/**
 * Wall-clock arithmetic in IANA time zones, built on `Intl` alone.
 *
 * A "wall-clock" date is a `Date` whose UTC fields hold the local date and
 * time in some zone (e.g. 09:00 in Hong Kong is stored as 09:00Z). This lets
 * recurrence code step through days with plain UTC arithmetic and convert back
 * to a real instant afterwards, so "every Monday at 09:00" stays at 09:00 local
 * time across DST changes and never slips onto the neighbouring UTC day.
 */

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  });
  formatters.set(timeZone, formatter);
  return formatter;
}

/** The offset of `timeZone` from UTC at `instant`, in milliseconds. */
function offsetAt(instant: number, timeZone: string): number {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const field = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  const wallClock = Date.UTC(
    field("year"),
    field("month") - 1,
    field("day"),
    field("hour"),
    field("minute"),
    field("second"),
  );
  // `formatToParts` drops milliseconds, so compare against the whole second.
  return wallClock - Math.floor(instant / 1000) * 1000;
}

/** Whether `timeZone` is an IANA time zone name known to the runtime. */
export function isTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** Converts an instant to its wall-clock date in `timeZone`. */
export function toWallClock(instant: Date, timeZone: string): Date {
  return new Date(instant.getTime() + offsetAt(instant.getTime(), timeZone));
}

/**
 * Converts a wall-clock date in `timeZone` back to an instant.
 *
 * The offset is looked up twice because the offset at the wall-clock value
 * (read as UTC) can differ from the offset at the true instant near a DST
 * transition. Nonexistent local times (inside a spring-forward gap) resolve to
 * a nearby valid instant.
 */
export function fromWallClock(wallClock: Date, timeZone: string): Date {
  const local = wallClock.getTime();
  const guess = local - offsetAt(local, timeZone);
  return new Date(local - offsetAt(guess, timeZone));
}
