import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import { Cause, Effect, Exit } from "effect";
import { createProfileService } from "../dist/service.js";

async function withProfileServer(run) {
  const requests = [];
  const server = createServer((req, res) => {
    requests.push({ method: req.method, path: req.url });
    const key = req.url?.split("/").at(-1);
    const status = key === "missing" ? 404 : 200;
    const body = key === "missing"
      ? { code: "NOT_FOUND", message: "Missing profile" }
      : key === "invalid"
      ? { id: "invalid", displayName: "Invalid", active: "yes" }
      : { id: "good", displayName: "Profile Example", active: true };
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    await run(`http://127.0.0.1:${address.port}`, requests);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test("OA SDK typed client inside Effect is lazy and returns validated data", async () => {
  await withProfileServer(async (baseUrl, requests) => {
    const service = createProfileService(baseUrl);
    const computation = service.getProfile("good");
    assert.equal(requests.length, 0, "building an Effect must not call HTTP");
    const profile = await Effect.runPromise(computation);
    assert.deepEqual(profile, { id: "good", displayName: "Profile Example", active: true });
    assert.deepEqual(requests, [{ method: "GET", path: "/profiles/good" }]);
  });
});

test("404 stays a typed Effect failure; it is not an empty profile", async () => {
  await withProfileServer(async (baseUrl, requests) => {
    const exit = await Effect.runPromiseExit(createProfileService(baseUrl).getProfile("missing"));
    assert.equal(Exit.isFailure(exit), true);
    const failures = Exit.isFailure(exit) ? exit.cause.reasons.filter(Cause.isFailReason) : [];
    assert.equal(failures.length, 1);
    assert.equal(failures[0].error._tag, "ProfileNotFoundError");
    assert.equal(failures[0].error.code, "NOT_FOUND");
    assert.equal(requests.length, 1);
  });
});

test("invalid 200 response fails OA generated runtime schema validation", async () => {
  await withProfileServer(async (baseUrl, requests) => {
    const exit = await Effect.runPromiseExit(createProfileService(baseUrl).getProfile("invalid"));
    assert.equal(Exit.isFailure(exit), true);
    const failures = Exit.isFailure(exit) ? exit.cause.reasons.filter(Cause.isFailReason) : [];
    assert.equal(failures.length, 1);
    assert.equal(failures[0].error._tag, "ProfilePayloadError");
    assert.equal(requests.length, 1);
  });
});
