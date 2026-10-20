// Regression tests: the relay and deployment catalog hashes must be deterministic across runtimes,
// i.e. independent of the process locale (no localeCompare) and of the input order.
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { WebMcpPeerServer, hashDeploymentCatalog } from "../src/server.js";
import { createRoom, openProvider, startRelay, until } from "./server-test-helpers.js";

class HashProbe extends WebMcpPeerServer {
  relayHash(tools: unknown[]): string {
    return this.catalogHash(tools);
  }
}

const servers: WebMcpPeerServer[] = [];
const sockets: WebSocket[] = [];
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  for (const server of servers.splice(0)) await server.close();
});

const tool = (name: string) => ({ inputSchema: { properties: {}, type: "object" }, description: `${name} tool`, name });
// Hand-ordered by UTF-16 code units: uppercase before punctuation-separated and lowercase names.
const CODE_UNIT_ORDER = ["Zeta", "a-b", "a1", "a_b", "aa_export", "chart_render", "history_get", "y_axis"];
const PINNED_HASH = "bb22a6436c3efd213553d1eafcce005697c97cd2e434599bda3fd265c281fb45";

function canonicalHash(names: readonly string[]): string {
  const canonical = names.map((name) => ({ description: `${name} tool`, inputSchema: { properties: {}, type: "object" }, name }));
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function shuffled<T>(values: readonly T[]): T[][] {
  return [[...values], [...values].reverse(), [...values.slice(3), ...values.slice(0, 3)]];
}

describe("catalog hash ordering", () => {
  it("hashes tools in code-unit name order, independent of input order", () => {
    expect(canonicalHash(CODE_UNIT_ORDER)).toBe(PINNED_HASH);
    const probe = new HashProbe({ port: 0, roomSweepIntervalMs: 0 });
    for (const order of shuffled(CODE_UNIT_ORDER)) {
      const tools = order.map(tool);
      expect(hashDeploymentCatalog(tools)).toBe(PINNED_HASH);
      expect(probe.relayHash(tools)).toBe(PINNED_HASH);
    }
    expect(new HashProbe({ port: 0, roomSweepIntervalMs: 0, deploymentCatalog: { tools: [...CODE_UNIT_ORDER].reverse().map(tool) } }).deploymentCatalog.catalogHash).toBe(PINNED_HASH);
  });

  it("does not depend on the runtime's collation locale", () => {
    const original = String.prototype.localeCompare;
    // A collation that reverses the usual order, as some locales do for some names (Danish `aa`).
    String.prototype.localeCompare = function (this: string, that: string) {
      return original.call(that, this);
    } as typeof original;
    try {
      expect(hashDeploymentCatalog(CODE_UNIT_ORDER.map(tool))).toBe(PINNED_HASH);
      expect(new HashProbe({ port: 0, roomSweepIntervalMs: 0 }).relayHash(CODE_UNIT_ORDER.map(tool))).toBe(PINNED_HASH);
    } finally {
      String.prototype.localeCompare = original;
    }
  });

  it("orders names that collate as equal (NFC vs NFD) deterministically", () => {
    const nfc = "café";
    const nfd = "café";
    expect(hashDeploymentCatalog([tool(nfc), tool(nfd)])).toBe(hashDeploymentCatalog([tool(nfd), tool(nfc)]));
  });

  it("stamps a provider-registered catalog with the same hash as the deployment catalog", async () => {
    const relay = await startRelay(servers);
    const room = await createRoom(relay.base);
    const provider = await openProvider(relay, room, sockets);
    provider.send({ type: "register", tools: [...CODE_UNIT_ORDER].reverse().map(tool) });
    const catalog = await until(
      async () => (await (await fetch(`${relay.base}/p/${room.id}/mcp/tools`)).json()) as { catalogHash: string; catalogVersion: number },
      (value) => value.catalogVersion === 1,
      "register",
    );
    expect(catalog.catalogHash).toBe(PINNED_HASH);
  });
});
