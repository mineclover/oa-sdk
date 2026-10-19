// Unit tests for readBoundedBody (src/server/http-body.ts), the relay's size-limited request body
// reader, against real node:http requests written byte by byte by a raw node:net client:
//   - a request already destroyed (aborted) or already read to its end settles at once instead of
//     waiting for events that never come,
//   - a body an earlier reader (a hook) took all or part of is BODY_CONSUMED, never an empty or
//     partial body; an empty body read to its end is still empty; a paused request is resumed,
//   - a request aborted mid-body rejects and leaves no listener behind,
//   - a body over the limit is drained so a response still arrives, and one past the drain limit is
//     cut off by destroying the request,
//   - the limits are inclusive, for Content-Length and chunked bodies alike.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { connect, type AddressInfo, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { BODY_CONSUMED, isBodyConsumedError, readBoundedBody } from "../src/server/http-body.js";
import { settleWithin, until } from "./server-test-helpers.js";

const servers: Server[] = [];
const clients: Socket[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) client.destroy();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

interface Exchange {
  req: IncomingMessage;
  res: ServerResponse;
  client: Socket;
  /** Everything the server wrote back to the client so far. */
  received(): string;
  /** Whether the client's connection has closed. */
  closed(): boolean;
}

/**
 * Starts a server that leaves its one request unread, connects a raw client that writes `request`,
 * and resolves with both ends once the server has the request.
 */
async function exchange(request: string | Buffer): Promise<Exchange> {
  const server = createServer();
  servers.push(server);
  const arrived = new Promise<{ req: IncomingMessage; res: ServerResponse }>((resolve) => {
    server.once("request", (req: IncomingMessage, res: ServerResponse) => resolve({ req, res }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const { port } = server.address() as AddressInfo;
  const client = connect(port, "127.0.0.1");
  clients.push(client);
  let received = "";
  let closed = false;
  client.on("error", () => {});
  client.on("data", (chunk: Buffer) => {
    received += chunk.toString("latin1");
  });
  client.on("close", () => {
    closed = true;
  });
  await new Promise<void>((resolve) => client.once("connect", () => resolve()));
  client.write(request);
  const { req, res } = await arrived;
  return { req, res, client, received: () => received, closed: () => closed };
}

const head = (contentLength: number) =>
  `POST /body HTTP/1.1\r\nHost: test\r\nContent-Type: application/json\r\nContent-Length: ${contentLength}\r\n\r\n`;
const CHUNKED_HEAD = "POST /body HTTP/1.1\r\nHost: test\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n";
const chunk = (data: string) => `${Buffer.byteLength(data).toString(16)}\r\n${data}\r\n`;
const LAST_CHUNK = "0\r\n\r\n";

/** A request with a Content-Length body of `size` bytes. */
const requestOf = (size: number) => head(size) + "b".repeat(size);

/** Waits for the request's 'close' without attaching an 'error' listener (which would make Node emit one). */
function closeOf(req: IncomingMessage): Promise<void> {
  if (req.destroyed) return Promise.resolve();
  return new Promise((resolve) => req.on("close", () => resolve()));
}

function listeners(req: IncomingMessage): Record<string, number> {
  return Object.fromEntries(["data", "end", "error", "close"].map((event) => [event, req.listenerCount(event)]));
}

describe("readBoundedBody", () => {
  it("rejects BODY_ABORTED at once for a request destroyed before the read", async () => {
    const { req, client } = await exchange(`${head(100)}{"partial":`);
    client.destroy();
    await closeOf(req);
    expect(req.destroyed).toBe(true);
    expect(req.readableEnded).toBe(false);

    const outcome = await settleWithin(readBoundedBody(req, 1024).catch((error: unknown) => error), 1000);
    expect(outcome.settled).toBe(true);
    expect(outcome.settled && outcome.value).toBeInstanceOf(Error);
    expect(outcome.settled && (outcome.value as Error).message).toBe("BODY_ABORTED");
    expect(listeners(req)).toMatchObject({ data: 0, end: 0 });
  });

  it("rejects BODY_CONSUMED at once for a body an earlier reader read to its end, and the response still goes out", async () => {
    const ex = await exchange(`${head(11)}{"read":1} `);
    for await (const _ of ex.req) {
      // An earlier hook consumed the body.
    }
    expect(ex.req.readableEnded).toBe(true);

    // Not an empty body: an endpoint would act on `{}`, defaults the client never sent.
    const outcome = await settleWithin(readBoundedBody(ex.req, 1024).catch((error: unknown) => error), 1000);
    expect(outcome.settled && outcome.value).toBeInstanceOf(Error);
    expect(outcome.settled && (outcome.value as Error).message).toBe(BODY_CONSUMED);
    expect(outcome.settled && isBodyConsumedError(outcome.value)).toBe(true);

    ex.res.writeHead(500).end();
    await until(() => ex.received(), (text) => text.startsWith("HTTP/1.1 500"), "response after an already-ended read", 5000);
  });

  it("yields an empty body at once for an empty request already read to its end", async () => {
    const ex = await exchange(head(0));
    const ended = new Promise<void>((resolve) => ex.req.once("end", () => resolve()));
    ex.req.resume();
    await ended;
    expect(ex.req.readableEnded).toBe(true);

    expect(await settleWithin(readBoundedBody(ex.req, 1024), 1000)).toEqual({ settled: true, value: { kind: "ok", body: Buffer.alloc(0) } });
  });

  it("rejects BODY_CONSUMED for a body an earlier reader took part of, once it has drained the rest", async () => {
    const ex = await exchange(`${head(20)}${"a".repeat(10)}`);
    // A logger-style hook took the first part of the body and let the rest go by.
    await new Promise((resolve) => ex.req.once("data", resolve));
    const reading = readBoundedBody(ex.req, 1024).then(() => "resolved", (error: unknown) => error);
    ex.client.write("b".repeat(10));

    const outcome = await settleWithin(reading, 5000);
    expect(outcome.settled && (outcome.value as Error).message).toBe(BODY_CONSUMED);
    // Drained to its end, so the response can still be delivered.
    expect(ex.req.readableEnded).toBe(true);
    expect(listeners(ex.req)).toMatchObject({ data: 0, end: 0 });
    ex.res.writeHead(500).end();
    await until(() => ex.received(), (text) => text.startsWith("HTTP/1.1 500"), "response after a consumed body", 5000);
  });

  it("destroys a request whose consumed body goes past the drain limit", async () => {
    const ex = await exchange(`${head(64 * 1024)}${"a".repeat(10)}`);
    await new Promise((resolve) => ex.req.once("data", resolve));
    const reading = readBoundedBody(ex.req, 1024, 4096).then(() => "resolved", (error: unknown) => error);
    ex.client.write("b".repeat(64 * 1024 - 10));

    const outcome = await settleWithin(reading, 5000);
    expect(outcome.settled && (outcome.value as Error).message).toBe(BODY_CONSUMED);
    expect(ex.req.destroyed).toBe(true);
    await until(() => ex.closed(), Boolean, "client connection closed", 5000);
  });

  it("resumes a request an earlier hook paused instead of waiting for data that never flows", async () => {
    const ex = await exchange(`${head(7)}{"a":1}`);
    ex.req.pause();
    expect(ex.req.readableFlowing).toBe(false);

    const outcome = await settleWithin(readBoundedBody(ex.req, 1024), 1000);
    expect(outcome).toEqual({ settled: true, value: { kind: "ok", body: Buffer.from('{"a":1}') } });
  });

  it("rejects a request aborted mid-body and removes every listener it attached", async () => {
    const ex = await exchange(`${head(1000)}${"x".repeat(10)}`);
    const before = listeners(ex.req);
    const reading = readBoundedBody(ex.req, 4096);
    expect(listeners(ex.req).data).toBe(before.data! + 1);
    // Let the first part of the body reach the reader before the client goes away.
    await new Promise((resolve) => setTimeout(resolve, 50));
    ex.client.destroy();

    const outcome = await settleWithin(reading.then(() => "resolved", (error: unknown) => error), 5000);
    expect(outcome.settled).toBe(true);
    expect(outcome.settled && outcome.value).toBeInstanceOf(Error);
    await closeOf(ex.req);
    expect(listeners(ex.req)).toEqual(before);
    expect(ex.req.listenerCount("data")).toBe(0);
  });

  it("drains a body over the limit (within the drain limit) so a response still reaches the client", async () => {
    const size = 8 * 1024;
    const ex = await exchange(requestOf(size));

    expect(await readBoundedBody(ex.req, 1024)).toEqual({ kind: "too-large", receivedBytes: size, drained: true });
    expect(ex.req.readableEnded).toBe(true);
    expect(listeners(ex.req)).toMatchObject({ data: 0, end: 0 });

    ex.res.writeHead(413, { "content-type": "application/json" }).end(JSON.stringify({ error: "BODY_TOO_LARGE" }));
    const response = await until(() => ex.received(), (text) => text.includes("BODY_TOO_LARGE"), "413 after the drain", 5000);
    expect(response.startsWith("HTTP/1.1 413")).toBe(true);
  });

  it("destroys the request once its body goes past the drain limit", async () => {
    const size = 64 * 1024;
    const ex = await exchange(requestOf(size));

    const read = await readBoundedBody(ex.req, 1024, 4096);
    expect(read).toMatchObject({ kind: "too-large", drained: false });
    expect(read.kind === "too-large" && read.receivedBytes).toBeGreaterThan(4096);
    expect(read.kind === "too-large" && read.receivedBytes).toBeLessThanOrEqual(size);
    expect(ex.req.destroyed).toBe(true);
    await until(() => ex.closed(), Boolean, "client connection closed", 5000);
    expect(listeners(ex.req)).toMatchObject({ data: 0, end: 0 });
  });

  it("treats both limits as inclusive", async () => {
    const atLimit = await exchange(requestOf(1024));
    expect(await readBoundedBody(atLimit.req, 1024)).toEqual({ kind: "ok", body: Buffer.from("b".repeat(1024)) });

    const overLimit = await exchange(requestOf(1025));
    expect(await readBoundedBody(overLimit.req, 1024)).toEqual({ kind: "too-large", receivedBytes: 1025, drained: true });

    const atDrainLimit = await exchange(requestOf(4096));
    expect(await readBoundedBody(atDrainLimit.req, 1024, 4096)).toEqual({ kind: "too-large", receivedBytes: 4096, drained: true });
    // Drained, not cut off: the connection is still there for the response.
    atDrainLimit.res.writeHead(413).end();
    await until(() => atDrainLimit.received(), (text) => text.startsWith("HTTP/1.1 413"), "413 at the drain limit", 5000);
  });

  it("reads chunked bodies without a Content-Length under the same limit", async () => {
    const fits = await exchange(CHUNKED_HEAD + chunk('{"a":') + chunk('"é"}') + LAST_CHUNK);
    const read = await readBoundedBody(fits.req, 1024);
    expect(read.kind === "ok" && read.body.toString("utf8")).toBe('{"a":"é"}');

    const tooLarge = await exchange(CHUNKED_HEAD + chunk("c".repeat(600)) + chunk("c".repeat(600)) + LAST_CHUNK);
    expect(await readBoundedBody(tooLarge.req, 1024)).toEqual({ kind: "too-large", receivedBytes: 1200, drained: true });
  });
});
