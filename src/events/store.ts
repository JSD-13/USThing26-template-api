import { type Collection, ObjectId } from "mongodb";
import type { EventDocument, EventFields } from "./model.js";

/**
 * Data access for the events of a single user.
 *
 * This is the authorization boundary of the service: every query and write
 * is filtered by `owner`, so route handlers have no way to reach another
 * user's events. A foreign event is indistinguishable from a missing one,
 * which keeps other users' event IDs from leaking through 403 responses.
 */
export function eventStore(
  collection: Collection<EventDocument>,
  owner: string,
) {
  const byId = (id: string) => ({ _id: new ObjectId(id), owner });

  return {
    /** All of the user's events, ordered by first occurrence. */
    list: () => collection.find({ owner }).sort({ start: 1, _id: 1 }).toArray(),

    /** The user's events with at least one occurrence overlapping `[from, to)`. */
    overlapping: (from: Date, to: Date) =>
      collection
        .find({
          owner,
          start: { $lt: to },
          $or: [{ seriesEnd: null }, { seriesEnd: { $gt: from } }],
        })
        .toArray(),

    get: (id: string) => collection.findOne(byId(id)),

    async create(fields: EventFields): Promise<EventDocument> {
      const now = new Date();
      const document: EventDocument = {
        ...fields,
        _id: new ObjectId(),
        owner,
        createdAt: now,
        updatedAt: now,
      };
      await collection.insertOne(document);
      return document;
    },

    /** Replaces the editable fields; resolves to `null` if the event is gone. */
    update: (id: string, fields: EventFields) =>
      collection.findOneAndUpdate(
        byId(id),
        { $set: { ...fields, updatedAt: new Date() } },
        { returnDocument: "after" },
      ),

    /** Resolves to whether an event was deleted. */
    async remove(id: string): Promise<boolean> {
      const { deletedCount } = await collection.deleteOne(byId(id));
      return deletedCount === 1;
    },
  };
}
