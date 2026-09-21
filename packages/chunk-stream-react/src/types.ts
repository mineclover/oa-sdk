import type { RuntimeChunkEnvelope } from "@oa-sdk/chunk-stream";
import type {
  ChunkPlaybackBridge,
  ChunkPlaybackPhase,
  StoryboardChunkStreamPackage,
} from "@oa-sdk/chunk-stream-ui";

export interface PeerPlayback {
  readonly slideId: string;
  readonly frame: number;
  readonly isPlaying: boolean;
}

export interface AwarenessPresence {
  readonly clientId: string;
  readonly name?: string | undefined;
  readonly color?: string | undefined;
  readonly user?: { readonly name?: string; readonly color?: string } | undefined;
  readonly playback?: PeerPlayback | undefined;
  readonly [key: string]: unknown;
}

export interface UseChunkPlaybackOptions {
  readonly bridge?: ChunkPlaybackBridge | undefined;
  readonly streamPackage?: StoryboardChunkStreamPackage | undefined;
  readonly fps?: number | undefined;
  readonly autoPlay?: boolean | undefined;
  readonly autoPlayIntervalSec?: number | undefined;
  readonly initialFrame?: number | undefined;
  readonly initialSlideId?: string | undefined;
  readonly mode?: "frame" | "slide" | undefined;
  readonly onSlideChange?: ((slideId: string) => void) | undefined;
  readonly onPlaybackChange?: ((payload: PeerPlayback) => void) | undefined;
}

export interface UseChunkPlaybackResult {
  readonly currentFrame: number;
  readonly displayedFrame: number;
  readonly isPlaying: boolean;
  readonly setIsPlaying: (playing: boolean | ((prev: boolean) => boolean)) => void;
  readonly phase: ChunkPlaybackPhase;
  readonly activeChunk: RuntimeChunkEnvelope | undefined;
  readonly currentSlideId: string | undefined;
  readonly totalFrames: number;
  readonly totalDurationSec: number;
  readonly timecode: string;
  readonly play: () => void;
  readonly pause: () => void;
  readonly togglePlay: () => void;
  readonly seek: (frame: number) => Promise<void>;
  readonly seekRelative: (deltaFrames: number) => Promise<void>;
}

export interface UsePlaybackAwarenessOptions {
  readonly peers?: readonly AwarenessPresence[] | (() => readonly AwarenessPresence[] | undefined) | undefined;
  readonly currentFrame: number;
  readonly currentSlideId?: string | undefined;
  readonly isPlaying: boolean;
  readonly broadcast?: ((payload: PeerPlayback) => void) | undefined;
}

export interface UsePlaybackAwarenessResult {
  readonly peers: readonly AwarenessPresence[];
  readonly peersOnCurrentFrame: readonly AwarenessPresence[];
  readonly peersOnCurrentSlide: readonly AwarenessPresence[];
  readonly peerColorMap: Record<string, string>;
}
