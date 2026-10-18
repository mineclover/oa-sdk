import { RuntimeChunkEnvelope } from "./envelope.js";
import type {
  ChunkPresetName,
  ChunkStreamConfigInput,
  MemoryPresetName,
  ResolvedChunkStreamConfig,
  StreamManifest,
} from "./types.js";

export const CHUNK_PRESETS: Readonly<Record<ChunkPresetName, number>> = Object.freeze({
  "ultra-low-latency": 1460,
  "optimal-web": 7168,
  "standard-buffer": 8192,
  "initcwnd-burst": 14336,
  "large-payload": 65536,
  "heavy-media": 262144,
  "bulk-data": 1048576,
});

export const RECOMMENDED_CHUNK_BYTES = CHUNK_PRESETS["optimal-web"];

export const MEMORY_PRESETS: Readonly<Record<MemoryPresetName, number>> = Object.freeze({
  mobile: 64 * 1024 * 1024,
  standard: 128 * 1024 * 1024,
  highperf: 256 * 1024 * 1024,
});

const sharedTextEncoder = new TextEncoder();

function computeFastETag(textOrBytes: string | Uint8Array): string {
  // FNV-1a 32-bit hash for zero-dependency fast ETag generation across browser and Node
  let hash = 0x811c9dc5;
  if (typeof textOrBytes === "string") {
    for (let i = 0; i < textOrBytes.length; i++) {
      hash ^= textOrBytes.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return `W/"${textOrBytes.length.toString(16)}-${(hash >>> 0).toString(16)}"`;
  }
  for (let i = 0; i < textOrBytes.byteLength; i++) {
    hash ^= textOrBytes[i]!;
    hash = Math.imul(hash, 0x01000193);
  }
  return `W/"${textOrBytes.byteLength.toString(16)}-${(hash >>> 0).toString(16)}"`;
}

/**
 * Resolves declarative Chunk Stream transmission and memory parameters into
 * a standardized configuration object compatible with `@oa-sdk/typespec-decorators`
 * (`@chunkStream`) and `@oa-sdk/router`.
 */
export function defineChunkStreamConfig(
  options: ChunkStreamConfigInput = {}
): ResolvedChunkStreamConfig {
  const preset: ChunkPresetName =
    options.preset && options.preset in CHUNK_PRESETS ? options.preset : "optimal-web";
  const targetChunkBytes =
    typeof options.targetChunkBytes === "number" && options.targetChunkBytes > 0
      ? Math.round(options.targetChunkBytes)
      : CHUNK_PRESETS[preset];

  const memoryPreset: MemoryPresetName =
    options.memoryPreset && options.memoryPreset in MEMORY_PRESETS
      ? options.memoryPreset
      : "standard";
  const maxResidentBytes =
    typeof options.maxResidentBytes === "number" && options.maxResidentBytes > 0
      ? Math.round(options.maxResidentBytes)
      : MEMORY_PRESETS[memoryPreset];
  const maxL1MemoryBytes =
    typeof options.maxL1MemoryBytes === "number" && options.maxL1MemoryBytes > 0
      ? Math.round(options.maxL1MemoryBytes)
      : Math.round(maxResidentBytes * 0.5);

  const fps = Math.max(1, Math.round(options.fps ?? 30));
  const chunkFrames = Math.max(1, Math.round(options.chunkFrames ?? fps));
  const payloadFormat = options.payloadFormat ?? "ui-action@v1";
  const mode = options.mode ?? "adaptive";
  const lookaheadFrames = Math.max(1, Math.round(options.lookaheadFrames ?? fps * 2));
  const retentionFrames = Math.max(0, Math.round(options.retentionFrames ?? fps));

  return Object.freeze({
    schemaVersion: 1,
    preset,
    targetChunkBytes,
    memoryPreset,
    maxResidentBytes,
    maxL1MemoryBytes,
    payloadFormat,
    fps,
    chunkFrames,
    mode,
    lookaheadFrames,
    retentionFrames,
  });
}

export interface ChunkStreamRouteResponse<TBody = unknown> {
  readonly status: 200 | 206 | 304 | 404 | 416;
  readonly headers: Record<string, string>;
  readonly body: TBody;
}

export interface GetStreamManifestContext {
  readonly params: { readonly streamId: string };
  readonly headers?: Record<string, string | undefined> | undefined;
}

export interface GetStreamChunkContext {
  readonly params: { readonly streamId: string; readonly chunkId: string };
  readonly headers?: Record<string, string | undefined> | undefined;
}

export interface GetPlaybackSnapshotContext {
  readonly params: { readonly streamId: string };
  readonly query?: { readonly revision?: string | undefined } | undefined;
}

export interface SeekStreamFrameContext {
  readonly params: { readonly streamId: string };
  readonly body?: { readonly frame: number } | undefined;
  readonly query?: { readonly frame?: number | string | undefined } | undefined;
}

export interface ChunkStreamNotFoundError {
  readonly code: "NOT_FOUND";
  readonly message: string;
}

export interface ChunkStreamServerHandlers<
  TManifest extends StreamManifest = StreamManifest,
  TSnapshot = Record<string, unknown>,
  TSeekResult = unknown,
> {
  getStreamManifest(
    ctx: GetStreamManifestContext
  ): Promise<ChunkStreamRouteResponse<TManifest | null | ChunkStreamNotFoundError>>;
  getStreamChunk(
    ctx: GetStreamChunkContext
  ): Promise<
    ChunkStreamRouteResponse<Record<string, unknown> | Uint8Array | null | ChunkStreamNotFoundError>
  >;
  getPlaybackSnapshot(
    ctx: GetPlaybackSnapshotContext
  ): Promise<ChunkStreamRouteResponse<TSnapshot | ChunkStreamNotFoundError>>;
  seekStreamFrame(
    ctx: SeekStreamFrameContext
  ): Promise<ChunkStreamRouteResponse<TSeekResult | ChunkStreamNotFoundError>>;
}

export interface DefineChunkStreamServerOptions<
  TManifest extends StreamManifest = StreamManifest,
  TSnapshot = Record<string, unknown>,
  TSeekResult = unknown,
> extends ChunkStreamConfigInput {
  readonly resolveManifest: (
    streamId: string
  ) => Promise<TManifest | undefined | null> | TManifest | undefined | null;
  readonly resolveChunk: (
    streamId: string,
    chunkId: string
  ) =>
    | Promise<RuntimeChunkEnvelope | Record<string, unknown> | Uint8Array | string | undefined | null>
    | RuntimeChunkEnvelope
    | Record<string, unknown>
    | Uint8Array
    | string
    | undefined
    | null;
  readonly resolveSnapshot?:
    | ((streamId: string, revision?: string) => Promise<TSnapshot | undefined | null> | TSnapshot | undefined | null)
    | undefined;
  readonly seekFrame?:
    | ((streamId: string, frame: number) => Promise<TSeekResult | undefined | null> | TSeekResult | undefined | null)
    | undefined;
}

export interface ChunkStreamTypedServer<
  TManifest extends StreamManifest = StreamManifest,
  TSnapshot = Record<string, unknown>,
  TSeekResult = unknown,
> {
  readonly config: ResolvedChunkStreamConfig;
  readonly openApiExtension: ResolvedChunkStreamConfig;
  readonly handlers: ChunkStreamServerHandlers<TManifest, TSnapshot, TSeekResult>;
  fetch(request: Request): Promise<Response>;
}

/**
 * Declares an `@oa-sdk` Typed Chunk Stream Server with:
 * - Resolved transmission/memory presets (`CHUNK_PRESETS`, `MEMORY_PRESETS`)
 * - `@oa-sdk/router`-compatible route handlers (`getStreamManifest`, `getStreamChunk`, `getPlaybackSnapshot`, `seekStreamFrame`)
 * - Built-in ETag `304 Not Modified` and HTTP `206 Partial Content` byte-range slicing
 * - Standard Web `fetch(request: Request)` handler
 */
export function defineChunkStreamServer<
  TManifest extends StreamManifest = StreamManifest,
  TSnapshot = Record<string, unknown>,
  TSeekResult = unknown,
>(
  options: DefineChunkStreamServerOptions<TManifest, TSnapshot, TSeekResult>
): ChunkStreamTypedServer<TManifest, TSnapshot, TSeekResult> {
  const config = defineChunkStreamConfig(options);

  const handlers: ChunkStreamServerHandlers<TManifest, TSnapshot, TSeekResult> = {
    async getStreamManifest(ctx) {
      const manifest = await options.resolveManifest(ctx.params.streamId);
      if (!manifest) {
        return {
          status: 404,
          headers: { "content-type": "application/json; charset=utf-8" },
          body: {
            code: "NOT_FOUND",
            message: `Stream '${ctx.params.streamId}' not found`,
          },
        };
      }

      const enrichedManifest: TManifest = {
        ...manifest,
        preset: manifest.preset ?? config.preset,
        memoryPreset: manifest.memoryPreset ?? config.memoryPreset,
        targetChunkBytes: manifest.targetChunkBytes ?? config.targetChunkBytes,
      };
      const serialized = JSON.stringify(enrichedManifest);
      const etag = computeFastETag(serialized);
      const ifNoneMatch =
        ctx.headers?.["if-none-match"] ?? ctx.headers?.["If-None-Match"];

      if (ifNoneMatch && ifNoneMatch === etag) {
        return {
          status: 304,
          headers: {
            etag,
            "cache-control": "public, max-age=5",
            "x-chunk-preset": config.preset,
            "x-target-chunk-bytes": String(config.targetChunkBytes),
          },
          body: null,
        };
      }

      return {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          etag,
          "cache-control": "public, max-age=5",
          "x-chunk-preset": config.preset,
          "x-target-chunk-bytes": String(config.targetChunkBytes),
        },
        body: enrichedManifest,
      };
    },

    async getStreamChunk(ctx) {
      const raw = await options.resolveChunk(ctx.params.streamId, ctx.params.chunkId);
      if (raw === undefined || raw === null) {
        return {
          status: 404,
          headers: { "content-type": "application/json; charset=utf-8" },
          body: {
            code: "NOT_FOUND",
            message: `Chunk '${ctx.params.chunkId}' in stream '${ctx.params.streamId}' not found`,
          },
        };
      }

      const jsonObj: Record<string, unknown> | undefined =
        raw instanceof RuntimeChunkEnvelope
          ? (raw.toJSON() as unknown as Record<string, unknown>)
          : typeof raw === "object" && !(raw instanceof Uint8Array)
            ? (raw as Record<string, unknown>)
            : undefined;

      const bytes =
        raw instanceof Uint8Array
          ? raw
          : typeof raw === "string"
            ? sharedTextEncoder.encode(raw)
            : sharedTextEncoder.encode(JSON.stringify(jsonObj));

      const etag = computeFastETag(bytes);
      const ifNoneMatch =
        ctx.headers?.["if-none-match"] ?? ctx.headers?.["If-None-Match"];
      if (ifNoneMatch && ifNoneMatch === etag) {
        return {
          status: 304,
          headers: {
            etag,
            "accept-ranges": "bytes",
            "cache-control": "public, max-age=31536000, immutable",
          },
          body: null,
        };
      }

      const rangeHeader = ctx.headers?.["range"] ?? ctx.headers?.["Range"];
      if (rangeHeader && rangeHeader.startsWith("bytes=")) {
        const match = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader.trim());
        if (match) {
          const total = bytes.byteLength;
          const start = Number.parseInt(match[1]!, 10);
          const end = match[2] ? Math.min(Number.parseInt(match[2], 10), total - 1) : total - 1;
          if (start >= total || start > end || Number.isNaN(start) || Number.isNaN(end)) {
            return {
              status: 416,
              headers: {
                "content-range": `bytes */${total}`,
              },
              body: null,
            };
          }
          const slice = bytes.subarray(start, end + 1);
          return {
            status: 206,
            headers: {
              "content-type": "application/octet-stream",
              "content-range": `bytes ${start}-${end}/${total}`,
              "content-length": String(slice.byteLength),
              "accept-ranges": "bytes",
              etag,
              "x-chunk-preset": config.preset,
            },
            body: slice,
          };
        }
      }

      return {
        status: 200,
        headers: {
          "content-type": jsonObj
            ? "application/json; charset=utf-8"
            : "application/octet-stream",
          "content-length": String(bytes.byteLength),
          "accept-ranges": "bytes",
          etag,
          "cache-control": "public, max-age=31536000, immutable",
          "x-chunk-preset": config.preset,
        },
        body: jsonObj ?? bytes,
      };
    },

    async getPlaybackSnapshot(ctx) {
      if (!options.resolveSnapshot) {
        return {
          status: 404,
          headers: { "content-type": "application/json; charset=utf-8" },
          body: {
            code: "NOT_FOUND",
            message: `Playback snapshot resolver not configured for stream '${ctx.params.streamId}'`,
          },
        };
      }
      const snapshot = await options.resolveSnapshot(
        ctx.params.streamId,
        ctx.query?.revision
      );
      if (!snapshot) {
        return {
          status: 404,
          headers: { "content-type": "application/json; charset=utf-8" },
          body: {
            code: "NOT_FOUND",
            message: `Playback snapshot for '${ctx.params.streamId}' not found`,
          },
        };
      }
      return {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        },
        body: snapshot,
      };
    },

    async seekStreamFrame(ctx) {
      if (!options.seekFrame) {
        return {
          status: 404,
          headers: { "content-type": "application/json; charset=utf-8" },
          body: {
            code: "NOT_FOUND",
            message: `Seek handler not configured for stream '${ctx.params.streamId}'`,
          },
        };
      }
      const rawFrame = ctx.body?.frame ?? ctx.query?.frame ?? 0;
      const frame = Math.max(0, Number(rawFrame) || 0);
      const result = await options.seekFrame(ctx.params.streamId, frame);
      if (!result) {
        return {
          status: 404,
          headers: { "content-type": "application/json; charset=utf-8" },
          body: {
            code: "NOT_FOUND",
            message: `Stream '${ctx.params.streamId}' not found for seek`,
          },
        };
      }
      return {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        },
        body: result,
      };
    },
  };

  function toWebResponse(routeRes: ChunkStreamRouteResponse<unknown>): Response {
    if (routeRes.status === 304 || routeRes.status === 416 || routeRes.body === null) {
      return new Response(null, { status: routeRes.status, headers: routeRes.headers });
    }
    if (routeRes.body instanceof Uint8Array) {
      return new Response(
        routeRes.body as unknown as ConstructorParameters<typeof Response>[0],
        {
          status: routeRes.status,
          headers: routeRes.headers,
        }
      );
    }
    return new Response(JSON.stringify(routeRes.body), {
      status: routeRes.status,
      headers: routeRes.headers,
    });
  }

  return {
    config,
    openApiExtension: config,
    handlers,
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url, "http://localhost");
      const pathname = decodeURIComponent(url.pathname);
      const headersObj: Record<string, string | undefined> = {};
      request.headers.forEach((value, key) => {
        headersObj[key.toLowerCase()] = value;
      });

      const manifestMatch = /^\/streams\/([^/]+)\/(?:manifest|index\.json)$/.exec(pathname);
      if (request.method === "GET" && manifestMatch) {
        const res = await handlers.getStreamManifest({
          params: { streamId: manifestMatch[1]! },
          headers: headersObj,
        });
        return toWebResponse(res);
      }

      const chunkMatch = /^\/streams\/([^/]+)\/chunks\/([^/]+?)(?:\.json)?$/.exec(pathname);
      if (request.method === "GET" && chunkMatch) {
        const res = await handlers.getStreamChunk({
          params: { streamId: chunkMatch[1]!, chunkId: chunkMatch[2]! },
          headers: headersObj,
        });
        return toWebResponse(res);
      }

      const snapshotMatch = /^\/playback\/([^/]+)\/snapshot$/.exec(pathname);
      if (request.method === "GET" && snapshotMatch) {
        const revision = url.searchParams.get("revision") ?? undefined;
        const res = await handlers.getPlaybackSnapshot({
          params: { streamId: snapshotMatch[1]! },
          query: { revision },
        });
        return toWebResponse(res);
      }

      const seekMatch = /^\/streams\/([^/]+)\/seek$/.exec(pathname);
      if (seekMatch && (request.method === "POST" || request.method === "GET")) {
        let frameParam: number | string | undefined =
          url.searchParams.get("frame") ?? undefined;
        if (request.method === "POST") {
          try {
            const parsed = (await request.json()) as { frame?: number };
            if (parsed && typeof parsed.frame === "number") {
              frameParam = parsed.frame;
            }
          } catch {
            // Fallback to query parameter
          }
        }
        const res = await handlers.seekStreamFrame({
          params: { streamId: seekMatch[1]! },
          body: frameParam !== undefined ? { frame: Number(frameParam) } : undefined,
          query: { frame: frameParam },
        });
        return toWebResponse(res);
      }

      return new Response(
        JSON.stringify({ code: "NOT_FOUND", message: `Route not found: ${pathname}` }),
        { status: 404, headers: { "content-type": "application/json; charset=utf-8" } }
      );
    },
  };
}
