// Proves the default MongoDB wiring: with no MONGO_URI configured, building
// the app spawns an in-memory MongoDB and prepares the `events` collection —
// no external services needed.
//
// The app plugin is wrapped in `fastify-plugin` at the registration site (the
// same pattern the production dev scripts use) so the decorators added by the
// autoloaded plugins (`fastify.collections`, `fastify.mongo`) collapse onto
// this root instance: fastify-cli's `helper.build` keeps them scoped inside
// the autoloader, invisible to the instance it returns.

import { onTestFinished, test } from "bun:test";
import * as assert from "node:assert";
import Fastify from "fastify";
import fp from "fastify-plugin";
import App from "../src/app.js";

test("the events collection is created with its owner/start index", async () => {
  // pluginTimeout covers the first-run download of the in-memory MongoDB
  // binary, which can outlast Fastify's 10s default.
  const app = Fastify({ pluginTimeout: 5 * 60 * 1000 });
  onTestFinished(() => app.close());

  await app.register(fp(App), {
    mongoUri: undefined,
    mongoTestUri: undefined,
    authSkip: true,
  });
  await app.ready();

  const indexes = await app.collections.events.indexes();
  assert.ok(
    indexes.some(
      (index) => JSON.stringify(index.key) === '{"owner":1,"start":1}',
    ),
  );
});

test("the app reports ready with the collections decorated", async () => {
  const app = Fastify({ pluginTimeout: 5 * 60 * 1000 });
  onTestFinished(() => app.close());

  await app.register(fp(App), {
    mongoUri: undefined,
    mongoTestUri: undefined,
    authSkip: true,
  });
  await app.ready();

  assert.ok(app.collections);
  assert.ok(typeof app.withAuth === "function");
});
