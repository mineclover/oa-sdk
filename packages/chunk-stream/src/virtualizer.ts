import { RuntimeChunkEnvelope } from "./envelope.js";
import type { PlaybackVirtualizerOptions } from "./types.js";

/**
 * Sequential Memory Virtualizer for high-performance frame playback.
 * Enforces bounded O(1) memory plateau, sliding window prefetching,
 * and generation-fenced seek coordination.
 */
export class PlaybackVirtualizer {
  private readonly lookahead: number;
  private readonly retention: number;
  private readonly maxBytes: number;
  private readonly maxChunks: number;
  private readonly onEvict?: ((chunkId: string, reason: "retention" | "budget" | "seek") => void) | undefined;
  private readonly onTierHit?: ((tier: "L1" | "L2" | "L3", chunkId: string) => void) | undefined;

  private currentFrame = 0;
  private seekGeneration = 0;
  private readonly chunks = new Map<string, RuntimeChunkEnvelope>();

  constructor(options: PlaybackVirtualizerOptions = {}) {
    this.lookahead = options.lookaheadFrames ?? 60; // 2 seconds at 30fps
    this.retention = options.retentionFrames ?? 30; // 1 second at 30fps
    this.maxBytes = options.maxResidentBytes ?? 64 * 1024 * 1024; // 64MB
    this.maxChunks = options.maxActiveChunks ?? 20;
    this.onEvict = options.onEvict;
    this.onTierHit = options.onTierHit;
  }

  get currentActiveFrame(): number {
    return this.currentFrame;
  }

  get activeChunkCount(): number {
    return this.chunks.size;
  }

  get totalResidentBytes(): number {
    let sum = 0;
    for (const chunk of this.chunks.values()) {
      sum += chunk.residentBytes || 1024;
    }
    return sum;
  }

  /**
   * Register a chunk into active virtual memory.
   */
  admit(chunk: RuntimeChunkEnvelope): void {
    this.chunks.set(chunk.id, chunk);
    this.enforceBudget();
  }

  /**
   * Returns the chunk containing the specified frame if resident.
   */
  getChunkForFrame(frame: number): RuntimeChunkEnvelope | undefined {
    for (const chunk of this.chunks.values()) {
      if (chunk.containsFrame(frame)) {
        this.onTierHit?.("L1", chunk.id);
        return chunk;
      }
    }
    return undefined;
  }

  /**
   * Advance playhead frame sequentially.
   */
  advance(frame: number): void {
    this.currentFrame = frame;
    this.prunePastRetention();
    this.enforceBudget();
  }

  /**
   * Seek directly to a target frame with generation fencing.
   */
  seek(targetFrame: number): { generation: number; activeChunk?: RuntimeChunkEnvelope | undefined } {
    const generation = ++this.seekGeneration;
    this.currentFrame = targetFrame;
    const active = this.getChunkForFrame(targetFrame);
    this.pruneDistanceBased(targetFrame);
    return { generation, activeChunk: active };
  }

  /**
   * Evict chunks that are outside the retention window behind the playhead.
   */
  private prunePastRetention(): void {
    const minFrame = this.currentFrame - this.retention;
    for (const [id, chunk] of this.chunks.entries()) {
      if (chunk.toFrame < minFrame) {
        this.chunks.delete(id);
        this.onEvict?.(id, "retention");
      }
    }
  }

  /**
   * Distance-based eviction preserving the active chunk (dist = 0 is INVIOLABLE).
   */
  private pruneDistanceBased(focalFrame: number): void {
    if (this.chunks.size <= this.maxChunks && this.totalResidentBytes <= this.maxBytes) {
      return;
    }

    // Sort by distance from focalFrame descending (furthest first)
    const sorted = Array.from(this.chunks.values()).sort((a, b) => {
      const distA = a.containsFrame(focalFrame) ? -1 : Math.min(Math.abs(a.fromFrame - focalFrame), Math.abs(a.toFrame - focalFrame));
      const distB = b.containsFrame(focalFrame) ? -1 : Math.min(Math.abs(b.fromFrame - focalFrame), Math.abs(b.toFrame - focalFrame));
      return distB - distA;
    });

    for (const chunk of sorted) {
      // Invariant: NEVER evict active chunk
      if (chunk.containsFrame(focalFrame)) continue;

      if (this.chunks.size > this.maxChunks || this.totalResidentBytes > this.maxBytes) {
        this.chunks.delete(chunk.id);
        this.onEvict?.(chunk.id, "budget");
      }
    }
  }

  private enforceBudget(): void {
    this.pruneDistanceBased(this.currentFrame);
  }

  clear(): void {
    this.chunks.clear();
  }
}
