import type { RuntimeChunkEnvelope } from "@oa-sdk/chunk-stream";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface UiAction {
  readonly type: "ui-action@v1";
  readonly name: string;
  readonly target?: JsonValue | undefined;
  readonly payload?: JsonValue | undefined;
}

export interface ContentPort {
  dispatch(operation: Record<string, JsonValue>): Promise<unknown> | unknown;
  /** Optional atomic bridge for envelopes carrying more than one action. */
  dispatchBatch?(operations: readonly Record<string, JsonValue>[]): Promise<unknown> | unknown;
}

export interface UiActionConsumeResult {
  readonly accepted: boolean;
  readonly reason?: "wrong-format" | "invalid-action" | "content-rejected" | "atomic-required" | undefined;
  readonly operations: readonly Record<string, JsonValue>[];
}

export interface PlaybackCursor {
  readonly sequence: number;
  readonly cueId?: string | undefined;
}

export interface PlaybackSnapshot {
  readonly schemaVersion: "playback.v1";
  readonly streamId: string;
  readonly revision: string;
  readonly frame: number;
  readonly cursor: PlaybackCursor;
  readonly semanticState: Record<string, JsonValue>;
}

export interface SlideActionTrigger {
  readonly type?: string | undefined;
  readonly nodeId?: string | undefined;
  readonly delayMs?: number | undefined;
  readonly event?: string | undefined;
}

export interface SlideActionEffect {
  readonly targetSlideId?: string | undefined;
}

export interface SlideAction {
  readonly id: string;
  readonly name?: string | undefined;
  readonly trigger?: SlideActionTrigger | undefined;
  readonly effect?: SlideActionEffect | undefined;
}

export interface SlideNode {
  readonly id: string;
  readonly appearance?: Record<string, unknown> | undefined;
}

export interface Slide {
  readonly id: string;
  readonly name?: string | undefined;
  readonly description?: string | undefined;
  readonly mediaUrl?: string | undefined;
  readonly mediaProvider?: string | undefined;
  readonly mediaTimecode?: string | undefined;
  readonly mediaStartMs?: number | undefined;
  readonly mediaEndMs?: number | undefined;
  readonly mediaDuration?: number | undefined;
  readonly actions?: readonly SlideAction[] | undefined;
  readonly nodes?: readonly SlideNode[] | undefined;
}

export interface StoryboardDocument {
  readonly id?: string | undefined;
  readonly name?: string | undefined;
  readonly slides: readonly Slide[];
  readonly sequence?: readonly string[] | undefined;
  readonly changeToken?: string | number | undefined;
}

export interface ChunkStreamManifestEntry {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly sequence: number;
  readonly slideId: string;
  readonly fromFrame: number;
  readonly toFrame: number;
  readonly payloadFormat: string;
  readonly cueCount: number;
  readonly resourcesCount: number;
}

export interface ChunkStreamManifest {
  readonly schemaVersion: 1;
  readonly streamId: string;
  readonly revision: string;
  readonly fps: number;
  readonly totalFrames: number;
  readonly totalDurationSec: number;
  readonly chunkCount: number;
  readonly chunks: readonly ChunkStreamManifestEntry[];
}

export interface StoryboardChunkStreamPackage {
  readonly manifest: ChunkStreamManifest;
  readonly envelopes: readonly RuntimeChunkEnvelope[];
  readonly envelopeMap: ReadonlyMap<string, RuntimeChunkEnvelope>;
  readonly frameMap: (frame: number) => RuntimeChunkEnvelope | undefined;
}

export interface StoryboardChunkStreamOptions {
  readonly streamId?: string | undefined;
  readonly revision?: string | undefined;
  readonly fps?: number | undefined;
  readonly defaultSlideDurationSec?: number | undefined;
}

export interface StoryboardChunkBridgeOptions extends StoryboardChunkStreamOptions {
  readonly contentPort?: ContentPort | undefined;
  readonly onCommit?: ((snapshot: PlaybackSnapshot, envelope: RuntimeChunkEnvelope) => void) | undefined;
}
