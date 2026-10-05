import { describe, it, expect, vi } from "vitest";
import {
  RuntimeChunkEnvelope,
  assertNoPrototypePoisoning,
  ResidencyController,
  PlaybackVirtualizer,
  TieredStoragePort,
  ReservationForecaster,
  BudgetLedger,
  retryAfterMs,
  synthesizeEmptyChunk,
  createResilientChunkReader,
  createChunkStreamStore,
} from "../src/index.js";

describe("@oa-sdk/chunk-stream Core Engine", () => {
  it("rejects prototype poisoning in descriptors and leases", () => {
    expect(() => {
      assertNoPrototypePoisoning(JSON.parse('{"__proto__": {"polluted": true}}'));
    }).toThrow(/E_PROTOTYPE_POISONING/);

    expect(() => {
      new RuntimeChunkEnvelope({
        id: "c1",
        fromFrame: 0,
        toFrame: 30,
        sequence: 0,
        ...JSON.parse('{"__proto__": {"admin": true}}'),
      });
    }).toThrow();
  });

  it("RuntimeChunkEnvelope enforces bounds and serializes cleanly", () => {
    const envelope = new RuntimeChunkEnvelope({
      id: "chunk_01",
      sequence: 1,
      fromFrame: 0,
      toFrame: 60,
      payloadFormat: "ui-action@v1",
      data: { cues: ["cue1"] },
      state: { active: true },
      residentBytes: 2048,
    });

    expect(envelope.schemaVersion).toBe(1);
    expect(envelope.id).toBe("chunk_01");
    expect(envelope.durationFrames).toBe(60);
    expect(envelope.containsFrame(30)).toBe(true);
    expect(envelope.containsFrame(90)).toBe(false);

    const json = envelope.toJSON();
    expect(json.schemaVersion).toBe(1);
    expect(json.id).toBe("chunk_01");
  });

  it("ResidencyController manages leases, tracks resident bytes, and sweeps", () => {
    const controller = new ResidencyController();
    controller.prepare({ id: "res_1", type: "texture", byteLength: 4096 });

    const lease1 = controller.acquire("res_1", 4096, 50);
    expect(controller.residentBytes).toBe(4096);
    expect(controller.leaseCount).toBe(1);

    const lease2 = controller.acquire("res_2", 2048);
    expect(controller.residentBytes).toBe(6144);
    expect(controller.leaseCount).toBe(2);

    controller.release(lease2.id);
    expect(controller.residentBytes).toBe(4096);

    const swept = controller.sweep(Date.now() + 100);
    expect(swept).toBe(1);
    expect(controller.residentBytes).toBe(0);
  });

  it("PlaybackVirtualizer: sliding window advance and active frame protection invariant", () => {
    const virtualizer = new PlaybackVirtualizer({
      lookaheadFrames: 30,
      retentionFrames: 20,
      maxActiveChunks: 2,
    });

    const c1 = new RuntimeChunkEnvelope({ id: "c1", fromFrame: 0, toFrame: 30, sequence: 0 });
    const c2 = new RuntimeChunkEnvelope({ id: "c2", fromFrame: 30, toFrame: 60, sequence: 1 });
    const c3 = new RuntimeChunkEnvelope({ id: "c3", fromFrame: 60, toFrame: 90, sequence: 2 });

    virtualizer.admit(c1);
    virtualizer.admit(c2);
    expect(virtualizer.activeChunkCount).toBe(2);

    // Active frame is at 10 (inside c1)
    virtualizer.advance(10);
    expect(virtualizer.getChunkForFrame(10)?.id).toBe("c1");

    // Admit c3 -> exceeds maxActiveChunks (2). Distance eviction evicts c3 (furthest from 10)
    // while c1 (dist 0) and c2 (dist 20) are strictly preserved.
    virtualizer.admit(c3);
    expect(virtualizer.getChunkForFrame(10)?.id).toBe("c1");
    expect(virtualizer.getChunkForFrame(45)?.id).toBe("c2");

    // Seek to frame 75 -> generation fenced
    const seekResult = virtualizer.seek(75);
    expect(seekResult.generation).toBeGreaterThan(0);

    // Admit c3 after seeking to 75 -> now c3 has dist 0, so c1 is evicted and c3 is resident!
    virtualizer.admit(c3);
    expect(virtualizer.getChunkForFrame(75)?.id).toBe("c3");
  });

  it("TieredStoragePort: strict resolution order L1 -> L2 -> L3 with back-population", async () => {
    let remoteCalls = 0;
    const storage = new TieredStoragePort({
      fetchRemoteChunk: async (id) => {
        remoteCalls++;
        return JSON.stringify({
          schemaVersion: 1,
          id,
          fromFrame: 0,
          toFrame: 30,
          sequence: 0,
        });
      },
    });

    // 1st lookup: cold miss L1/L2 -> fetches L3
    const res1 = await storage.getChunk("chunk_alpha");
    expect(res1.tier).toBe("L3");
    expect(res1.chunk.id).toBe("chunk_alpha");
    expect(remoteCalls).toBe(1);

    // 2nd lookup: hits warm L1 memory cache directly without calling L3
    const res2 = await storage.getChunk("chunk_alpha");
    expect(res2.tier).toBe("L1");
    expect(remoteCalls).toBe(1);
  });

  it("TieredStoragePort: validates L2 and L3 chunk descriptors before building envelopes", async () => {
    const payloads: Record<string, unknown> = {
      ok: {
        id: "ok",
        fromFrame: 0,
        toFrame: 10,
        streamId: "s",
        resources: [{ id: "r1", type: "image", byteLength: 64 }],
        data: { opaque: [1, 2] },
      },
      badStream: { id: "badStream", fromFrame: 0, toFrame: 10, streamId: 7 },
      badResources: { id: "badResources", fromFrame: 0, toFrame: 10, resources: [{ id: "r1" }] },
      notObject: ["id", 0, 10],
      poisoned: JSON.parse('{"__proto__": {"polluted": true}, "id": "poisoned", "fromFrame": 0, "toFrame": 1}'),
    };
    const storage = new TieredStoragePort({ fetchRemoteChunk: async (id) => JSON.stringify(payloads[id]) });

    const { chunk } = await storage.getChunk("ok");
    expect(chunk.sequence).toBe(0);
    expect(chunk.streamId).toBe("s");
    expect(chunk.resources).toEqual([{ id: "r1", type: "image", byteLength: 64 }]);
    expect(chunk.data).toEqual({ opaque: [1, 2] });

    await expect(storage.getChunk("badStream")).rejects.toThrow("E_CHUNK_DESCRIPTOR: streamId must be a string");
    await expect(storage.getChunk("badResources")).rejects.toThrow("E_CHUNK_DESCRIPTOR: resources must be an array of resource references");
    await expect(storage.getChunk("notObject")).rejects.toThrow("E_CHUNK_DESCRIPTOR: chunk payload must be a JSON object");
    await expect(storage.getChunk("poisoned")).rejects.toThrow(/E_PROTOTYPE_POISONING/);

    storage.putL2("stored", JSON.stringify({ id: "stored", fromFrame: 5, toFrame: 2 }));
    await expect(storage.getChunk("stored")).rejects.toThrow("cannot exceed toFrame");
  });

  it("ReservationForecaster and BudgetLedger manage allocation headroom", () => {
    const forecaster = new ReservationForecaster();
    const peak = forecaster.forecastPeakBytes(1000, "ui-action@v1");
    const resident = forecaster.forecastResidentBytes(1000, "ui-action@v1");

    expect(peak).toBe(6048);
    expect(resident).toBe(2512);

    const ledger = new BudgetLedger(10000);
    expect(ledger.canAllocate(5000)).toBe(true);
    expect(ledger.allocate(5000)).toBe(true);
    expect(ledger.remainingBytes).toBe(5000);
    expect(ledger.allocate(6000)).toBe(false);
  });

  it("createResilientChunkReader synthesizes monomorphic fallback on exhausted retries", async () => {
    const descriptors = [
      { id: "c_fail", sequence: 0, fromFrame: 0, toFrame: 30, payloadFormat: "ui-action@v1" },
    ];

    const failFetcher = vi.fn().mockRejectedValue(new Error("Network Down"));
    const reader = createResilientChunkReader(failFetcher, descriptors, {
      maxRetries: 2,
      initialDelayMs: 1,
    });

    const results = [];
    for await (const chunk of reader) {
      results.push(chunk);
    }

    expect(results.length).toBe(1);
    expect(results[0].state?.fallback).toBe(true);
    expect(results[0].state?.empty).toBe(true);
    expect(failFetcher).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it("createChunkStreamStore provides a reactive store for UI subscriptions", async () => {
    const store = createChunkStreamStore({
      fetchChunk: async (d) => ({
        id: d.id,
        sequence: d.sequence,
        fromFrame: d.fromFrame,
        toFrame: d.toFrame,
      }),
      descriptors: [
        { id: "c0", sequence: 0, fromFrame: 0, toFrame: 30 },
      ],
    });

    let stateUpdates = 0;
    const unsub = store.subscribe(() => {
      stateUpdates++;
    });

    await store.start();
    expect(store.getState().chunks.length).toBe(1);
    expect(stateUpdates).toBeGreaterThan(0);
    unsub();
  });
});
