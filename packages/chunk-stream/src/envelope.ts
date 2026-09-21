import type {
  RuntimeChunkEnvelopeDescriptor,
  RuntimeResourceRef,
  ResourceLease,
} from "./types.js";

const FORBIDDEN_PROTOTYPE_KEYS = ["__proto__", "prototype", "constructor"] as const;

/**
 * Validates that an object does not contain prototype poisoning properties.
 */
export function assertNoPrototypePoisoning(value: unknown): void {
  if (!value || typeof value !== "object") return;
  for (const key of FORBIDDEN_PROTOTYPE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      throw new Error(`E_PROTOTYPE_POISONING: Forbidden prototype key detected: "${key}"`);
    }
  }
}

/**
 * Monomorphic schemaVersion 1 Runtime Chunk Envelope.
 * Guarantees zero-loss serialization and immutability of transport frames.
 */
export class RuntimeChunkEnvelope<TData = unknown, TState = unknown> {
  readonly schemaVersion: 1 = 1;
  readonly id: string;
  readonly sequence: number;
  readonly streamId: string;
  readonly fromFrame: number;
  readonly toFrame: number;
  readonly payloadFormat: string;
  readonly data: TData;
  readonly state: TState;
  readonly resources: readonly RuntimeResourceRef[];
  readonly residentBytes: number;

  private readonly leases = new Map<string, ResourceLease>();

  constructor(descriptor: RuntimeChunkEnvelopeDescriptor<TData, TState>) {
    assertNoPrototypePoisoning(descriptor);

    if (descriptor.schemaVersion !== undefined && descriptor.schemaVersion !== 1) {
      throw new Error(`Invalid schemaVersion: expected 1, received ${descriptor.schemaVersion}`);
    }
    if (typeof descriptor.id !== "string" || !descriptor.id.trim()) {
      throw new Error("Envelope id must be a non-empty string");
    }
    if (typeof descriptor.fromFrame !== "number" || typeof descriptor.toFrame !== "number") {
      throw new Error("Envelope frame bounds must be numbers");
    }
    if (descriptor.fromFrame > descriptor.toFrame) {
      throw new Error(`Envelope fromFrame (${descriptor.fromFrame}) cannot exceed toFrame (${descriptor.toFrame})`);
    }

    this.id = descriptor.id;
    this.sequence = descriptor.sequence ?? 0;
    this.streamId = descriptor.streamId ?? "";
    this.fromFrame = descriptor.fromFrame;
    this.toFrame = descriptor.toFrame;
    this.payloadFormat = descriptor.payloadFormat ?? "unknown";
    this.data = descriptor.data as TData;
    this.state = descriptor.state as TState;
    this.resources = Array.isArray(descriptor.resources) ? Object.freeze([...descriptor.resources]) : Object.freeze([]);
    this.residentBytes = typeof descriptor.residentBytes === "number" ? Math.max(0, descriptor.residentBytes) : 0;
  }

  get durationFrames(): number {
    return Math.max(0, this.toFrame - this.fromFrame);
  }

  containsFrame(frame: number): boolean {
    return frame >= this.fromFrame && frame <= this.toFrame;
  }

  addLease(lease: ResourceLease): void {
    assertNoPrototypePoisoning(lease);
    this.leases.set(lease.id, lease);
  }

  removeLease(leaseId: string): boolean {
    return this.leases.delete(leaseId);
  }

  getActiveLeases(): readonly ResourceLease[] {
    return Array.from(this.leases.values());
  }

  toJSON(): RuntimeChunkEnvelopeDescriptor<TData, TState> {
    return {
      schemaVersion: 1,
      id: this.id,
      sequence: this.sequence,
      streamId: this.streamId,
      fromFrame: this.fromFrame,
      toFrame: this.toFrame,
      payloadFormat: this.payloadFormat,
      data: this.data,
      state: this.state,
      resources: this.resources,
      residentBytes: this.residentBytes,
    };
  }
}

export function createRuntimeEnvelope<TData = unknown, TState = unknown>(
  descriptorOrEnvelope: RuntimeChunkEnvelope<TData, TState> | RuntimeChunkEnvelopeDescriptor<TData, TState>
): RuntimeChunkEnvelope<TData, TState> {
  if (descriptorOrEnvelope instanceof RuntimeChunkEnvelope) {
    return descriptorOrEnvelope;
  }
  return new RuntimeChunkEnvelope(descriptorOrEnvelope);
}
