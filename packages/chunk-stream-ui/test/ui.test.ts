import { describe, it, expect, vi } from "vitest";
import {
  RuntimeChunkEnvelope,
} from "@oa-sdk/chunk-stream";
import {
  UiActionAdapter,
  RevisionFence,
  LatestRequestCoordinator,
  ChunkPlaybackBridge,
  storyboardToChunkStream,
  createStoryboardChunkPlaybackBridge,
  assertChunkIndexBodyParity,
  type ContentPort,
  type StoryboardDocument,
} from "../src/index.js";

describe("@oa-sdk/chunk-stream-ui UiActionAdapter", () => {
  it("dispatches single action to ContentPort", async () => {
    const dispatched: unknown[] = [];
    const port: ContentPort = {
      dispatch: (op) => dispatched.push(op),
    };
    const adapter = new UiActionAdapter(port, { streamId: "stream_1" });

    const envelope = new RuntimeChunkEnvelope({
      id: "chunk_1",
      sequence: 0,
      streamId: "stream_1",
      fromFrame: 0,
      toFrame: 30,
      payloadFormat: "ui-action@v1",
      data: [{ type: "ui-action@v1", name: "scene:next", target: "slide_2" }],
      state: {},
      resources: [],
      residentBytes: 1024,
    });

    const result = await adapter.consume(envelope);
    expect(result.accepted).toBe(true);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toMatchObject({
      type: "scene.action",
      name: "scene:next",
      target: "slide_2",
    });
  });

  it("enforces fail-closed atomic dispatch for multi-action envelopes", async () => {
    // Port without dispatchBatch
    const nonBatchPort: ContentPort = {
      dispatch: vi.fn(),
    };
    const adapter = new UiActionAdapter(nonBatchPort);

    const multiActionEnvelope = new RuntimeChunkEnvelope({
      id: "chunk_multi",
      sequence: 1,
      streamId: "stream_1",
      fromFrame: 30,
      toFrame: 60,
      payloadFormat: "ui-action@v1",
      data: [
        { type: "ui-action@v1", name: "action:click" },
        { type: "ui-action@v1", name: "action:sound" },
      ],
      state: {},
      resources: [],
      residentBytes: 1024,
    });

    const result = await adapter.consume(multiActionEnvelope);
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe("atomic-required");
    expect(nonBatchPort.dispatch).not.toHaveBeenCalled();

    // Port WITH dispatchBatch
    const batchPort: ContentPort = {
      dispatch: vi.fn(),
      dispatchBatch: vi.fn(),
    };
    const batchAdapter = new UiActionAdapter(batchPort);
    const batchResult = await batchAdapter.consume(multiActionEnvelope);
    expect(batchResult.accepted).toBe(true);
    expect(batchPort.dispatchBatch).toHaveBeenCalledTimes(1);
  });
});

describe("@oa-sdk/chunk-stream-ui RevisionFence & LatestRequestCoordinator", () => {
  it("supersedes older pending requests when a newer request arrives", async () => {
    const coord = new LatestRequestCoordinator("rev_1");

    const slowWork = coord.run(async ({ signal }) => {
      await new Promise((r) => setTimeout(r, 50));
      if (signal.aborted) throw new Error("aborted");
      return "slow";
    });

    // Fire faster newer request immediately
    const fastWork = coord.run(async () => {
      return "fast";
    });

    const [slowRes, fastRes] = await Promise.all([slowWork, fastWork]);
    expect(slowRes.status).toBe("stale");
    expect(fastRes.status).toBe("completed");
    expect(fastRes.value).toBe("fast");
  });
});

describe("@oa-sdk/chunk-stream-ui Storyboard Adapter & PlaybackBridge", () => {
  const sampleDoc: StoryboardDocument = {
    id: "story_123",
    name: "Sample Storyboard",
    changeToken: 42,
    slides: [
      {
        id: "slide_a",
        name: "Intro",
        mediaDuration: 2.0,
        actions: [
          {
            id: "act_1",
            name: "click:start",
            trigger: { type: "click", nodeId: "btn_start" },
            effect: { targetSlideId: "slide_b" },
          },
        ],
      },
      {
        id: "slide_b",
        name: "Outro",
        mediaDuration: 3.0,
      },
    ],
  };

  it("converts StoryboardDocument to compliant Chunk Stream package and manifest", () => {
    const pkg = storyboardToChunkStream(sampleDoc, { fps: 30 });
    expect(pkg.manifest.schemaVersion).toBe(1);
    expect(pkg.manifest.streamId).toBe("stream_story_123");
    expect(pkg.manifest.revision).toBe("rev_42");
    expect(pkg.manifest.fps).toBe(30);
    expect(pkg.manifest.totalDurationSec).toBe(5.0);
    expect(pkg.manifest.totalFrames).toBe(150);
    expect(pkg.envelopes).toHaveLength(2);

    const chunkA = pkg.envelopes[0]!;
    expect(chunkA.fromFrame).toBe(0);
    expect(chunkA.toFrame).toBe(60);

    const chunkB = pkg.envelopes[1]!;
    expect(chunkB.fromFrame).toBe(60);
    expect(chunkB.toFrame).toBe(150);

    // Frame lookup
    expect(pkg.frameMap(10)?.id).toBe("chunk_slide_a");
    expect(pkg.frameMap(80)?.id).toBe("chunk_slide_b");
  });

  it("verifies chunk index body parity", () => {
    const index = { schemaVersion: 1, id: "c1", sequence: 0, fromFrame: 0, toFrame: 10 };
    const header = { schemaVersion: 1, id: "c1", sequence: 0, fromFrame: 0, toFrame: 10 };
    const body = { schemaVersion: 1, id: "c1", sequence: 0, fromFrame: 0, toFrame: 10, data: [] };

    expect(() => assertChunkIndexBodyParity(index, header, body)).not.toThrow();

    const mismatchedBody = { ...body, fromFrame: 5 };
    expect(() => assertChunkIndexBodyParity(index, header, mismatchedBody)).toThrow("E_CHUNK_PARITY");
  });

  it("creates fully operational ChunkPlaybackBridge and seeks correctly", async () => {
    const { bridge, streamPackage } = createStoryboardChunkPlaybackBridge(sampleDoc, { fps: 30 });

    expect(bridge.playback.frame).toBe(0);
    expect(bridge.playback.streamId).toBe(streamPackage.manifest.streamId);

    // Seek to frame 40 (inside slide A)
    const resA = await bridge.seek(40);
    expect(resA.status).toBe("completed");
    expect(bridge.playback.frame).toBe(40);
    expect(resA.chunkId).toBe("chunk_slide_a");

    // Seek to frame 100 (inside slide B)
    const resB = await bridge.seek(100);
    expect(resB.status).toBe("completed");
    expect(bridge.playback.frame).toBe(100);
    expect(resB.chunkId).toBe("chunk_slide_b");

    bridge.close();
    expect(bridge.isClosed).toBe(true);
  });
});
