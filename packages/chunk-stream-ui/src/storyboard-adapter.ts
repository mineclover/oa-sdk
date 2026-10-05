import {
  RuntimeChunkEnvelope,
  ResidencyController,
  type RuntimeResourceRef,
} from "@oa-sdk/chunk-stream";
import type {
  ChunkStreamManifest,
  ChunkStreamManifestEntry,
  JsonValue,
  PlaybackSnapshot,
  StoryboardChunkBridgeOptions,
  StoryboardChunkStreamOptions,
  StoryboardChunkStreamPackage,
  StoryboardDocument,
  UiAction,
} from "./types.js";
import {
  ChunkPlaybackBridge,
  type ChunkPlaybackBridgeOptions,
} from "./playback-bridge.js";

/** JSON round trip: drops undefined members and yields a plain JSON value. */
function cleanJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Validate the transport-agnostic parity contract shared by a Chunk Stream
 * index entry and its decoded body.
 */
export function assertChunkIndexBodyParity(index: unknown, header: unknown, body: unknown): void {
  if (!index || typeof index !== "object" || !header || typeof header !== "object") {
    throw new Error("E_CHUNK_PARITY: index and header objects are required");
  }
  const i = index as Record<string, unknown>;
  const h = header as Record<string, unknown>;
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};

  for (const [name, value] of [["index", i.schemaVersion], ["header", h.schemaVersion], ["body", b.schemaVersion]] as const) {
    if (value !== undefined && value !== 1) {
      throw new Error(`E_CHUNK_SCHEMA: ${name}.schemaVersion must be 1`);
    }
  }

  for (const key of ["id", "sequence", "fromFrame", "toFrame"] as const) {
    const expected = h[key];
    const actual = b[key];
    if (expected !== undefined && actual !== undefined && expected !== actual) {
      throw new Error(`E_CHUNK_PARITY: ${key} differs between index/header and body`);
    }
  }
}

/**
 * Transforms a generic StoryboardDocument into a compliant, structured Chunk Stream Package.
 */
export function storyboardToChunkStream(
  doc: StoryboardDocument,
  options: StoryboardChunkStreamOptions = {}
): StoryboardChunkStreamPackage {
  const streamId = options.streamId ?? `stream_${doc?.id || "doc"}`;
  const revision = options.revision ?? (doc?.changeToken ? `rev_${doc.changeToken}` : "rev_1");
  const fps = Math.max(1, Math.round(options.fps ?? 30));
  const defaultDuration = Math.max(0.5, options.defaultSlideDurationSec ?? 5.0);

  const envelopes: RuntimeChunkEnvelope[] = [];
  const manifestEntries: ChunkStreamManifestEntry[] = [];
  const envelopeMap = new Map<string, RuntimeChunkEnvelope>();

  let currentFrame = 0;
  const slides = Array.isArray(doc?.slides) ? doc.slides : [];
  const slideMap = new Map(slides.map((s) => [s.id, s]));
  const sequence = Array.isArray(doc?.sequence) && doc.sequence.length > 0
    ? doc.sequence
    : slides.map((s) => s.id);

  for (let index = 0; index < sequence.length; index++) {
    const slideId = sequence[index]!;
    const slide = slideMap.get(slideId);
    if (!slide) continue;

    // 1. Calculate duration and frame boundary
    let durationSec = defaultDuration;
    if (
      slide.mediaStartMs !== undefined &&
      slide.mediaEndMs !== undefined &&
      slide.mediaEndMs > slide.mediaStartMs
    ) {
      durationSec = (slide.mediaEndMs - slide.mediaStartMs) / 1000;
    } else if (slide.mediaDuration !== undefined && slide.mediaDuration > 0) {
      durationSec = slide.mediaDuration;
    }

    const frameCount = Math.max(1, Math.round(durationSec * fps));
    const fromFrame = currentFrame;
    const toFrame = fromFrame + frameCount;
    currentFrame = toFrame;

    // 2. Extract ui-action@v1 cues
    const actionsData: UiAction[] = [];
    if (slide.actions && slide.actions.length > 0) {
      for (const action of slide.actions) {
        actionsData.push({
          type: "ui-action@v1",
          name: action.name || `action:${action.id}`,
          target: action.effect?.targetSlideId,
          payload: {
            actionId: action.id,
            triggerType: action.trigger?.type ?? "click",
            nodeId: action.trigger?.nodeId,
            delayMs: action.trigger?.delayMs,
            event: action.trigger?.event,
          } as JsonValue,
        });
      }
    } else if (index < sequence.length - 1) {
      // Default sequential transition cue to next slide
      const nextSlideId = sequence[index + 1];
      actionsData.push({
        type: "ui-action@v1",
        name: "scene:next",
        target: nextSlideId,
        payload: { triggerType: "next", targetSlideId: nextSlideId } as JsonValue,
      });
    }

    // 3. Extract multimedia resources for residency leasing
    const resources: RuntimeResourceRef[] = [];
    let residentBytes = 1024 * 32; // base envelope overhead

    if (slide.mediaUrl) {
      resources.push({
        id: `res-media-${slide.id}`,
        type: "media",
        asset: slide.mediaUrl,
        prepare: slide.mediaProvider === "cdn" ? "cdn-stream" : "media-stream",
      });
      residentBytes += 1024 * 512;
    }

    // Extract node images/posters
    for (const node of slide.nodes || []) {
      const fill = node.appearance?.fill;
      if (
        typeof fill === "string" &&
        (fill.startsWith("http://") || fill.startsWith("https://") || fill.startsWith("data:image/"))
      ) {
        resources.push({
          id: `res-img-${node.id}`,
          type: "image",
          asset: fill.slice(0, 120),
          prepare: "image-cache",
        });
        residentBytes += 1024 * 128;
      }
    }

    // 4. Construct semantic state
    const state: Record<string, JsonValue> = {
      slideId: slide.id,
      slideName: slide.name ?? "",
      description: slide.description ?? "",
      timecode: slide.mediaTimecode ?? "",
      startMs: slide.mediaStartMs ?? null,
      endMs: slide.mediaEndMs ?? null,
      durationSec,
      cueCount: actionsData.length,
      nodeCount: slide.nodes?.length ?? 0,
    };

    const chunkId = `chunk_${slide.id}`;
    const envelope = new RuntimeChunkEnvelope({
      id: chunkId,
      sequence: index,
      streamId,
      fromFrame,
      toFrame,
      payloadFormat: "ui-action@v1",
      data: cleanJson(actionsData),
      state: cleanJson(state),
      resources: Object.freeze(resources),
      residentBytes,
    });

    envelopes.push(envelope);
    envelopeMap.set(chunkId, envelope);

    manifestEntries.push({
      schemaVersion: 1,
      id: chunkId,
      sequence: index,
      slideId: slide.id,
      fromFrame,
      toFrame,
      payloadFormat: "ui-action@v1",
      cueCount: actionsData.length,
      resourcesCount: resources.length,
    });
  }

  const totalFrames = currentFrame;
  const totalDurationSec = totalFrames / fps;

  const manifest: ChunkStreamManifest = {
    schemaVersion: 1,
    streamId,
    revision,
    fps,
    totalFrames,
    totalDurationSec,
    chunkCount: envelopes.length,
    chunks: Object.freeze(manifestEntries),
  };

  const frameMap = (frame: number): RuntimeChunkEnvelope | undefined => {
    return envelopes.find((e, idx) => {
      const isLast = idx === envelopes.length - 1;
      return frame >= e.fromFrame && (isLast ? frame <= e.toFrame : frame < e.toFrame);
    });
  };

  return {
    manifest,
    envelopes: Object.freeze(envelopes),
    envelopeMap,
    frameMap,
  };
}

/**
 * Creates a fully configured ChunkPlaybackBridge directly from a StoryboardDocument.
 */
export function createStoryboardChunkPlaybackBridge(
  doc: StoryboardDocument,
  options: StoryboardChunkBridgeOptions = {}
): {
  bridge: ChunkPlaybackBridge;
  streamPackage: StoryboardChunkStreamPackage;
  residency: ResidencyController;
} {
  const streamPackage = storyboardToChunkStream(doc, options);
  const residency = new ResidencyController();

  const initialEnvelope = streamPackage.envelopes[0];
  const initialSnapshot: PlaybackSnapshot = {
    schemaVersion: "playback.v1",
    streamId: streamPackage.manifest.streamId,
    revision: streamPackage.manifest.revision,
    frame: 0,
    cursor: { sequence: 0 },
    semanticState: (initialEnvelope?.state as Record<string, JsonValue>) ?? {},
  };

  const bridgeOptions: ChunkPlaybackBridgeOptions = {
    streamId: streamPackage.manifest.streamId,
    revision: streamPackage.manifest.revision,
    initialSnapshot,
    load: ({ frame }) => {
      const envelope = streamPackage.frameMap(frame);
      return envelope ?? null;
    },
    binding: {
      prepare: (envelope) => {
        return {
          id: `lease:${envelope.id}`,
          release: () => {},
        };
      },
      consume: async (envelope, context) => {
        if (context.dispatchActions) {
          await context.dispatchActions();
        }
        return {
          schemaVersion: "playback.v1",
          streamId: envelope.streamId,
          revision: context.revision,
          frame: context.frame,
          cursor: { sequence: envelope.sequence },
          semanticState: (envelope.state as Record<string, JsonValue>) ?? {},
        };
      },
    },
    contentPort: options.contentPort,
    residency,
    onCommit: options.onCommit,
  };

  const bridge = new ChunkPlaybackBridge(bridgeOptions);

  return {
    bridge,
    streamPackage,
    residency,
  };
}
