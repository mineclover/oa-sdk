export type VectorClock = Record<string, number>;

export interface CrdtMetadata {
  readonly updatedAt: number;
  readonly clientId: string;
  readonly tombstone?: boolean | undefined;
  readonly seq?: number | undefined;
  readonly vectorClock?: VectorClock | undefined;
}

export interface CrdtCue<TPayload = Record<string, unknown>> {
  readonly id: string;
  readonly trackId: string;
  readonly fromFrame: number;
  readonly toFrame: number;
  readonly payload: TPayload & { readonly crdt: CrdtMetadata };
}

export type CrdtDeltaEvent =
  | { readonly type: "cue-merged"; readonly trackId: string; readonly cue: CrdtCue }
  | { readonly type: "compacted"; readonly trackId: string; readonly purged: number; readonly horizon: number };
