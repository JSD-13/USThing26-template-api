import { onTestFinished, test } from "bun:test";
import * as assert from "node:assert";
import Fastify from "fastify";
import AuthPlugin, { type AuthPluginOptions } from "../../src/plugins/auth.js";
import Sensible from "../../src/plugins/sensible.js";
import Me from "../../src/routes/me/index.js";

// Register the internal auth plugin and the /me route on a bare Fastify
// instance. `authSkip` defaults to false, so scoped requests must present one
// of the bearer tokens defined in src/auth/users.ts.
async function buildAuthApp(options: AuthPluginOptions = {}) {
  const app = Fastify();
  await app.register(AuthPlugin, options);
  await app.register(Sensible);
  await app.register(Me, { prefix: "/me" });
  await app.ready();
  return app;
}

test("protected route rejects missing credentials", async () => {
  const app = await buildAuthApp();
  onTestFinished(() => app.close());

  const res = await app.inject({
    url: "/me",
  });
  assert.equal(res.statusCode, 401);
  assert.equal(res.payload, "Missing Authorization Header");
});

test("unknown tokens are rejected", async () => {
  const app = await buildAuthApp();
  onTestFinished(() => app.close());

  const res = await app.inject({
    url: "/me",
    headers: { authorization: "Bearer not-a-known-token" },
  });
  assert.equal(res.statusCode, 401);
});

test("malformed authorization headers return a bad request", async () => {
  const app = await buildAuthApp();
  onTestFinished(() => app.close());

  const res = await app.inject({
    url: "/me",
    headers: { authorization: "foo" },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.payload, "Invalid Authorization Header");
});

test("valid bearer token reaches the handler", async () => {
  const app = await buildAuthApp();
  onTestFinished(() => app.close());

  const res = await app.inject({
    url: "/me",
    headers: { authorization: "Bearer alice-dev-token" },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { username: "alice", name: "Alice" });
});

test("authSkip is a true bypass: any header authenticates as anonymous", async () => {
  const app = await buildAuthApp({ authSkip: true });
  onTestFinished(() => app.close());

  // No header at all.
  const noHeader = await app.inject({ url: "/me" });
  assert.equal(noHeader.statusCode, 200);
  assert.equal(noHeader.json().username, "anonymous");

  // A stale token left in an HTTP client must not 401 under skip.
  const staleToken = await app.inject({
    url: "/me",
    headers: { authorization: "Bearer alice-dev-token" },
  });
  assert.equal(staleToken.statusCode, 200);
  assert.equal(staleToken.json().username, "anonymous");

  // A garbage header must not 401 under skip either.
  const garbage = await app.inject({
    url: "/me",
    headers: { authorization: "Bearer not-a-known-token" },
  });
  assert.equal(garbage.statusCode, 200);
  assert.equal(garbage.json().username, "anonymous");

  assert.equal(noHeader.headers["x-auth-skip"], "true");
});
