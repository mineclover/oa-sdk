import { describe, it, expect } from "vitest";
import {
  createChunkStreamTools,
  registerChunkStreamTools,
  ToolApp,
} from "../src/index.js";
import type { StoryboardDocument } from "@oa-sdk/chunk-stream-ui";

describe("@oa-sdk/tools Chunk Stream Tooling", () => {
  const sampleDoc: StoryboardDocument = {
    id: "deck_mcp",
    name: "Interactive Demo",
    changeToken: 99,
    slides: [
      { id: "s1", name: "Slide 1", mediaDuration: 2.0 },
      { id: "s2", name: "Slide 2", mediaDuration: 3.0 },
    ],
  };

  it("creates and executes standard chunk stream tools", async () => {
    const tools = createChunkStreamTools({
      getDocument: () => sampleDoc,
      defaultFps: 30,
    });

    expect(tools).toHaveLength(3);
    const [manifestTool, seekTool, envTool] = tools;

    expect(manifestTool?.name).toBe("chunk_stream_manifest_get");
    expect(seekTool?.name).toBe("chunk_stream_frame_seek");
    expect(envTool?.name).toBe("chunk_stream_envelope_get");

    const ctx = {} as any;

    // 1. Manifest Get
    const manifest: any = await manifestTool!.execute(ctx, {});
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.streamId).toBe("stream_deck_mcp");
    expect(manifest.totalDurationSec).toBe(5.0);
    expect(manifest.chunkCount).toBe(2);

    // 2. Frame Seek
    const seekRes: any = await seekTool!.execute(ctx, { frame: 20 });
    expect(seekRes.status).toBe("completed");
    expect(seekRes.chunkId).toBe("chunk_s1");

    // 3. Envelope Get
    const envelope: any = await envTool!.execute(ctx, { chunkId: "chunk_s2" });
    expect(envelope.schemaVersion).toBe(1);
    expect(envelope.id).toBe("chunk_s2");
    expect(envelope.sequence).toBe(1);
  });

  it("registers seamlessly onto a ToolApp instance", () => {
    const app = new ToolApp({ name: "DemoApp" });
    registerChunkStreamTools(app, { getDocument: () => sampleDoc });

    expect(app.getTools().some((t) => t.name === "chunk_stream_manifest_get")).toBe(true);
    expect(app.getTools().some((t) => t.name === "chunk_stream_frame_seek")).toBe(true);
    expect(app.getTools().some((t) => t.name === "chunk_stream_envelope_get")).toBe(true);
  });
});
