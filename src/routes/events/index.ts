import type { FastifyPluginAsync } from "fastify";
import { Type } from "typebox";
import type { FastifyTypebox } from "../../app.js";
import { applyPatch, parseEvent, toEvent } from "../../events/model.js";
import { occurrencesBetween } from "../../events/recurrence.js";
import {
  Event,
  EventInput,
  EventOccurrence,
  EventParams,
  EventPatch,
  OccurrenceQuery,
} from "../../events/schemas.js";
import { eventStore } from "../../events/store.js";
import type { AuthUser } from "../../plugins/auth.js";
import { HttpError } from "../../plugins/sensible.js";

/** The widest window `GET /events/occurrences` expands, bounding its cost. */
const MAX_WINDOW_DAYS = 366;
const DAY_MS = 24 * 60 * 60 * 1000;

const tags = ["Events"];
const security = [{ Auth: [] }];

/**
 * CRUD for a user's custom timetable events, plus a read-only view that
 * expands recurrences into concrete occurrences for rendering a timetable.
 *
 * Every route is authenticated, and data access goes through `eventStore`,
 * which confines each user to their own events.
 */
const events: FastifyPluginAsync = async (
  fastify: FastifyTypebox,
): Promise<void> => {
  fastify.withAuth(async (fastify) => {
    const storeOf = (user: AuthUser) =>
      eventStore(fastify.collections.events, user.username);
    const eventNotFound = () => fastify.httpErrors.notFound("Event not found");

    fastify.get(
      "/",
      {
        schema: {
          summary: "List events",
          description:
            "Returns all of the user's events, ordered by first occurrence. Recurring events appear once; use `/events/occurrences` to expand them.",
          tags,
          security,
          response: { 200: Type.Array(Event) },
        },
      },
      async (request) => (await storeOf(request.user).list()).map(toEvent),
    );

    fastify.post(
      "/",
      {
        schema: {
          summary: "Create an event",
          tags,
          security,
          body: EventInput,
          response: { 201: Event, 400: HttpError },
        },
      },
      async (request, reply) => {
        const created = await storeOf(request.user).create(
          parseEvent(request.body),
        );
        const event = toEvent(created);
        return reply
          .code(201)
          .header("location", `${fastify.prefix}/${event.id}`)
          .send(event);
      },
    );

    fastify.get(
      "/occurrences",
      {
        schema: {
          summary: "List occurrences in a time window",
          description: `Expands recurring events into the individual occurrences that overlap \`[from, to)\`, ordered by start. The window may span at most ${MAX_WINDOW_DAYS} days.`,
          tags,
          security,
          querystring: OccurrenceQuery,
          response: { 200: Type.Array(EventOccurrence), 400: HttpError },
        },
      },
      async (request) => {
        const from = new Date(request.query.from);
        const to = new Date(request.query.to);
        if (to <= from) {
          throw fastify.httpErrors.badRequest("`to` must be after `from`");
        }
        if (to.getTime() - from.getTime() > MAX_WINDOW_DAYS * DAY_MS) {
          throw fastify.httpErrors.badRequest(
            `The window may span at most ${MAX_WINDOW_DAYS} days`,
          );
        }

        const documents = await storeOf(request.user).overlapping(from, to);
        return documents
          .flatMap((document) =>
            occurrencesBetween(document, from, to).map((occurrence) => ({
              document,
              occurrence,
            })),
          )
          .toSorted(
            (a, b) =>
              a.occurrence.start.getTime() - b.occurrence.start.getTime(),
          )
          .map(({ document, occurrence }) => ({
            eventId: document._id.toHexString(),
            title: document.title,
            description: document.description,
            location: document.location,
            color: document.color,
            start: occurrence.start.toISOString(),
            end: occurrence.end.toISOString(),
          }));
      },
    );

    fastify.get(
      "/:id",
      {
        schema: {
          summary: "Get an event",
          tags,
          security,
          params: EventParams,
          response: { 200: Event, 404: HttpError },
        },
      },
      async (request) => {
        const event = await storeOf(request.user).get(request.params.id);
        if (!event) throw eventNotFound();
        return toEvent(event);
      },
    );

    fastify.patch(
      "/:id",
      {
        schema: {
          summary: "Update an event",
          description:
            "Changes only the fields present in the body; the result is validated as a whole. `recurrence` is replaced, not merged.",
          tags,
          security,
          params: EventParams,
          body: EventPatch,
          response: { 200: Event, 400: HttpError, 404: HttpError },
        },
      },
      async (request) => {
        const store = storeOf(request.user);
        const existing = await store.get(request.params.id);
        if (!existing) throw eventNotFound();
        const updated = await store.update(
          request.params.id,
          applyPatch(existing, request.body),
        );
        // The event may have been deleted between the read and the write.
        if (!updated) throw eventNotFound();
        return toEvent(updated);
      },
    );

    fastify.delete(
      "/:id",
      {
        schema: {
          summary: "Delete an event",
          description:
            "Deletes the event and all of its occurrences. To cancel a single occurrence of a recurring event, add it to `recurrence.exceptions` instead.",
          tags,
          security,
          params: EventParams,
          response: {
            204: Type.Null({ description: "The event was deleted." }),
            404: HttpError,
          },
        },
      },
      async (request, reply) => {
        const deleted = await storeOf(request.user).remove(request.params.id);
        if (!deleted) throw eventNotFound();
        return reply.code(204).send(null);
      },
    );
  });
};

export default events;
