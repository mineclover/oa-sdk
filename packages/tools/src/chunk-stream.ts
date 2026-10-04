import { defineTool } from "./index.js";
import type { ToolDefinition } from "./types.js";
import type { ToolApp } from "./app.js";
import type {
  StoryboardChunkStreamPackage,
  StoryboardDocument,
  ChunkPlaybackBridge,
} from "@oa-sdk/chunk-stream-ui";

export interface ChunkStreamToolsOptions {
  readonly getDocument?: (() => StoryboardDocument | Promise<StoryboardDocument>) | undefined;
  readonly streamPackage?: StoryboardChunkStreamPackage | (() => StoryboardChunkStreamPackage) | undefined;
  readonly bridge?: ChunkPlaybackBridge | (() => ChunkPlaybackBridge) | undefined;
  readonly defaultFps?: number | undefined;
}

/**
 * Creates standardized MCP/WebMCP tools for Chunk Stream inspection, playback, and scrubbing.
 */
export function createChunkStreamTools(options: ChunkStreamToolsOptions): ToolDefinition[] {
  const getPkg = async (fps?: number): Promise<StoryboardChunkStreamPackage> => {
    if (options.streamPackage) {
      return typeof options.streamPackage === "function"
        ? options.streamPackage()
        : options.streamPackage;
    }
    if (options.getDocument) {
      const doc = await options.getDocument();
      const { storyboardToChunkStream } = await import("@oa-sdk/chunk-stream-ui");
      return storyboardToChunkStream(doc, { fps: fps ?? options.defaultFps ?? 30 });
    }
    throw new Error("E_NO_STREAM_SOURCE: Either streamPackage or getDocument must be provided.");
  };

  const manifestTool = defineTool({
    name: "chunk_stream_manifest_get",
    description:
      "READ. Resolve or inspect a Chunk Stream Package manifest (streamId, revision, fps, duration, chunk count, and ordered chunk boundaries).",
    category: "chunk-stream",
    inputSchema: {
      type: "object",
      properties: {
        fps: { type: "number", description: "Optional frames per second override (default: 30)" },
      },
    },
    execute: async (_ctx, input: { fps?: number }) => {
      const pkg = await getPkg(input.fps);
      return pkg.manifest;
    },
  });

  const seekTool = defineTool({
    name: "chunk_stream_frame_seek",
    description:
      "READ/SEEK. Seek to an exact frame number in the Chunk Stream. Returns the active chunk, slideId, displayed frame, and semantic state.",
    category: "chunk-stream",
    inputSchema: {
      type: "object",
      properties: {
        frame: { type: "number", description: "Target non-negative integer frame" },
        fps: { type: "number", description: "Optional frames per second override (default: 30)" },
      },
      required: ["frame"],
    },
    execute: async (_ctx, input: { frame: number; fps?: number }) => {
      const frameNum = Number(input.frame);
      if (options.bridge) {
        const bridgeInstance = typeof options.bridge === "function" ? options.bridge() : options.bridge;
        const res = await bridgeInstance.seek(frameNum);
        return res;
      }
      if (options.getDocument) {
        const doc = await options.getDocument();
        const { createStoryboardChunkPlaybackBridge } = await import("@oa-sdk/chunk-stream-ui");
        const { bridge } = createStoryboardChunkPlaybackBridge(doc, { fps: input.fps ?? options.defaultFps ?? 30 });
        const res = await bridge.seek(frameNum);
        bridge.close();
        return res;
      }
      const pkg = await getPkg(input.fps);
      const envelope = pkg.frameMap(frameNum);
      if (!envelope) {
        return {
          status: "failed",
          frame: frameNum,
          error: { code: "E_CHUNK_MISSING", message: `No chunk covers frame ${frameNum}` },
        };
      }
      return {
        status: "completed",
        frame: frameNum,
        chunkId: envelope.id,
        sequence: envelope.sequence,
        state: envelope.state,
      };
    },
  });

  const envelopeTool = defineTool({
    name: "chunk_stream_envelope_get",
    description:
      "READ. Retrieve a full monomorphic RuntimeChunkEnvelope by chunk ID or sequence index.",
    category: "chunk-stream",
    inputSchema: {
      type: "object",
      properties: {
        chunkId: { type: "string", description: "Chunk identifier (e.g. chunk_slide_1)" },
        sequence: { type: "number", description: "Sequential chunk index" },
      },
    },
    execute: async (_ctx, input: { chunkId?: string; sequence?: number }) => {
      const pkg = await getPkg();
      if (input.chunkId) {
        const envelope = pkg.envelopeMap.get(input.chunkId);
        if (!envelope) throw new Error(`Chunk not found: ${input.chunkId}`);
        return envelope.toJSON();
      }
      if (input.sequence !== undefined) {
        const envelope = pkg.envelopes[input.sequence];
        if (!envelope) throw new Error(`Chunk sequence out of range: ${input.sequence}`);
        return envelope.toJSON();
      }
      throw new Error("Either chunkId or sequence must be provided.");
    },
  });

  return [manifestTool, seekTool, envelopeTool];
}

/**
 * Registers chunk stream tools onto a ToolApp instance.
 */
export function registerChunkStreamTools(app: ToolApp, options: ChunkStreamToolsOptions): ToolApp {
  const tools = createChunkStreamTools(options);
  app.tools(...tools);
  return app;
}
