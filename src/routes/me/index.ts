import type { FastifyPluginAsync } from "fastify";
import { Type } from "typebox";
import type { FastifyTypebox } from "../../app.js";

/**
 * Identifies the caller, letting clients check a bearer token before using
 * it and label the timetable with the user's name.
 */
const me: FastifyPluginAsync = async (
  fastify: FastifyTypebox,
): Promise<void> => {
  fastify.withAuth(async (fastify) => {
    fastify.get(
      "/",
      {
        schema: {
          summary: "Get the current user",
          tags: ["Auth"],
          security: [{ Auth: [] }],
          response: {
            200: Type.Object({
              username: Type.String(),
              name: Type.Union([Type.String(), Type.Null()]),
            }),
          },
        },
      },
      async (request) => request.user,
    );
  });
};

export default me;
