// Regression tests: the agent-side catalog hashes (the client library's hashTools and the live
// demo's browser computeCatalogHash) must equal the relay's catalogHash, whatever the runtime locale.
import { afterEach, describe, expect, it } from "vitest";
import { computeCatalogHash } from "../examples/live-demo/peer-protocol.js";
import { hashTools } from "../src/client.js";
import { hashDeploymentCatalog } from "../src/server.js";

const tool = (name: string) => ({ name, description: `${name} tool`, inputSchema: { type: "object", properties: {} } });

// In code-unit order "-" (45) < digits (48-57) < uppercase (65-90) < "_" (95) < lowercase (97-122);
// en-US collation compares letters case-insensitively first and weighs punctuation differently.
const NAMES = ["b_tool", "B-tool", "a1", "A_2", "a-3", "Zeta", "alpha", "aa_export", "a_b"];

function orders<T>(values: readonly T[]): T[][] {
  return [[...values], [...values].reverse(), [...values.slice(4), ...values.slice(0, 4)]];
}

const originalLocaleCompare = String.prototype.localeCompare;
afterEach(() => {
  String.prototype.localeCompare = originalLocaleCompare;
});

/** Installs a collation that reverses the usual order, as some locales do for some names. */
function reverseCollation(): void {
  String.prototype.localeCompare = function (this: string, that: string) {
    return originalLocaleCompare.call(that, this);
  } as typeof originalLocaleCompare;
}

describe("agent-side catalog hashes match the relay", () => {
  it("uses names whose code-unit and en-US orders differ", () => {
    const codeUnit = [...NAMES].sort();
    const enUs = [...NAMES].sort((left, right) => left.localeCompare(right, "en-US"));
    expect(codeUnit).not.toEqual(enUs);
  });

  it("hashTools equals hashDeploymentCatalog for every input order", () => {
    const expected = hashDeploymentCatalog(NAMES.map(tool));
    for (const order of orders(NAMES)) {
      expect(hashTools(order.map(tool))).toBe(expected);
    }
  });

  it("hashTools does not depend on String.prototype.localeCompare", () => {
    const expected = hashTools(NAMES.map(tool));
    reverseCollation();
    for (const order of orders(NAMES)) {
      expect(hashTools(order.map(tool))).toBe(expected);
    }
  });

  it("the live demo's computeCatalogHash equals hashDeploymentCatalog, whatever the collation", async () => {
    const expected = hashDeploymentCatalog(NAMES.map(tool));
    for (const order of orders(NAMES)) {
      expect(await computeCatalogHash(order.map(tool))).toBe(expected);
    }
    reverseCollation();
    expect(await computeCatalogHash(NAMES.map(tool))).toBe(expected);
  });
});

describe("catalog hashes include own __proto__ keys", () => {
  // JSON.parse creates an own "__proto__" property; building the canonical object by assignment
  // would set the prototype instead and leave the key out of the hash.
  const withProto = (value: string) =>
    JSON.parse(`[{"name":"t","inputSchema":{"type":"object","properties":{"__proto__":{"type":"${value}"}}}}]`) as unknown[];

  it("hashes catalogs that differ only under a __proto__ key differently, on the relay and the client", () => {
    const a = withProto("string");
    const b = withProto("number");
    expect(hashDeploymentCatalog(a)).not.toBe(hashDeploymentCatalog(b));
    expect(hashTools(a)).not.toBe(hashTools(b));
  });

  it("keeps the relay, client and live demo hashes equal for such a catalog", async () => {
    const catalog = withProto("string");
    expect(hashTools(catalog)).toBe(hashDeploymentCatalog(catalog));
    expect(await computeCatalogHash(catalog)).toBe(hashDeploymentCatalog(catalog));
  });
});
