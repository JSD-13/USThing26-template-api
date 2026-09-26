import { type Static, type TSchema, Type } from "typebox";
import { WEEKDAYS } from "./recurrence.js";

// Request schemas deliberately declare no `default`s: Fastify's Ajv applies
// defaults while validating, which would inject values into PATCH bodies and
// overwrite stored fields. Defaults are applied in `parseEvent` instead.

// `Null` comes first: Fastify's Ajv coerces types, and tried second, `null`
// would already have been coerced to `""` by a string branch.
const Nullable = <T extends TSchema>(schema: T) =>
  Type.Union([Type.Null(), schema]);

const DateTime = (description: string) =>
  Type.String({ format: "date-time", description });

export const Recurrence = Type.Object(
  {
    frequency: Type.Enum(["daily", "weekly"], {
      description: "Whether the event repeats by day or by week.",
    }),
    interval: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 52,
        description:
          "Repeat every `interval` days or weeks. Defaults to 1 on create.",
      }),
    ),
    byWeekday: Type.Optional(
      Type.Array(Type.Enum([...WEEKDAYS]), {
        minItems: 1,
        uniqueItems: true,
        description:
          "Weekly only: the weekdays the event repeats on, in its time zone. Must include the weekday of `start`. Defaults to that weekday.",
      }),
    ),
    until: Type.Optional(
      DateTime(
        "No occurrence starts after this instant. Mutually exclusive with `count`.",
      ),
    ),
    count: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 1000,
        description:
          "Total number of occurrences, counted before `exceptions` are removed. Mutually exclusive with `until`.",
      }),
    ),
    exceptions: Type.Optional(
      Type.Array(DateTime("The start of a cancelled occurrence."), {
        maxItems: 1000,
        description:
          "Start times of individual occurrences to skip, as returned by `GET /events/occurrences`.",
      }),
    ),
  },
  {
    additionalProperties: false,
    description:
      "How the event repeats. Replaced as a whole on update; `null` makes the event one-off.",
  },
);

const eventFields = {
  title: Type.String({ minLength: 1, maxLength: 200 }),
  description: Type.Optional(Nullable(Type.String({ maxLength: 5000 }))),
  location: Type.Optional(Nullable(Type.String({ maxLength: 200 }))),
  color: Type.Optional(
    Nullable(
      Type.String({
        pattern: "^#[0-9a-fA-F]{6}$",
        description: "Display colour as a hex triplet, e.g. `#1e88e5`.",
      }),
    ),
  ),
  start: DateTime("Start of the (first) occurrence."),
  end: DateTime("End of the (first) occurrence. Must be after `start`."),
  timeZone: Type.Optional(
    Type.String({
      description:
        "IANA time zone recurrences are evaluated in. Defaults to `Asia/Hong_Kong` on create.",
    }),
  ),
  recurrence: Type.Optional(Nullable(Recurrence)),
};

export const EventInput = Type.Object(eventFields, {
  additionalProperties: false,
});

export const EventPatch = Type.Partial(EventInput, {
  description:
    "Fields to change. Omitted fields keep their value; `null` clears a nullable field.",
});

export const Event = Type.Object({
  id: Type.String(),
  title: eventFields.title,
  description: Nullable(Type.String()),
  location: Nullable(Type.String()),
  color: Nullable(Type.String()),
  start: eventFields.start,
  end: eventFields.end,
  timeZone: Type.String(),
  recurrence: Nullable(Recurrence),
  createdAt: DateTime("When the event was created."),
  updatedAt: DateTime("When the event was last modified."),
});

export const EventOccurrence = Type.Object({
  eventId: Type.String(),
  title: Type.String(),
  description: Nullable(Type.String()),
  location: Nullable(Type.String()),
  color: Nullable(Type.String()),
  start: DateTime("Start of this occurrence."),
  end: DateTime("End of this occurrence."),
});

export const EventParams = Type.Object({
  id: Type.String({ pattern: "^[0-9a-f]{24}$", description: "The event ID." }),
});

export const OccurrenceQuery = Type.Object({
  from: DateTime("Start of the window (inclusive)."),
  to: DateTime("End of the window (exclusive). At most 366 days after `from`."),
});

export type RecurrenceInput = Static<typeof Recurrence>;
export type EventInput = Static<typeof EventInput>;
export type EventPatch = Static<typeof EventPatch>;
export type Event = Static<typeof Event>;
export type EventOccurrence = Static<typeof EventOccurrence>;
