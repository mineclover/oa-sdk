import {
  metrics,
  trace,
  SpanStatusCode,
  type Counter,
  type Histogram,
  type Meter,
  type Span,
  type Tracer,
  type UpDownCounter,
} from "@opentelemetry/api";

import type { AgentResult, AgentStatus, Issue } from "./types.js";

/**
 * The orchestrator emits OpenTelemetry metrics + spans through the global
 * Meter and Tracer providers. Operators wire their SDK before `run()`:
 *
 *   import { metrics, trace } from "@opentelemetry/api";
 *   metrics.setGlobalMeterProvider(...);
 *   trace.setGlobalTracerProvider(...);
 *
 * Without an SDK, the @opentelemetry/api defaults are no-ops — zero overhead,
 * no functional change. So this is always safe to ship.
 */

const NAME = "orchestrator-gitlab";

interface OrchestratorInstruments {
  readonly meter: Meter;
  readonly tracer: Tracer;
  readonly dispatched: Counter;
  readonly succeeded: Counter;
  readonly failed: Counter;
  readonly cancelled: Counter;
  readonly tokensTotal: Counter;
  readonly inFlight: UpDownCounter;
  readonly turnDurationMs: Histogram;
  readonly reloads: Counter;
  readonly reloadFailures: Counter;
}

let cached: OrchestratorInstruments | undefined;

export function getInstruments(): OrchestratorInstruments {
  if (cached !== undefined) return cached;
  const meter = metrics.getMeter(NAME);
  const tracer = trace.getTracer(NAME);
  cached = {
    meter,
    tracer,
    dispatched: meter.createCounter("orchestrator.dispatched", {
      description: "Issues claimed by the orchestrator and handed to a worker.",
    }),
    succeeded: meter.createCounter("orchestrator.succeeded", {
      description: "Workers that finished with a successful final agent turn.",
    }),
    failed: meter.createCounter("orchestrator.failed", {
      description: "Workers that finished with a non-success terminal status (failed/timed-out).",
    }),
    cancelled: meter.createCounter("orchestrator.cancelled", {
      description: "Workers cancelled by the orchestrator (signal abort or reconciliation).",
    }),
    tokensTotal: meter.createCounter("orchestrator.tokens.total", {
      description: "Total tokens reported by agents (input + output).",
    }),
    inFlight: meter.createUpDownCounter("orchestrator.in_flight", {
      description: "Workers currently processing an issue.",
    }),
    turnDurationMs: meter.createHistogram("orchestrator.turn.duration_ms", {
      description: "End-to-end duration of a single agent turn (all attempts within that turn).",
      unit: "ms",
    }),
    reloads: meter.createCounter("orchestrator.reloads", {
      description: "Successful WORKFLOW.md hot reloads.",
    }),
    reloadFailures: meter.createCounter("orchestrator.reload_failures", {
      description: "Failed WORKFLOW.md hot reloads (last-known-good kept).",
    }),
  };
  return cached;
}

/** Reset the cached instruments. Test-only. */
export function _resetInstrumentsForTest(): void {
  cached = undefined;
}

export function recordDispatched(issue: Readonly<Issue>, agentName: string): void {
  getInstruments().dispatched.add(1, { agent: agentName });
  getInstruments().inFlight.add(1, { agent: agentName });
  void issue; // attribute kept lean for cardinality safety
}

export function recordWorkerExit(
  issue: Readonly<Issue>,
  agentName: string,
  status: AgentStatus,
): void {
  const inst = getInstruments();
  inst.inFlight.add(-1, { agent: agentName });
  switch (status) {
    case "succeeded":
      inst.succeeded.add(1, { agent: agentName });
      break;
    case "failed":
    case "timed-out":
      inst.failed.add(1, { agent: agentName, status });
      break;
    case "cancelled":
      inst.cancelled.add(1, { agent: agentName });
      break;
  }
  void issue;
}

export function recordTurn(
  issue: Readonly<Issue>,
  agentName: string,
  turnNumber: number,
  durationMs: number,
  result: Readonly<AgentResult>,
): void {
  const inst = getInstruments();
  inst.turnDurationMs.record(durationMs, {
    agent: agentName,
    status: result.status,
  });
  if (result.tokens !== undefined) {
    inst.tokensTotal.add(result.tokens.total, { agent: agentName });
  }
  void issue;
  void turnNumber;
}

export function recordReload(success: boolean): void {
  const inst = getInstruments();
  if (success) inst.reloads.add(1);
  else inst.reloadFailures.add(1);
}

export interface SpanRecorder {
  end(result: AgentResult | { status: "no-turns-ran" }): void;
}

export function startProcessIssueSpan(issue: Readonly<Issue>, agentName: string): SpanRecorder {
  const span = getInstruments().tracer.startSpan("orchestrator.process_issue", {
    attributes: {
      "issue.id": issue.id,
      "issue.iid": issue.iid,
      "agent.name": agentName,
    },
  });
  return spanRecorder(span);
}

export function startTurnSpan(
  issue: Readonly<Issue>,
  agentName: string,
  turnNumber: number,
  attempt: number,
): SpanRecorder {
  const span = getInstruments().tracer.startSpan("agent.run", {
    attributes: {
      "issue.id": issue.id,
      "issue.iid": issue.iid,
      "agent.name": agentName,
      "turn.number": turnNumber,
      "attempt.number": attempt,
    },
  });
  return spanRecorder(span);
}

function spanRecorder(span: Span): SpanRecorder {
  return {
    end(result): void {
      span.setAttribute("status", result.status);
      if (result.status === "succeeded") {
        span.setStatus({ code: SpanStatusCode.OK });
      } else if (result.status === "no-turns-ran") {
        span.setStatus({ code: SpanStatusCode.ERROR, message: "no turns ran" });
      } else {
        span.setStatus({ code: SpanStatusCode.ERROR, message: result.status });
      }
      span.end();
    },
  };
}
