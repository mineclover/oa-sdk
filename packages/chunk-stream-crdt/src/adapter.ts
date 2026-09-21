import type { CrdtCue, CrdtDeltaEvent } from "./types.js";
import { mergeCrdtCue } from "./semi-lattice.js";

export const FORMAT_CRDT_DELTA = "crdt-delta@v1" as const;

export interface CrdtDeltaAdapterOptions {
  readonly clientId: string;
}

/**
 * Adapter managing CRDT Delta tracks, cue lifecycles, and compaction horizons.
 */
export class CrdtDeltaAdapter {
  readonly clientId: string;
  readonly payloadFormat = FORMAT_CRDT_DELTA;

  // trackId -> (cueId -> CrdtCue)
  private readonly tracks = new Map<string, Map<string, CrdtCue>>();
  // trackId -> compaction horizon timestamp
  private readonly horizons = new Map<string, number>();
  private readonly listeners = new Set<(event: CrdtDeltaEvent) => void>();

  constructor(options: CrdtDeltaAdapterOptions) {
    this.clientId = options.clientId;
  }

  get size(): number {
    let total = 0;
    for (const track of this.tracks.values()) {
      total += track.size;
    }
    return total;
  }

  get cues(): readonly CrdtCue[] {
    const list: CrdtCue[] = [];
    for (const track of this.tracks.values()) {
      for (const cue of track.values()) {
        if (!cue.payload.crdt.tombstone) {
          list.push(cue);
        }
      }
    }
    return list;
  }

  get tombstones(): readonly CrdtCue[] {
    const list: CrdtCue[] = [];
    for (const track of this.tracks.values()) {
      for (const cue of track.values()) {
        if (cue.payload.crdt.tombstone) {
          list.push(cue);
        }
      }
    }
    return list;
  }

  on(listener: (event: CrdtDeltaEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(event: CrdtDeltaEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        /* error isolation */
      }
    }
  }

  /**
   * Applies an incoming delta cue.
   * Drops straggler deltas where updatedAt <= trackHorizon to prevent zombie resurrection.
   */
  applyCue(incomingCue: CrdtCue): boolean {
    const trackId = incomingCue.trackId;
    const horizon = this.horizons.get(trackId) ?? 0;

    // Straggler defense: reject deltas older than compaction horizon
    if (incomingCue.payload.crdt.updatedAt <= horizon) {
      return false;
    }

    let track = this.tracks.get(trackId);
    if (!track) {
      track = new Map();
      this.tracks.set(trackId, track);
    }

    const existing = track.get(incomingCue.id);
    const winner = existing ? mergeCrdtCue(existing, incomingCue) : incomingCue;
    track.set(incomingCue.id, winner);

    this.emit({ type: "cue-merged", trackId, cue: winner });
    return true;
  }

  /**
   * Evaluates active, non-tombstone cues at the given frame.
   */
  evaluateFrame(frame: number): readonly CrdtCue[] {
    const active: CrdtCue[] = [];
    for (const track of this.tracks.values()) {
      for (const cue of track.values()) {
        if (!cue.payload.crdt.tombstone && frame >= cue.fromFrame && frame <= cue.toFrame) {
          active.push(cue);
        }
      }
    }
    return active;
  }

  /**
   * Compacts tombstones strictly older than the horizon timestamp.
   * Updates track horizon to prevent subsequent resurrection by delayed packets.
   */
  compact(trackId: string, horizon: number): number {
    const track = this.tracks.get(trackId);
    if (!track) return 0;

    this.horizons.set(trackId, Math.max(this.horizons.get(trackId) ?? 0, horizon));
    let purged = 0;

    for (const [id, cue] of track.entries()) {
      if (cue.payload.crdt.tombstone && cue.payload.crdt.updatedAt <= horizon) {
        track.delete(id);
        purged++;
      }
    }

    if (purged > 0) {
      this.emit({ type: "compacted", trackId, purged, horizon });
    }
    return purged;
  }

  getState(trackId: string): Record<string, CrdtCue> {
    const track = this.tracks.get(trackId);
    if (!track) return {};
    const state: Record<string, CrdtCue> = {};
    for (const [id, cue] of track.entries()) {
      state[id] = cue;
    }
    return state;
  }

  clear(): void {
    this.tracks.clear();
    this.horizons.clear();
  }
}

export function createCrdtDeltaAdapter(options: CrdtDeltaAdapterOptions): CrdtDeltaAdapter {
  return new CrdtDeltaAdapter(options);
}
