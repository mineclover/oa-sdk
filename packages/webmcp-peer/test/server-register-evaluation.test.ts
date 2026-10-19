// Integration tests for how much work a provider's `register` frames can make the relay do.
// Evaluating a catalog (normalizing, hashing and measuring it) is what costs, so:
//   - a frame that announces exactly what the last evaluated one did (all fields but registerSeq),
//     while the room catalog is still the one that frame left, is answered as that one was, under
//     its own registerSeq, without being evaluated again; a change to the room catalog in between
//     makes the same frame count as new;
//   - frames that change nothing (refused, or the catalog the room already holds) are evaluated at
//     most 8 at once per room, then one a second; a frame that arrives while none is allowed waits,
//     and the provider's next frame replaces it, so only the latest one is evaluated, and a frame
//     that changes the catalog still gets through;
//   - the budget belongs to the room, so a new provider socket does not reset it, and a waiting
//     frame from a provider socket the relay replaced is never evaluated.
import { afterEach, describe, expect, it } from "vitest";
import { WebMcpPeerServer, type WebMcpPeerServerOptions } from "../src/server.js";
import {
  createRoom,
  flush,
  joinRoom,
  openClient,
  openProvider,
  startRelay,
  tool,
  until,
  type Frame,
  type RecordingSocket,
} from "./server-test-helpers.js";

/** How many frames that change nothing the relay evaluates for one room at once. */
const BURST = 8;
/** How often one more is allowed once the burst is used up. */
const INTERVAL_MS = 1_000;

const servers: WebMcpPeerServer[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  for (const server of servers.splice(0)) await server.close();
});

/** A relay that counts the catalogs it evaluates (each evaluation normalizes the tools once). */
class CountingRelay extends WebMcpPeerServer {
  evaluations = 0;
  protected override normalizeTools(value: unknown): unknown[] | null {
    this.evaluations += 1;
    return super.normalizeTools(value);
  }
}

async function providerRoom() {
  const relay = await startRelay(servers, { deploymentCatalog: { tools: [] } }, (options: WebMcpPeerServerOptions) => new CountingRelay(options));
  const server = relay.server as CountingRelay;
  const room = await createRoom(relay.base);
  const provider = await openProvider(relay, room, sockets);
  await provider.waitFor((frame) => frame.type === "ready", "provider ready", 5000);
  const agent = await openClient(relay, room, await joinRoom(relay.base, room), sockets);
  return { relay, server, room, provider, agent };
}

const refusals = (provider: RecordingSocket) => provider.frames.filter((frame) => frame.type === "error");
const announcements = (agent: RecordingSocket) => agent.frames.filter((frame) => frame.type === "register");
const invalid = (registerSeq: number): Frame => ({
  type: "error",
  code: -32602,
  message: "CATALOG_INVALID",
  reason: "register.tools must be at most 128 uniquely named tools with an object inputSchema",
  registerSeq,
});
/** A catalog the relay refuses as CATALOG_INVALID; `variant` makes each one a different frame. */
const invalidCatalog = (variant: string) => [tool(`dup-${variant}`), tool(`dup-${variant}`)];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("register frames a provider repeats", { timeout: 20_000 }, () => {
  it("evaluates a frame that repeats the last one once, and answers every repeat as that one was, under its own registerSeq", async () => {
    const { server, provider, agent } = await providerRoom();

    provider.send({ type: "register", alias: "p", tools: [tool("a")], registerSeq: 1 });
    await agent.waitFor((frame) => frame.type === "register", "first announcement", 5000);
    expect(server.evaluations).toBe(1);

    // The same catalog, as a provider resyncs it: no evaluation, no announcement, no answer.
    for (let seq = 2; seq <= 40; seq++) provider.send({ type: "register", alias: "p", tools: [tool("a")], registerSeq: seq });
    await flush(provider, "repeats of the accepted catalog processed");
    await flush(agent, "agent socket still open");
    expect(server.evaluations).toBe(1);
    expect(announcements(agent)).toHaveLength(1);
    expect(refusals(provider)).toEqual([]);

    // A refused catalog, then the same one over and over: one evaluation, and the refusal again
    // for each repeat, matched to it by its own registerSeq.
    for (let seq = 41; seq <= 80; seq++) provider.send({ type: "register", alias: "p", tools: invalidCatalog("x"), registerSeq: seq });
    await until(() => refusals(provider).length, (count) => count === 40, "a refusal for every repeat", 5000);
    expect(server.evaluations).toBe(2);
    expect(refusals(provider)).toEqual(Array.from({ length: 40 }, (_, index) => invalid(41 + index)));
    expect(announcements(agent)).toHaveLength(1);
  });

  it("evaluates a repeated frame again once the room catalog changed in between", async () => {
    const { server, provider, agent } = await providerRoom();
    const catalogA = [tool("a")];
    const catalogB = [tool("a"), tool("b")];

    provider.send({ type: "register", tools: catalogA, registerSeq: 1 });
    await agent.waitFor((frame) => frame.type === "register", "catalog A", 5000);

    // The provider answers an agent's tools/list with catalog B, which the relay takes.
    agent.send({ type: "mcp", message: { jsonrpc: "2.0", id: 1, method: "tools/list", params: { _meta: {} } } });
    const listing = await provider.waitFor((frame) => frame.type === "mcp" && frame.message?.method === "tools/list", "forwarded tools/list", 5000);
    provider.send({ type: "mcp", message: { jsonrpc: "2.0", id: listing.message.id, result: { tools: catalogB } } });
    const listed = await agent.waitFor((frame) => frame.type === "mcp" && frame.message?.id === 1, "catalog B listed", 5000);
    expect(listed.message.result).toMatchObject({ tools: catalogB, catalogVersion: 2 });

    // Catalog A again is what the last register frame announced, but no longer what the room holds.
    const evaluations = server.evaluations;
    provider.send({ type: "register", tools: catalogA, registerSeq: 2 });
    await until(() => announcements(agent).length, (count) => count === 2, "catalog A announced again", 5000);
    expect(server.evaluations).toBe(evaluations + 1);
    expect(announcements(agent)[1]).toMatchObject({ tools: catalogA, catalogVersion: 3 });
  });
});

describe("register frames that change nothing", { timeout: 20_000 }, () => {
  it(`evaluates at most ${BURST} at once and then one a second, always the latest, and still takes a changed catalog`, async () => {
    const { server, provider, agent } = await providerRoom();
    provider.send({ type: "register", tools: [tool("a")], registerSeq: 1 });
    await agent.waitFor((frame) => frame.type === "register", "first announcement", 5000);
    // An accepted catalog uses none of the budget.
    expect(server.evaluations).toBe(1);

    // 20 different refused catalogs in a row: the first BURST are evaluated and refused at once.
    for (let seq = 2; seq <= 21; seq++) provider.send({ type: "register", tools: invalidCatalog(String(seq)), registerSeq: seq });
    await until(() => refusals(provider).length, (count) => count === BURST, `${BURST} refusals`, 5000);
    await flush(provider, "every frame received");
    expect(refusals(provider)).toEqual(Array.from({ length: BURST }, (_, index) => invalid(2 + index)));
    expect(server.evaluations).toBe(1 + BURST);

    // The rest wait, each replacing the one before: only the latest is evaluated, once allowed.
    const latest = await until(() => refusals(provider).at(BURST), (frame) => frame !== undefined, "the latest frame's refusal", 3 * INTERVAL_MS);
    expect(latest).toEqual(invalid(21));
    expect(server.evaluations).toBe(1 + BURST + 1);

    // A changed catalog is never lost: with the budget used up again it waits like any other, the
    // provider's next frame replaces it, and the latest is announced once allowed.
    provider.send({ type: "register", tools: [tool("a"), tool("b")], registerSeq: 22 });
    provider.send({ type: "register", tools: [tool("a"), tool("c")], registerSeq: 23 });
    await flush(provider, "the changed catalogs received");
    expect(announcements(agent)).toHaveLength(1);
    await until(() => announcements(agent).length, (count) => count === 2, "the latest changed catalog announced", 3 * INTERVAL_MS);
    expect(announcements(agent)[1]).toMatchObject({ tools: [tool("a"), tool("c")], catalogVersion: 2 });

    await sleep(2 * INTERVAL_MS);
    await flush(provider, "nothing else evaluated");
    await flush(agent, "nothing else announced");
    expect(refusals(provider)).toHaveLength(BURST + 1);
    expect(announcements(agent)).toHaveLength(2);
    expect(server.evaluations).toBe(1 + BURST + 2);
  });

  it("keeps the budget across the room's provider sockets and never evaluates a waiting frame from a replaced one", async () => {
    const { relay, server, room, provider, agent } = await providerRoom();
    provider.send({ type: "register", tools: [tool("a")], registerSeq: 1 });
    await agent.waitFor((frame) => frame.type === "register", "first announcement", 5000);
    for (let seq = 2; seq <= 1 + BURST; seq++) provider.send({ type: "register", tools: invalidCatalog(String(seq)), registerSeq: seq });
    await until(() => refusals(provider).length, (count) => count === BURST, `${BURST} refusals`, 5000);
    // This one waits for the budget...
    provider.send({ type: "register", tools: invalidCatalog("waiting"), registerSeq: 100 });
    await flush(provider, "the waiting frame received");
    const evaluations = server.evaluations;

    // ...and its provider socket is replaced before it is allowed.
    const next = await openProvider(relay, room, sockets);
    await next.waitFor((frame) => frame.type === "ready", "replacement provider ready", 5000);
    // The new socket has the room's budget, not a fresh one: its frame waits too.
    next.send({ type: "register", tools: invalidCatalog("next"), registerSeq: 1 });
    await flush(next, "the new socket's frame received");
    expect(refusals(next)).toEqual([]);
    expect(server.evaluations).toBe(evaluations);

    const refusal = await until(() => refusals(next)[0], (frame) => frame !== undefined, "the new socket's refusal", 3 * INTERVAL_MS);
    expect(refusal).toEqual(invalid(1));
    await sleep(2 * INTERVAL_MS);
    expect(server.evaluations).toBe(evaluations + 1);
    expect(refusals(provider).map((frame) => frame.registerSeq)).not.toContain(100);
  });
});
