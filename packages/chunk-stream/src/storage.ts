import type { RuntimeChunkEnvelopeDescriptor, RuntimeResourceRef, StorageTierOptions } from "./types.js";
import { RuntimeChunkEnvelope, assertNoPrototypePoisoning } from "./envelope.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isResourceRef(value: unknown): value is RuntimeResourceRef {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.type === "string"
    && (value.byteLength === undefined || typeof value.byteLength === "number");
}

function descriptorError(field: string, expected: string): Error {
  return new Error(`E_CHUNK_DESCRIPTOR: ${field} must be ${expected}`);
}

/**
 * Wire descriptor of a chunk read back from L2 or fetched from L3. The typed
 * members are validated here; `data` and `state` stay opaque payloads, and the
 * envelope constructor still enforces id and frame-range invariants.
 */
const StoredChunkDescriptorSchema = {
  parse(value: unknown): RuntimeChunkEnvelopeDescriptor {
    if (!isRecord(value)) throw descriptorError("chunk payload", "a JSON object");
    assertNoPrototypePoisoning(value);
    const { schemaVersion, id, sequence, streamId, fromFrame, toFrame, payloadFormat, resources, residentBytes } = value;
    if (schemaVersion !== undefined && schemaVersion !== 1) throw descriptorError("schemaVersion", "1");
    if (typeof id !== "string") throw descriptorError("id", "a string");
    if (sequence !== undefined && typeof sequence !== "number") throw descriptorError("sequence", "a number");
    if (typeof fromFrame !== "number" || typeof toFrame !== "number") throw descriptorError("fromFrame/toFrame", "numbers");
    if (streamId !== undefined && typeof streamId !== "string") throw descriptorError("streamId", "a string");
    if (payloadFormat !== undefined && typeof payloadFormat !== "string") throw descriptorError("payloadFormat", "a string");
    if (residentBytes !== undefined && typeof residentBytes !== "number") throw descriptorError("residentBytes", "a number");
    if (resources !== undefined && (!Array.isArray(resources) || !resources.every(isResourceRef))) {
      throw descriptorError("resources", "an array of resource references");
    }
    return {
      ...(schemaVersion === undefined ? {} : { schemaVersion: 1 as const }),
      id,
      sequence: sequence ?? 0,
      fromFrame,
      toFrame,
      ...(streamId === undefined ? {} : { streamId }),
      ...(payloadFormat === undefined ? {} : { payloadFormat }),
      data: value.data,
      state: value.state,
      ...(resources === undefined ? {} : { resources }),
      ...(residentBytes === undefined ? {} : { residentBytes }),
    };
  },
};

const sharedTextDecoder = new TextDecoder();

/**
 * Multi-Tier Storage Port enforcing L1 Memory -> L2 IndexedDB -> L3 Network hierarchy.
 */
export class TieredStoragePort {
  private readonly l1 = new Map<string, RuntimeChunkEnvelope>();
  private readonly l2 = new Map<string, string>(); // In-memory double or IndexedDB backing
  private readonly fetchRemote?: ((id: string, signal?: AbortSignal) => Promise<ArrayBuffer | Uint8Array | string>) | undefined;
  private readonly maxL1Bytes: number;
  private l1Bytes = 0;

  constructor(options: StorageTierOptions = {}) {
    this.maxL1Bytes = options.maxL1MemoryBytes ?? 32 * 1024 * 1024;
    this.fetchRemote = options.fetchRemoteChunk;
  }

  get currentL1Bytes(): number {
    return this.l1Bytes;
  }

  hasL1(chunkId: string): boolean {
    return this.l1.has(chunkId);
  }

  hasL2(chunkId: string): boolean {
    return this.l2.has(chunkId);
  }

  putL1(chunk: RuntimeChunkEnvelope): void {
    const existing = this.l1.get(chunk.id);
    if (existing) {
      this.l1.delete(chunk.id);
      this.l1Bytes = Math.max(0, this.l1Bytes - (existing.residentBytes || 1024));
    }
    const size = chunk.residentBytes || 1024;
    while (this.l1.size > 0 && this.l1Bytes + size > this.maxL1Bytes) {
      const oldestKey = this.l1.keys().next().value;
      if (!oldestKey) break;
      const oldest = this.l1.get(oldestKey);
      this.l1.delete(oldestKey);
      this.l1Bytes = Math.max(0, this.l1Bytes - (oldest?.residentBytes || 1024));
    }
    this.l1.set(chunk.id, chunk);
    this.l1Bytes += size;
  }

  putL2(chunkId: string, serializedData: string): void {
    this.l2.set(chunkId, serializedData);
  }

  /**
   * Resolves a chunk through strict L1 -> L2 -> L3 hierarchy.
   */
  async getChunk(chunkId: string, signal?: AbortSignal): Promise<{ chunk: RuntimeChunkEnvelope; tier: "L1" | "L2" | "L3" }> {
    // 1. L1 Memory Lookup (0ms synchronous, LRU refresh)
    const l1Hit = this.l1.get(chunkId);
    if (l1Hit) {
      this.l1.delete(chunkId);
      this.l1.set(chunkId, l1Hit);
      return { chunk: l1Hit, tier: "L1" };
    }

    // 2. L2 Disk / IndexedDB Lookup
    const l2Serialized = this.l2.get(chunkId);
    if (l2Serialized) {
      const envelope = new RuntimeChunkEnvelope(StoredChunkDescriptorSchema.parse(JSON.parse(l2Serialized)));
      this.putL1(envelope); // Back-populate L1
      return { chunk: envelope, tier: "L2" };
    }

    // 3. L3 Remote Network Fetch
    if (!this.fetchRemote) {
      throw new Error(`E_CHUNK_NOT_FOUND: Chunk ${chunkId} not found in L1/L2 and no L3 remote fetcher configured`);
    }

    const raw = await this.fetchRemote(chunkId, signal);
    const text = typeof raw === "string" ? raw : sharedTextDecoder.decode(raw);
    const envelope = new RuntimeChunkEnvelope(StoredChunkDescriptorSchema.parse(JSON.parse(text)));

    // Back-populate both L2 and L1 (write-through)
    this.l2.set(chunkId, text);
    this.putL1(envelope);

    return { chunk: envelope, tier: "L3" };
  }

  clear(): void {
    this.l1.clear();
    this.l2.clear();
    this.l1Bytes = 0;
  }
}

