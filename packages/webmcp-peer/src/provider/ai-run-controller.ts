export type AiRunPhase =
  | "queued"
  | "running"
  | "paused"
  | "stopped"
  | "completed"
  | "failed"
  | "rolled-back";

export type AiRollbackStatus = "completed" | "partial" | "outcome-unknown";

export interface AiRunPoint {
  readonly slideId: string;
  readonly x: number;
  readonly y: number;
  readonly stepIndex: number;
  readonly operationId?: string;
}

export interface AiRunStep {
  readonly actionId: string;
  readonly stepIndex: number;
  readonly operationId?: string;
  readonly transactionId?: string;
  readonly requestId?: string;
  readonly cursorTrail?: readonly AiRunPoint[];
}

export interface AiRunRollbackSummary {
  readonly status: AiRollbackStatus;
  readonly attemptedOperationIds: readonly string[];
  readonly rolledBackOperationIds: readonly string[];
  readonly unknownOperationIds: readonly string[];
  readonly failedOperationIds: readonly string[];
}

export interface AiRunSnapshot {
  readonly runId: string;
  readonly phase: AiRunPhase;
  readonly actionId: string;
  readonly stepIndex: number;
  readonly cursorTrail: readonly AiRunPoint[];
  readonly operationIds: readonly string[];
  readonly transactionIds: Readonly<Record<string, string>>;
  readonly requestIds: Readonly<Record<string, string>>;
  readonly stoppedReason?: string;
  readonly terminalReason?: string;
  readonly rollback?: AiRunRollbackSummary;
}

export type AiRollbackStepResult = "rolled-back" | "outcome-unknown" | "failed";

interface MutableRun {
  runId: string;
  phase: AiRunPhase;
  actionId: string;
  stepIndex: number;
  cursorTrail: AiRunPoint[];
  operationIds: string[];
  operationSteps: Map<string, number>;
  transactionIds: Map<string, string>;
  requestIds: Map<string, string>;
  controllers: Map<string, AbortController>;
  stoppedReason?: string;
  terminalReason?: string;
  rollback?: AiRunRollbackSummary;
}

type AiRunListener = () => void;

function requireRunId(runId: string): string {
  if (typeof runId !== "string" || !runId.trim() || runId.trim().length > 128) {
    throw new Error("AI runId is required and bounded");
  }
  return runId.trim();
}

function requireStepIndex(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("AI stepIndex must be a non-negative safe integer");
  }
  return value;
}

function clonePoint(point: AiRunPoint): AiRunPoint {
  if (
    !point ||
    typeof point.slideId !== "string" ||
    !point.slideId.trim() ||
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y)
  ) {
    throw new Error("AI trajectory point is invalid");
  }
  return {
    slideId: point.slideId,
    x: point.x,
    y: point.y,
    stepIndex: requireStepIndex(point.stepIndex),
    ...(point.operationId ? { operationId: point.operationId } : {}),
  };
}

function snapshotRun(run: MutableRun): AiRunSnapshot {
  return {
    runId: run.runId,
    phase: run.phase,
    actionId: run.actionId,
    stepIndex: run.stepIndex,
    cursorTrail: run.cursorTrail.map(clonePoint),
    operationIds: [...run.operationIds],
    transactionIds: Object.fromEntries(run.transactionIds.entries()),
    requestIds: Object.fromEntries(run.requestIds.entries()),
    ...(run.stoppedReason ? { stoppedReason: run.stoppedReason } : {}),
    ...(run.terminalReason ? { terminalReason: run.terminalReason } : {}),
    ...(run.rollback
      ? {
          rollback: {
            ...run.rollback,
            attemptedOperationIds: [...run.rollback.attemptedOperationIds],
            rolledBackOperationIds: [...run.rollback.rolledBackOperationIds],
            unknownOperationIds: [...run.rollback.unknownOperationIds],
            failedOperationIds: [...run.rollback.failedOperationIds],
          },
        }
      : {}),
  };
}

export class AiRunController {
  private readonly runs = new Map<string, MutableRun>();
  private readonly snapshotCache = new Map<string, AiRunSnapshot>();
  private allSnapshot: readonly AiRunSnapshot[] = [];
  private readonly listeners = new Set<AiRunListener>();
  private readonly rollbackInFlight = new Set<string>();

  begin(runId: string, actionId = "run", stepIndex = 0): AiRunSnapshot {
    const id = requireRunId(runId);
    const existing = this.runs.get(id);
    if (existing) return this.cached(existing);
    if (this.runs.size >= 128) {
      const terminal = [...this.runs.values()].find((candidate) =>
        ["completed", "failed", "rolled-back"].includes(candidate.phase),
      );
      if (terminal) this.runs.delete(terminal.runId);
      else throw new Error("AI run limit exceeded");
    }
    const run: MutableRun = {
      runId: id,
      phase: "queued",
      actionId: actionId || "run",
      stepIndex: requireStepIndex(stepIndex),
      cursorTrail: [],
      operationIds: [],
      operationSteps: new Map(),
      transactionIds: new Map(),
      requestIds: new Map(),
      controllers: new Map(),
    };
    this.runs.set(id, run);
    this.emit();
    return this.cached(run);
  }

  get(runId: string): AiRunSnapshot | undefined {
    const run = this.runs.get(requireRunId(runId));
    return run ? this.cached(run) : undefined;
  }

  getAll(): readonly AiRunSnapshot[] {
    return this.allSnapshot;
  }

  subscribe(listener: AiRunListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(runId: string): AiRunSnapshot {
    const run = this.require(runId);
    if (run.phase === "queued" || run.phase === "paused") {
      run.phase = "running";
      this.emit();
    }
    return this.cached(run);
  }

  pause(runId: string): AiRunSnapshot {
    const run = this.require(runId);
    if (run.phase === "running" || run.phase === "queued") {
      run.phase = "paused";
      this.emit();
    }
    return this.cached(run);
  }

  registerAction(runId: string, requestId: string, controller: AbortController): AiRunSnapshot {
    const run = this.require(runId);
    if (!requestId.trim()) throw new Error("AI requestId is required");
    let changed = false;
    if (run.phase === "queued" || run.phase === "paused") {
      run.phase = "running";
      changed = true;
    }
    if (
      run.phase === "stopped" ||
      run.phase === "completed" ||
      run.phase === "failed" ||
      run.phase === "rolled-back"
    ) {
      controller.abort("AI run is terminal");
    } else {
      run.controllers.set(requestId, controller);
      changed = true;
    }
    if (changed) this.emit();
    return this.cached(run);
  }

  settleAction(runId: string, requestId: string): AiRunSnapshot {
    const run = this.require(runId);
    if (run.controllers.delete(requestId)) this.emit();
    return this.cached(run);
  }

  recordStep(runId: string, step: AiRunStep): AiRunSnapshot {
    const run = this.require(runId);
    if (!step.actionId.trim()) throw new Error("AI actionId is required");
    const stepIndex = requireStepIndex(step.stepIndex);
    const stale = stepIndex < run.stepIndex;
    let changed = false;
    if (run.phase === "queued" || run.phase === "paused") {
      run.phase = "running";
      changed = true;
    }
    if (step.operationId && !run.operationIds.includes(step.operationId)) {
      run.operationIds.push(step.operationId);
      changed = true;
    }
    if (step.operationId && run.operationSteps.get(step.operationId) !== stepIndex) {
      run.operationSteps.set(step.operationId, stepIndex);
      changed = true;
    }
    if (step.operationId && step.transactionId && run.transactionIds.get(step.operationId) !== step.transactionId) {
      run.transactionIds.set(step.operationId, step.transactionId);
      changed = true;
    }
    if (step.operationId && step.requestId && run.requestIds.get(step.operationId) !== step.requestId) {
      run.requestIds.set(step.operationId, step.requestId);
      changed = true;
    }
    if (!stale) {
      if (run.actionId !== step.actionId || run.stepIndex !== stepIndex) changed = true;
      run.actionId = step.actionId;
      run.stepIndex = stepIndex;
    }
    if (!stale && step.cursorTrail) {
      const existing = new Set(
        run.cursorTrail.map(
          (point) => `${point.slideId}:${point.x}:${point.y}:${point.stepIndex}:${point.operationId ?? ""}`,
        ),
      );
      for (const point of step.cursorTrail.map(clonePoint)) {
        const key = `${point.slideId}:${point.x}:${point.y}:${point.stepIndex}:${point.operationId ?? ""}`;
        if (!existing.has(key)) {
          run.cursorTrail.push(point);
          existing.add(key);
          changed = true;
        }
      }
      if (run.cursorTrail.length > 64) {
        run.cursorTrail = run.cursorTrail.slice(-64);
        changed = true;
      }
    }
    if (changed) this.emit();
    return this.cached(run);
  }

  stop(runId: string, reason = "stopped by host"): AiRunSnapshot {
    const run = this.require(runId);
    if (run.phase === "completed" || run.phase === "failed" || run.phase === "rolled-back") {
      return this.cached(run);
    }
    for (const controller of run.controllers.values()) controller.abort(reason);
    run.phase = "stopped";
    run.stoppedReason = reason;
    this.emit();
    return this.cached(run);
  }

  complete(runId: string, reason?: string): AiRunSnapshot {
    const run = this.require(runId);
    run.phase = "completed";
    run.terminalReason = reason;
    this.emit();
    return this.cached(run);
  }

  fail(runId: string, reason: string): AiRunSnapshot {
    const run = this.require(runId);
    run.phase = "failed";
    run.terminalReason = reason;
    for (const controller of run.controllers.values()) controller.abort(reason);
    this.emit();
    return this.cached(run);
  }

  async rollback(
    runId: string,
    undo: (operationId: string, index: number) => Promise<AiRollbackStepResult> | AiRollbackStepResult,
  ): Promise<AiRunSnapshot> {
    const run = this.require(runId);
    if (this.rollbackInFlight.has(run.runId)) throw new Error("AI rollback is already in flight");
    if (run.phase === "queued" || run.phase === "running" || run.phase === "paused") {
      throw new Error("AI run has active work; stop or settle it before rollback");
    }
    if (run.controllers.size > 0) throw new Error("AI run still has in-flight actions");
    const alreadyRolledBack = new Set(run.rollback?.rolledBackOperationIds ?? []);
    const unknownBefore = new Set(run.rollback?.unknownOperationIds ?? []);
    const candidates = [...run.operationIds]
      .filter((operationId) => !alreadyRolledBack.has(operationId) && !unknownBefore.has(operationId))
      .sort((left, right) => (run.operationSteps.get(right) ?? 0) - (run.operationSteps.get(left) ?? 0));
    this.rollbackInFlight.add(run.runId);
    const rolledBack: string[] = [];
    const unknown: string[] = [];
    const failed: string[] = [];
    const attempted: string[] = [];
    try {
      for (let index = 0; index < candidates.length; index += 1) {
        const operationId = candidates[index]!;
        attempted.push(operationId);
        let result: AiRollbackStepResult;
        try {
          result = await undo(operationId, index);
        } catch {
          result = "outcome-unknown";
        }
        if (result === "rolled-back") rolledBack.push(operationId);
        else if (result === "outcome-unknown") {
          unknown.push(operationId);
          break;
        } else {
          failed.push(operationId);
          break;
        }
      }
      if (this.runs.get(run.runId) !== run) return snapshotRun(run);
      const previousRolledBack = run.rollback?.rolledBackOperationIds ?? [];
      const allRolledBack = [...previousRolledBack, ...rolledBack];
      const allUnknown = [...unknownBefore, ...unknown];
      const status: AiRollbackStatus =
        allUnknown.length > 0 ? "outcome-unknown" : failed.length > 0 ? "partial" : "completed";
      run.rollback = {
        status,
        attemptedOperationIds: attempted,
        rolledBackOperationIds: allRolledBack,
        unknownOperationIds: allUnknown,
        failedOperationIds: failed,
      };
      if (status === "completed") run.phase = "rolled-back";
      this.emit();
      return this.cached(run);
    } finally {
      this.rollbackInFlight.delete(run.runId);
    }
  }

  delete(runId: string): boolean {
    const id = requireRunId(runId);
    const run = this.runs.get(id);
    if (!run) return false;
    for (const controller of run.controllers.values()) controller.abort("AI run deleted");
    this.runs.delete(id);
    this.snapshotCache.delete(id);
    this.emit();
    return true;
  }

  clear(reason = "AI session released"): void {
    for (const run of this.runs.values()) {
      for (const controller of run.controllers.values()) controller.abort(reason);
    }
    this.runs.clear();
    this.snapshotCache.clear();
    this.allSnapshot = [];
    for (const listener of this.listeners) listener();
  }

  private cached(run: MutableRun): AiRunSnapshot {
    const current = this.snapshotCache.get(run.runId);
    if (current) return current;
    const next = snapshotRun(run);
    this.snapshotCache.set(run.runId, next);
    return next;
  }

  private emit(): void {
    this.snapshotCache.clear();
    const next: AiRunSnapshot[] = [];
    for (const run of this.runs.values()) {
      const value = snapshotRun(run);
      this.snapshotCache.set(run.runId, value);
      next.push(value);
    }
    this.allSnapshot = next;
    for (const listener of this.listeners) listener();
  }

  private require(runId: string): MutableRun {
    const id = requireRunId(runId);
    const run = this.runs.get(id);
    if (!run) throw new Error(`Unknown AI run: ${id}`);
    return run;
  }
}
