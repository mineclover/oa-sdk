import type { ResourceLease, RuntimeResourceRef, ResidencyRecord } from "./types.js";
import { assertNoPrototypePoisoning, type RuntimeChunkEnvelope } from "./envelope.js";

export interface ResidencyControllerOptions {
  readonly maxResidentBytes?: number | undefined;
  readonly defaultLeaseDurationMs?: number | undefined;
}

interface MountedRecord {
  readonly envelope: RuntimeChunkEnvelope;
  readonly lease: ResourceLease;
  prepared: boolean;
  consumed: boolean;
  evictionPending: boolean;
  released: boolean;
}

/**
 * Controller responsible for managing active memory residency leases.
 * Enforces preparation -> consumption phases, deterministic release,
 * and chunk envelope mount/eviction tracking.
 */
export class ResidencyController {
  private readonly leases = new Map<string, ResourceLease>();
  private readonly preparedResources = new Map<string, RuntimeResourceRef>();
  private readonly mounted = new Map<string, MountedRecord>();
  private readonly maxBytes: number;
  private currentBytes = 0;
  private disposed = false;

  constructor(options: ResidencyControllerOptions = {}) {
    this.maxBytes = options.maxResidentBytes ?? 128 * 1024 * 1024; // 128MB default
  }

  get residentBytes(): number {
    return this.currentBytes;
  }

  get leaseCount(): number {
    return this.leases.size;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  /**
   * Phase 1: Prepare resource for upcoming frames without claiming full active lease.
   */
  prepare(resource: RuntimeResourceRef): void {
    assertNoPrototypePoisoning(resource);
    this.preparedResources.set(resource.id, resource);
  }

  /**
   * Phase 2: Consume resource into active playback memory with an active lease.
   */
  acquire(resourceId: string, byteLength = 0, durationMs?: number): ResourceLease {
    const existingPrepared = this.preparedResources.get(resourceId);
    const size = byteLength || existingPrepared?.byteLength || 1024;

    const leaseId = `lease_${resourceId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const now = Date.now();
    const lease: ResourceLease = {
      id: leaseId,
      resourceId,
      byteLength: size,
      acquiredAt: now,
      expiresAt: durationMs ? now + durationMs : undefined,
      release: () => this.release(leaseId),
    };

    this.leases.set(leaseId, lease);
    this.currentBytes += size;
    return lease;
  }

  /**
   * Release an active lease and return memory to headroom.
   */
  release(leaseId: string): boolean {
    const lease = this.leases.get(leaseId);
    if (!lease) return false;

    this.currentBytes = Math.max(0, this.currentBytes - (lease.byteLength ?? 0));
    this.leases.delete(leaseId);
    return true;
  }

  /**
   * Sweep expired leases.
   */
  sweep(now = Date.now()): number {
    let swept = 0;
    for (const [id, lease] of this.leases.entries()) {
      if (lease.expiresAt !== undefined && now >= lease.expiresAt) {
        this.release(id);
        swept++;
      }
    }
    return swept;
  }

  // --- Chunk Envelope Mount / Consume Lifecycle ---

  mount(
    envelope: RuntimeChunkEnvelope,
    acquire: (envelope: RuntimeChunkEnvelope) => ResourceLease
  ): ResidencyRecord {
    if (this.disposed) throw new Error("ResidencyController is disposed.");
    const existing = this.mounted.get(envelope.id);
    if (existing && !existing.released) return this.toRecord(existing);

    const lease = acquire(envelope);
    const record: MountedRecord = {
      envelope,
      lease,
      prepared: false,
      consumed: false,
      evictionPending: false,
      released: false,
    };
    this.mounted.set(envelope.id, record);
    return this.toRecord(record);
  }

  markPrepared(chunkId: string): ResidencyRecord {
    const record = this.requireMounted(chunkId);
    record.prepared = true;
    return this.toRecord(record);
  }

  markConsumed(chunkId: string): ResidencyRecord {
    const record = this.requireMounted(chunkId);
    record.consumed = true;
    if (record.evictionPending) this.releaseMounted(record);
    return this.toRecord(record);
  }

  requestEviction(chunkId: string): ResidencyRecord {
    const record = this.requireMounted(chunkId);
    record.evictionPending = true;
    if (record.consumed) this.releaseMounted(record);
    return this.toRecord(record);
  }

  discard(chunkId: string): ResidencyRecord | undefined {
    const record = this.mounted.get(chunkId);
    if (!record || record.released) return undefined;
    this.releaseMounted(record);
    return this.toRecord(record);
  }

  get(chunkId: string): ResidencyRecord | undefined {
    const record = this.mounted.get(chunkId);
    return record && !record.released ? this.toRecord(record) : undefined;
  }

  snapshot(): readonly ResidencyRecord[] {
    return [...this.mounted.values()]
      .filter((record) => !record.released)
      .map((record) => this.toRecord(record));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const record of this.mounted.values()) {
      this.releaseMounted(record);
    }
    this.mounted.clear();
    this.clear();
  }

  clear(): void {
    this.leases.clear();
    this.preparedResources.clear();
    this.currentBytes = 0;
  }

  private requireMounted(chunkId: string): MountedRecord {
    const record = this.mounted.get(chunkId);
    if (!record || record.released) throw new Error(`Unknown or released chunk: ${chunkId}`);
    return record;
  }

  private releaseMounted(record: MountedRecord): void {
    if (record.released) return;
    record.released = true;
    try {
      if (typeof record.lease.release === "function") {
        record.lease.release();
      } else {
        this.release(record.lease.id);
      }
    } finally {
      this.mounted.delete(record.envelope.id);
    }
  }

  private toRecord(value: MountedRecord): ResidencyRecord {
    return {
      chunkId: value.envelope.id,
      sequence: value.envelope.sequence,
      prepared: value.prepared,
      consumed: value.consumed,
      evictionPending: value.evictionPending,
    };
  }
}
