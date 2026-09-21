import type { ForecasterProfile } from "./types.js";

export const STANDARD_PROFILES: Record<string, ForecasterProfile> = {
  "ui-action@v1": {
    peakMultiplier: 4,
    peakOverhead: 2048,
    residentMultiplier: 2,
    residentBase: 512,
    aliases: ["ui-action", "ui"],
  },
  "time-series@v1": {
    peakMultiplier: 2,
    peakOverhead: 1024,
    residentMultiplier: 1.5,
    residentBase: 256,
    aliases: ["time-series", "metrics"],
  },
  "crdt-delta@v1": {
    peakMultiplier: 6,
    peakOverhead: 4096,
    residentMultiplier: 3,
    residentBase: 1024,
    aliases: ["crdt-delta", "crdt"],
  },
};

/**
 * 3-Axis Reservation Forecaster for estimating memory requirements
 * and managing prefetch budgets.
 */
export class ReservationForecaster {
  private readonly profiles = new Map<string, ForecasterProfile>();

  constructor() {
    for (const [format, profile] of Object.entries(STANDARD_PROFILES)) {
      this.profiles.set(format, profile);
      for (const alias of profile.aliases) {
        this.profiles.set(alias, profile);
      }
    }
  }

  resolveProfile(format: string): ForecasterProfile {
    const matched = this.profiles.get(format);
    if (matched) return matched;
    return {
      peakMultiplier: 3,
      peakOverhead: 2048,
      residentMultiplier: 2,
      residentBase: 512,
      aliases: [],
    };
  }

  /**
   * Forecasts peak memory in bytes required during chunk intake and decode.
   */
  forecastPeakBytes(byteLength: number, format = "ui-action@v1"): number {
    const profile = this.resolveProfile(format);
    return Math.round(byteLength * profile.peakMultiplier + profile.peakOverhead);
  }

  /**
   * Forecasts resident memory in bytes retained in memory during playback.
   */
  forecastResidentBytes(byteLength: number, format = "ui-action@v1"): number {
    const profile = this.resolveProfile(format);
    return Math.round(byteLength * profile.residentMultiplier + profile.residentBase);
  }
}

/**
 * Ledger for managing memory budget allocations.
 */
export class BudgetLedger {
  private allocated = 0;

  constructor(readonly totalBudgetBytes: number) {}

  get allocatedBytes(): number {
    return this.allocated;
  }

  get remainingBytes(): number {
    return Math.max(0, this.totalBudgetBytes - this.allocated);
  }

  canAllocate(bytes: number): boolean {
    return this.allocated + bytes <= this.totalBudgetBytes;
  }

  allocate(bytes: number): boolean {
    if (!this.canAllocate(bytes)) return false;
    this.allocated += bytes;
    return true;
  }

  release(bytes: number): void {
    this.allocated = Math.max(0, this.allocated - bytes);
  }

  reset(): void {
    this.allocated = 0;
  }
}
