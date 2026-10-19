import type { TelemetryDispatcher } from './types.js';
import type { TelemetryContext, TelemetryEnvelope } from '../envelope/types.js';
import type { SymbolDefinition } from '../symbols/types.js';

/**
 * An attribute value as `@opentelemetry/api` defines `AttributeValue`: a primitive, or an
 * array of one primitive type (with `null`/`undefined` holes).
 */
export type OtelAttributeValue =
  | string
  | number
  | boolean
  | Array<null | undefined | string>
  | Array<null | undefined | number>
  | Array<null | undefined | boolean>;

/** An attribute map, the same shape as `Attributes` in `@opentelemetry/api`. */
export interface OtelAttributes {
  [attributeKey: string]: OtelAttributeValue | undefined;
}

/**
 * An exception as `Span.recordException` accepts it in `@opentelemetry/api`: a string, or an
 * object with at least a `name`, `message` or `code`.
 */
export type OtelException =
  | string
  | { name: string; message?: string; code?: string | number; stack?: string }
  | { message: string; name?: string; code?: string | number; stack?: string }
  | { code: string | number; name?: string; message?: string; stack?: string };

/**
 * The span methods the dispatcher calls. Every parameter is a subtype of the matching
 * `@opentelemetry/api` `Span` parameter, so a real `Span` is assignable to this type.
 */
export interface OtelLikeSpan {
  addEvent(name: string, attributes?: OtelAttributes): void;
  setStatus(status: { code: number; message?: string }): void;
  recordException?(exception: OtelException): void;
  end(): void;
}

/**
 * The tracer method the dispatcher calls. A real `@opentelemetry/api` `Tracer` (for example
 * `trace.getTracer('app')`) is assignable to this type.
 */
export interface OtelLikeTracer {
  startSpan(name: string, options?: { attributes?: OtelAttributes }): OtelLikeSpan;
  /** Non-standard: a real `@opentelemetry/api` Tracer has no `getActiveSpan`; use the option instead. */
  getActiveSpan?(): OtelLikeSpan | undefined;
}

export interface OtelDispatcherOptions {
  /**
   * Tracer that creates actor spans, e.g. `trace.getTracer('app')`. Without a tracer the
   * dispatcher creates no spans; events and errors are recorded only on the span that
   * `getActiveSpan` returns.
   */
  tracer?: OtelLikeTracer;
  /**
   * Resolves the ambient active span, e.g. `() => trace.getActiveSpan()` from
   * `@opentelemetry/api`. Falls back to `tracer.getActiveSpan()` when the tracer has one.
   */
  getActiveSpan?: () => OtelLikeSpan | undefined;
}

/** Attribute the XState inspector sets on actor spans (`dispatchSpanStart`). */
const ACTOR_SESSION_ATTRIBUTE = 'xstate.actor.session_id';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return isRecord(error) && typeof error.message === 'string' ? error.message : String(error);
}

function isPrimitiveAttribute(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

/** The values OpenTelemetry accepts as attributes: primitives and homogeneous primitive arrays. */
function isOtelAttributeValue(value: unknown): value is OtelAttributeValue {
  if (isPrimitiveAttribute(value)) return true;
  if (!Array.isArray(value)) return false;
  let elementType: string | undefined;
  for (const element of value) {
    if (element === null || element === undefined) continue;
    if (!isPrimitiveAttribute(element)) return false;
    const type = typeof element;
    if (elementType === undefined) {
      elementType = type;
    } else if (type !== elementType) {
      return false;
    }
  }
  return true;
}

/**
 * Keeps the attributes OpenTelemetry can represent. Other values (objects, functions,
 * mixed arrays) are dropped, as the OpenTelemetry SDK itself drops invalid attributes.
 */
function toOtelAttributes(attributes: Record<string, unknown>): OtelAttributes {
  const result: OtelAttributes = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (isOtelAttributeValue(value)) result[key] = value;
  }
  return result;
}

/** An `Error` or string as is; an error-shaped object by its fields; anything else as text. */
function toOtelException(error: unknown): OtelException {
  if (typeof error === 'string' || error instanceof Error) return error;
  if (isRecord(error)) {
    const fields: { name?: string; message?: string; code?: string | number; stack?: string } = {};
    if (typeof error.name === 'string') fields.name = error.name;
    if (typeof error.message === 'string') fields.message = error.message;
    if (typeof error.code === 'string' || typeof error.code === 'number') fields.code = error.code;
    if (typeof error.stack === 'string') fields.stack = error.stack;
    const { name, message, code } = fields;
    if (name !== undefined) return { ...fields, name };
    if (message !== undefined) return { ...fields, message };
    if (code !== undefined) return { ...fields, code };
  }
  return String(error);
}

function recordError(span: OtelLikeSpan, error: unknown): void {
  span.setStatus({ code: 2, message: errorMessage(error) });
  if (span.recordException && error) {
    span.recordException(toOtelException(error));
  }
}

/**
 * OpenTelemetry projection.
 * - Actor spans: `dispatchSpanStart` / `dispatchSpanEnd` (needs a `tracer`). An actor span
 *   that ends with `'error'` gets the error status and the exception, once. Span attributes
 *   OpenTelemetry cannot represent (anything but primitives and primitive arrays) are dropped.
 * - Events land on the ambient active span. When there is none, an event lands on the open
 *   span of its actor instance: the span whose `xstate.actor.session_id` attribute equals
 *   `context.actorSessionId` (the inspector sets both). An `actorId` is not used for this,
 *   since every instance of an invoked child shares it.
 * - Errors (`dispatchError`) land on the ambient active span only; the actor's own span
 *   records the error when the inspector ends it.
 */
export function createOtelDispatcher(options: OtelDispatcherOptions = {}): TelemetryDispatcher {
  const activeSpans = new Map<string, { span: OtelLikeSpan; actorSessionId: string | undefined }>();
  /** Ids of the open spans per actor session id; a fallback only when exactly one matches. */
  const actorSpanIds = new Map<string, Set<string>>();
  let spanSequence = 0;

  function getTracer(): OtelLikeTracer | undefined {
    return options.tracer;
  }

  function ambientSpan(): OtelLikeSpan | undefined {
    return options.getActiveSpan ? options.getActiveSpan() : getTracer()?.getActiveSpan?.();
  }

  function actorSpan(actorSessionId: string | undefined): OtelLikeSpan | undefined {
    if (actorSessionId === undefined) return undefined;
    const spanIds = actorSpanIds.get(actorSessionId);
    if (spanIds?.size !== 1) return undefined;
    const [spanId] = spanIds;
    return spanId === undefined ? undefined : activeSpans.get(spanId)?.span;
  }

  return {
    name: 'otel',
    dispatch(envelope: TelemetryEnvelope, _symbolDef?: SymbolDefinition) {
      const span = ambientSpan() ?? actorSpan(envelope.context.actorSessionId);

      if (span) {
        span.addEvent(envelope.symbol, {
          'xstate.actor_id': envelope.context.actorId,
          'xstate.state_node': envelope.context.stateNode,
          'trace.id': envelope.context.traceId,
        });
      }
    },

    dispatchSpanStart(spanName: string, attributes?: Record<string, unknown>): string | void {
      const tracer = getTracer();
      if (!tracer) return;

      spanSequence += 1;
      // The sequence keeps ids unique within this dispatcher, even within one millisecond.
      const spanId = `span_${Date.now()}_${spanSequence}`;
      const spanAttributes = attributes ? toOtelAttributes(attributes) : undefined;
      const span = spanAttributes ? tracer.startSpan(spanName, { attributes: spanAttributes }) : tracer.startSpan(spanName);
      const sessionAttribute = spanAttributes?.[ACTOR_SESSION_ATTRIBUTE];
      const actorSessionId = typeof sessionAttribute === 'string' ? sessionAttribute : undefined;
      activeSpans.set(spanId, { span, actorSessionId });
      if (actorSessionId !== undefined) {
        const spanIds = actorSpanIds.get(actorSessionId) ?? new Set<string>();
        spanIds.add(spanId);
        actorSpanIds.set(actorSessionId, spanIds);
      }
      return spanId;
    },

    dispatchSpanEnd(spanId: string, status: 'ok' | 'error' = 'ok', error?: unknown) {
      const entry = activeSpans.get(spanId);
      if (!entry) return;
      activeSpans.delete(spanId);
      const { span, actorSessionId } = entry;
      if (actorSessionId !== undefined) {
        const spanIds = actorSpanIds.get(actorSessionId);
        spanIds?.delete(spanId);
        if (spanIds?.size === 0) actorSpanIds.delete(actorSessionId);
      }

      if (status === 'error') {
        recordError(span, error);
      } else {
        span.setStatus({ code: 1 });
      }

      span.end();
    },

    dispatchError(error: unknown, _context: TelemetryContext, stateNode?: string) {
      const span = ambientSpan();
      if (span) {
        recordError(span, error);
        span.addEvent('error', {
          'xstate.state_node': stateNode,
        });
      }
    },
  };
}
