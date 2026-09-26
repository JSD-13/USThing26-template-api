import type { EventDocument } from "./model.js";
import type { RecurrenceRule } from "./recurrence.js";
import { toWallClock } from "./time-zone.js";

const PRODUCT_ID = "-//USThing//Timetable//EN";
const UID_DOMAIN = "timetable.usthing";
const MAX_LINE_OCTETS = 75;

const encoder = new TextEncoder();

/** Escapes a TEXT value (RFC 5545 §3.3.11). */
const escapeText = (text: string): string =>
  text.replace(/[\\;,]/g, (char) => `\\${char}`).replace(/\r?\n/g, "\\n");

/** Formats an instant as a UTC DATE-TIME, e.g. `20260928T010000Z`. */
const formatUtc = (instant: Date): string =>
  instant
    .toISOString()
    .replace(/\.\d{3}/, "")
    .replace(/[-:]/g, "");

/** Formats an instant as a local DATE-TIME in `timeZone`, e.g. `20260928T090000`. */
const formatLocal = (instant: Date, timeZone: string): string =>
  formatUtc(toWallClock(instant, timeZone)).slice(0, -1);

/**
 * Folds a content line into chunks of at most 75 octets, joined by CRLF and
 * a leading space (RFC 5545 §3.1). Splits between code points, never inside a
 * multi-byte UTF-8 sequence.
 */
function fold(line: string): string {
  const chunks: string[] = [];
  let chunk = "";
  let octets = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    // Continuation lines spend one octet on their leading space.
    const limit = chunks.length === 0 ? MAX_LINE_OCTETS : MAX_LINE_OCTETS - 1;
    if (octets + size > limit) {
      chunks.push(chunk);
      chunk = "";
      octets = 0;
    }
    chunk += char;
    octets += size;
  }
  return [...chunks, chunk].join("\r\n ");
}

function recurrenceRule(rule: RecurrenceRule): string {
  const parts = [
    `FREQ=${rule.frequency.toUpperCase()}`,
    `INTERVAL=${rule.interval}`,
    rule.byWeekday && `BYDAY=${rule.byWeekday.join(",")}`,
    // UNTIL must be in UTC when DTSTART carries a TZID.
    rule.until && `UNTIL=${formatUtc(rule.until)}`,
    rule.count !== undefined && `COUNT=${rule.count}`,
  ].filter((part) => typeof part === "string");
  return `RRULE:${parts.join(";")}`;
}

function eventLines(event: EventDocument): string[] {
  const { timeZone, recurrence: rule } = event;
  const local = (instant: Date) => formatLocal(instant, timeZone);
  return [
    "BEGIN:VEVENT",
    `UID:${event._id.toHexString()}@${UID_DOMAIN}`,
    `DTSTAMP:${formatUtc(event.updatedAt)}`,
    `CREATED:${formatUtc(event.createdAt)}`,
    `LAST-MODIFIED:${formatUtc(event.updatedAt)}`,
    `DTSTART;TZID=${timeZone}:${local(event.start)}`,
    `DTEND;TZID=${timeZone}:${local(event.end)}`,
    `SUMMARY:${escapeText(event.title)}`,
    event.description !== null &&
      `DESCRIPTION:${escapeText(event.description)}`,
    event.location !== null && `LOCATION:${escapeText(event.location)}`,
    rule && recurrenceRule(rule),
    rule &&
      rule.exceptions.length > 0 &&
      `EXDATE;TZID=${timeZone}:${rule.exceptions.map(local).join(",")}`,
    "END:VEVENT",
  ].filter((line) => typeof line === "string");
}

/**
 * Renders events as an RFC 5545 iCalendar object with CRLF line endings.
 *
 * Times are written as local times with a `TZID` parameter so that weekly
 * rules repeat on the right local weekday. Mainstream clients (Google
 * Calendar, Apple Calendar, Outlook) resolve IANA `TZID`s themselves, so no
 * `VTIMEZONE` components are emitted.
 */
export function toICalendar(events: EventDocument[]): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODUCT_ID}`,
    "CALSCALE:GREGORIAN",
    "X-WR-CALNAME:USThing Timetable",
    ...events.flatMap(eventLines),
    "END:VCALENDAR",
  ];
  return `${lines.map(fold).join("\r\n")}\r\n`;
}
