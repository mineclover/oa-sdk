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
  defineChunkStreamConfig,
  defineChunkStreamServer,
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

  it("TieredStoragePort: memoryPreset sizes the L1 budget like defineChunkStreamConfig", () => {
    const MiB = 1024 * 1024;
    const chunk = (id: string) =>
      new RuntimeChunkEnvelope({ id, sequence: 0, fromFrame: 0, toFrame: 1, residentBytes: 20 * MiB });
    const fill = (storage: TieredStoragePort) => {
      for (const id of ["c0", "c1", "c2", "c3"]) storage.putL1(chunk(id));
      return ["c0", "c1", "c2", "c3"].filter((id) => storage.hasL1(id));
    };

    // highperf resolves maxL1MemoryBytes to 128 MiB, so all four 20 MiB chunks stay resident.
    expect(defineChunkStreamConfig({ memoryPreset: "highperf" }).maxL1MemoryBytes).toBe(128 * MiB);
    const highperf = new TieredStoragePort({ memoryPreset: "highperf" });
    expect(fill(highperf)).toEqual(["c0", "c1", "c2", "c3"]);
    expect(highperf.currentL1Bytes).toBe(80 * MiB);

    // An explicit maxL1MemoryBytes still wins over the preset.
    const explicit = new TieredStoragePort({ memoryPreset: "highperf", maxL1MemoryBytes: 40 * MiB });
    expect(fill(explicit)).toEqual(["c2", "c3"]);

    // Without either option the default 32 MiB budget keeps only the newest chunk.
    expect(fill(new TieredStoragePort())).toEqual(["c3"]);
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

  it("defineChunkStreamConfig and defineChunkStreamServer declare typed server handlers with ETag 304 and Range 206", async () => {
    const {
      CHUNK_PRESETS,
      MEMORY_PRESETS,
      defineChunkStreamConfig,
      defineChunkStreamServer,
    } = await import("../src/index.js");

    const config = defineChunkStreamConfig({
      preset: "optimal-web",
      memoryPreset: "standard",
      fps: 30,
    });
    expect(config.targetChunkBytes).toBe(CHUNK_PRESETS["optimal-web"]);
    expect(config.maxResidentBytes).toBe(MEMORY_PRESETS.standard);

    const sampleChunk = new RuntimeChunkEnvelope({
      id: "chunk_0",
      sequence: 0,
      streamId: "demo",
      fromFrame: 0,
      toFrame: 30,
      payloadFormat: "ui-action@v1",
      data: [{ type: "ui-action@v1", name: "click" }],
    });

    const server = defineChunkStreamServer({
      preset: "optimal-web",
      memoryPreset: "standard",
      fps: 30,
      resolveManifest: (streamId) =>
        streamId === "demo"
          ? {
              schemaVersion: 1,
              streamId: "demo",
              revision: "rev_1",
              fps: 30,
              totalFrames: 30,
              totalDurationSec: 1,
              chunkCount: 1,
              chunks: [
                {
                  schemaVersion: 1,
                  id: "chunk_0",
                  sequence: 0,
                  fromFrame: 0,
                  toFrame: 30,
                  payloadFormat: "ui-action@v1",
                },
              ],
            }
          : null,
      resolveChunk: (streamId, chunkId) =>
        streamId === "demo" && chunkId === "chunk_0" ? sampleChunk : null,
      seekFrame: (streamId, frame) =>
        streamId === "demo" ? { status: "completed", frame } : null,
    });

    const manifestRes = await server.handlers.getStreamManifest({
      params: { streamId: "demo" },
    });
    expect(manifestRes.status).toBe(200);
    expect(manifestRes.headers["x-chunk-preset"]).toBe("optimal-web");
    expect((manifestRes.body as any).targetChunkBytes).toBe(7168);

    const notModifiedRes = await server.handlers.getStreamManifest({
      params: { streamId: "demo" },
      headers: { "if-none-match": manifestRes.headers["etag"] },
    });
    expect(notModifiedRes.status).toBe(304);

    const rangeRes = await server.handlers.getStreamChunk({
      params: { streamId: "demo", chunkId: "chunk_0" },
      headers: { range: "bytes=0-15" },
    });
    expect(rangeRes.status).toBe(206);
    expect(rangeRes.headers["content-range"]).toMatch(/^bytes 0-15\/\d+$/);
    expect((rangeRes.body as Uint8Array).byteLength).toBe(16);

    const fetchSeekRes = await server.fetch(
      new Request("http://localhost/streams/demo/seek?frame=15", { method: "GET" })
    );
    expect(fetchSeekRes.status).toBe(200);
    expect(await fetchSeekRes.json()).toEqual({ status: "completed", frame: 15 });

    // Range responses through fetch() carry exactly the requested slice of the chunk bytes.
    const fullChunk = new Uint8Array(await (await server.fetch(new Request("http://localhost/streams/demo/chunks/chunk_0"))).arrayBuffer());
    const fetchRangeRes = await server.fetch(
      new Request("http://localhost/streams/demo/chunks/chunk_0", { headers: { range: "bytes=4-11" } })
    );
    expect(fetchRangeRes.status).toBe(206);
    expect(new Uint8Array(await fetchRangeRes.arrayBuffer())).toEqual(fullChunk.subarray(4, 12));
  });
});

describe("defineChunkStreamServer fetch() request validation", () => {
  const manifestFor = (streamId: string) => ({
    schemaVersion: 1 as const,
    streamId,
    revision: "rev_1",
    fps: 30,
    totalFrames: 0,
    totalDurationSec: 0,
    chunkCount: 0,
    chunks: [],
  });

  function createServer() {
    const resolveManifest = vi.fn((streamId: string) => manifestFor(streamId));
    const resolveChunk = vi.fn((_streamId: string, chunkId: string) => ({ id: chunkId }));
    const resolveSnapshot = vi.fn((streamId: string) => ({ streamId }));
    const seekFrame = vi.fn((streamId: string, frame: number) => ({ streamId, frame }));
    const server = defineChunkStreamServer({ resolveManifest, resolveChunk, resolveSnapshot, seekFrame });
    return { server, resolveManifest, resolveChunk, resolveSnapshot, seekFrame };
  }

  it("answers malformed percent-encoding with 400 instead of rejecting", async () => {
    const { server, resolveManifest, resolveChunk, resolveSnapshot, seekFrame } = createServer();
    for (const [method, path] of [
      ["GET", "/streams/%E0%A4%A/manifest"],
      ["GET", "/streams/demo/chunks/%E0%A4%A"],
      ["GET", "/streams/%E0%A4%A/chunks/c0.json"],
      ["GET", "/playback/%E0%A4%A/snapshot"],
      ["POST", "/streams/%E0%A4%A/seek"],
    ] as const) {
      const res = await server.fetch(new Request(`http://localhost${path}`, { method }));
      expect(res.status, path).toBe(400);
      expect(await res.json()).toEqual({
        code: "BAD_REQUEST",
        message: "Malformed percent-encoding in request path",
      });
    }
    expect(resolveManifest).not.toHaveBeenCalled();
    expect(resolveChunk).not.toHaveBeenCalled();
    expect(resolveSnapshot).not.toHaveBeenCalled();
    expect(seekFrame).not.toHaveBeenCalled();
  });

  it("decodes each path segment separately so encoded slashes stay inside ids", async () => {
    const { server, resolveManifest, resolveChunk } = createServer();

    const manifestRes = await server.fetch(new Request("http://localhost/streams/a%2Fb/manifest"));
    expect(manifestRes.status).toBe(200);
    expect(resolveManifest).toHaveBeenLastCalledWith("a/b");

    await server.fetch(new Request("http://localhost/streams/a%20b/manifest"));
    expect(resolveManifest).toHaveBeenLastCalledWith("a b");

    const chunkRes = await server.fetch(new Request("http://localhost/streams/s%2F1/chunks/c%2F0.json"));
    expect(chunkRes.status).toBe(200);
    expect(resolveChunk).toHaveBeenLastCalledWith("s/1", "c/0");

    const missing = await server.fetch(new Request("http://localhost/streams/a%2Fb/unknown"));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({
      code: "NOT_FOUND",
      message: "Route not found: /streams/a%2Fb/unknown",
    });
  });

  it("seeks only to non-negative integer frames given as numbers or decimal strings", async () => {
    const { server, seekFrame } = createServer();
    const seek = (init: { query?: string; body?: string; method?: "GET" | "POST" }) =>
      server.fetch(
        new Request(`http://localhost/streams/demo/seek${init.query ?? ""}`, {
          method: init.method ?? (init.body === undefined ? "GET" : "POST"),
          ...(init.body === undefined ? {} : { body: init.body }),
        })
      );

    const accepted: Array<[Parameters<typeof seek>[0], number]> = [
      [{ body: JSON.stringify({ frame: 12 }) }, 12],
      [{ body: JSON.stringify({ frame: "12" }) }, 12],
      [{ query: "?frame=7", body: JSON.stringify({ frame: 9 }) }, 9],
      [{ query: "?frame=7", method: "POST" }, 7],
      [{ query: "?frame=7", body: "{}" }, 7],
      [{ query: "?frame=15" }, 15],
      [{}, 0],
    ];
    for (const [init, frame] of accepted) {
      seekFrame.mockClear();
      const res = await seek(init);
      expect(res.status, JSON.stringify(init)).toBe(200);
      expect(await res.json()).toEqual({ streamId: "demo", frame });
      expect(seekFrame).toHaveBeenCalledWith("demo", frame);
    }

    seekFrame.mockClear();
    const rejected: Array<Parameters<typeof seek>[0]> = [
      { query: "?frame=abc" },
      { query: "?frame=-5" },
      { query: "?frame=1.5" },
      { query: "?frame=" },
      { query: "?frame=99999999999999999999" },
      { body: JSON.stringify({ frame: "x" }) },
      { body: JSON.stringify({ frame: -1 }) },
      { body: JSON.stringify({ frame: 2.5 }) },
      { body: JSON.stringify({ frame: null }) },
      { body: JSON.stringify([12]) },
      { body: "notjson" },
      { query: "?frame=3", body: "notjson" },
    ];
    for (const init of rejected) {
      const res = await seek(init);
      expect(res.status, JSON.stringify(init)).toBe(400);
      expect(await res.json()).toMatchObject({ code: "BAD_REQUEST" });
    }
    expect(seekFrame).not.toHaveBeenCalled();
  });

  it("seekStreamFrame handler rejects invalid frames before calling seekFrame", async () => {
    const { server, seekFrame } = createServer();
    const invalid = await server.handlers.seekStreamFrame({
      params: { streamId: "demo" },
      query: { frame: "abc" },
    });
    expect(invalid.status).toBe(400);
    expect(invalid.body).toEqual({
      code: "BAD_REQUEST",
      message: "Invalid seek frame for stream 'demo': expected a non-negative integer",
    });
    expect(seekFrame).not.toHaveBeenCalled();

    const valid = await server.handlers.seekStreamFrame({
      params: { streamId: "demo" },
      body: { frame: "42" },
      query: { frame: 3 },
    });
    expect(valid.status).toBe(200);
    expect(seekFrame).toHaveBeenCalledWith("demo", 42);
  });
});

