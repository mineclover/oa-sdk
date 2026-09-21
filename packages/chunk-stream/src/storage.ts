import type { StorageTierOptions } from "./types.js";
import { RuntimeChunkEnvelope } from "./envelope.js";

/**
 * Multi-Tier Storage Port enforcing L1 Memory -> L2 IndexedDB -> L3 Network hierarchy.
 */
export class TieredStoragePort {
  private readonly l1 = new Map<string, RuntimeChunkEnvelope>();
  private readonly l2 = new Map<string, string>(); // In-memory double or IndexedDB backing
  private readonly fetchRemote?: ((id: string, signal?: AbortSignal) => Promise<ArrayBuffer | Uint8Array | string>) | undefined;
  private readonly maxL1Bytes: number;

  constructor(options: StorageTierOptions = {}) {
    this.maxL1Bytes = options.maxL1MemoryBytes ?? 32 * 1024 * 1024;
    this.fetchRemote = options.fetchRemoteChunk;
  }

  hasL1(chunkId: string): boolean {
    return this.l1.has(chunkId);
  }

  hasL2(chunkId: string): boolean {
    return this.l2.has(chunkId);
  }

  putL1(chunk: RuntimeChunkEnvelope): void {
    this.l1.set(chunk.id, chunk);
  }

  putL2(chunkId: string, serializedData: string): void {
    this.l2.set(chunkId, serializedData);
  }

  /**
   * Resolves a chunk through strict L1 -> L2 -> L3 hierarchy.
   */
  async getChunk(chunkId: string, signal?: AbortSignal): Promise<{ chunk: RuntimeChunkEnvelope; tier: "L1" | "L2" | "L3" }> {
    // 1. L1 Memory Lookup (0ms synchronous)
    const l1Hit = this.l1.get(chunkId);
    if (l1Hit) {
      return { chunk: l1Hit, tier: "L1" };
    }

    // 2. L2 Disk / IndexedDB Lookup
    const l2Serialized = this.l2.get(chunkId);
    if (l2Serialized) {
      const parsed = JSON.parse(l2Serialized);
      const envelope = new RuntimeChunkEnvelope(parsed);
      this.l1.set(chunkId, envelope); // Back-populate L1
      return { chunk: envelope, tier: "L2" };
    }

    // 3. L3 Remote Network Fetch
    if (!this.fetchRemote) {
      throw new Error(`E_CHUNK_NOT_FOUND: Chunk ${chunkId} not found in L1/L2 and no L3 remote fetcher configured`);
    }

    const raw = await this.fetchRemote(chunkId, signal);
    const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
    const parsed = JSON.parse(text);
    const envelope = new RuntimeChunkEnvelope(parsed);

    // Back-populate both L2 and L1 (write-through)
    this.l2.set(chunkId, text);
    this.l1.set(chunkId, envelope);

    return { chunk: envelope, tier: "L3" };
  }

  clear(): void {
    this.l1.clear();
    this.l2.clear();
  }
}
