import type { CrdtCue, VectorClock } from "./types.js";

function canonicalStringify(obj: unknown): string {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return "[" + obj.map(canonicalStringify).join(",") + "]";
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalStringify((obj as Record<string, unknown>)[k])).join(",") + "}";
}

/**
 * Total Order comparator for CRDT metadata.
 * Returns > 0 if A wins, < 0 if B wins, 0 if identical.
 */
export function compareCrdtMetadata(
  a: CrdtCue["payload"]["crdt"],
  b: CrdtCue["payload"]["crdt"]
): number {
  // 1. updatedAt (higher timestamp wins)
  if (a.updatedAt !== b.updatedAt) {
    return a.updatedAt - b.updatedAt;
  }

  // 2. clientId (lexicographical descending)
  if (a.clientId !== b.clientId) {
    return a.clientId.localeCompare(b.clientId);
  }

  // 3. tombstone (true dominates false)
  const tombA = Boolean(a.tombstone);
  const tombB = Boolean(b.tombstone);
  if (tombA !== tombB) {
    return tombA ? 1 : -1;
  }

  // 4. sequence number
  const seqA = a.seq ?? 0;
  const seqB = b.seq ?? 0;
  if (seqA !== seqB) {
    return seqA - seqB;
  }

  return 0;
}

/**
 * Algebraic Join Semi-Lattice Merge Operator (⊔).
 * Commutative: A ⊔ B === B ⊔ A
 * Associative: (A ⊔ B) ⊔ C === A ⊔ (B ⊔ C)
 * Idempotent: A ⊔ A === A
 */
export function mergeCrdtCue<T extends CrdtCue>(cueA: T, cueB: T): T {
  if (cueA === cueB) return cueA;
  if (cueA.id !== cueB.id) {
    throw new Error(`Cannot merge cues with mismatched IDs: "${cueA.id}" vs "${cueB.id}"`);
  }

  const metaDiff = compareCrdtMetadata(cueA.payload.crdt, cueB.payload.crdt);
  if (metaDiff > 0) return cueA;
  if (metaDiff < 0) return cueB;

  // 5. Tie-breaker: Canonical content string serialization
  const strA = canonicalStringify(cueA.payload);
  const strB = canonicalStringify(cueB.payload);
  return strB > strA ? cueB : cueA;
}

/**
 * Merges two vector clocks by taking the pointwise maximum for all client keys.
 */
export function mergeVectorClocks(a: VectorClock = {}, b: VectorClock = {}): VectorClock {
  const result: VectorClock = { ...a };
  for (const [clientId, counter] of Object.entries(b)) {
    result[clientId] = Math.max(result[clientId] ?? 0, counter);
  }
  return result;
}

/**
 * Filters out operations already observed according to the known vector clock.
 */
export function filterMissingDeltas<T extends { clientId: string; lamport: number }>(
  deltas: readonly T[],
  knownVector: VectorClock
): T[] {
  return deltas.filter((delta) => {
    const known = knownVector[delta.clientId] ?? 0;
    return delta.lamport > known;
  });
}
