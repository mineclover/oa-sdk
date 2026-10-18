import { useState, useEffect, useCallback } from "react";
import type { ResidencyController } from "@oa-sdk/chunk-stream";
import type { ChunkStreamManifest } from "@oa-sdk/chunk-stream-ui";
import { formatBytes } from "./utils.js";

export interface UseChunkTelemetryOptions {
  readonly residency?: ResidencyController | undefined;
  readonly manifest?: ChunkStreamManifest | undefined;
  readonly pollIntervalMs?: number | undefined;
}

export interface UseChunkTelemetryResult {
  readonly residentBytes: number;
  readonly residentFormatted: string;
  readonly leaseCount: number;
  readonly chunkCount: number;
  readonly totalDurationSec: number;
  readonly fps: number;
  readonly preset: string;
  readonly memoryPreset: string;
  readonly targetChunkBytes: number;
  readonly refresh: () => void;
}

export function useChunkTelemetry(options: UseChunkTelemetryOptions = {}): UseChunkTelemetryResult {
  const { residency, manifest, pollIntervalMs = 1000 } = options;

  const [residentBytes, setResidentBytes] = useState(() => residency?.residentBytes ?? 0);
  const [leaseCount, setLeaseCount] = useState(() => residency?.leaseCount ?? 0);

  const refresh = useCallback(() => {
    if (residency) {
      setResidentBytes(residency.residentBytes);
      setLeaseCount(residency.leaseCount);
    }
  }, [residency]);

  useEffect(() => {
    if (!residency) return;
    refresh();
    const interval = setInterval(refresh, pollIntervalMs);
    return () => clearInterval(interval);
  }, [residency, pollIntervalMs, refresh]);

  return {
    residentBytes,
    residentFormatted: formatBytes(residentBytes),
    leaseCount,
    chunkCount: manifest?.chunkCount ?? 0,
    totalDurationSec: manifest?.totalDurationSec ?? 0,
    fps: manifest?.fps ?? 30,
    preset: manifest?.preset ?? "optimal-web",
    memoryPreset: manifest?.memoryPreset ?? "standard",
    targetChunkBytes: manifest?.targetChunkBytes ?? 7168,
    refresh,
  };
}

