/**
 * A structural copy of the `@opentelemetry/api` 1.9.0 tracing declarations (Apache-2.0)
 * that `createOtelDispatcher` is documented to receive: `trace.getTracer()` and
 * `trace.getActiveSpan()`. `@opentelemetry/api` is not a dependency of this package, so the
 * signatures are copied as published, including `Span.addEvent`'s `attributesOrStartTime`
 * shape and `SpanOptions`, which are what decide assignability to the dispatcher's types.
 *
 * `createRecordingTrace()` implements those declarations and records what it receives. Like
 * the OpenTelemetry SDK, it treats attribute values outside `AttributeValue` as invalid.
 */

export type AttributeValue =
  | string
  | number
  | boolean
  | Array<null | undefined | string>
  | Array<null | undefined | number>
  | Array<null | undefined | boolean>;

export interface Attributes {
  [attributeKey: string]: AttributeValue | undefined;
}

export type HrTime = [number, number];
export type TimeInput = HrTime | number | Date;

export enum SpanStatusCode {
  UNSET = 0,
  OK = 1,
  ERROR = 2,
}

export interface SpanStatus {
  code: SpanStatusCode;
  message?: string;
}

export enum SpanKind {
  INTERNAL = 0,
  SERVER = 1,
  CLIENT = 2,
  PRODUCER = 3,
  CONSUMER = 4,
}

export interface TraceState {
  set(key: string, value: string): TraceState;
  unset(key: string): TraceState;
  get(key: string): string | undefined;
  serialize(): string;
}

export interface SpanContext {
  traceId: string;
  spanId: string;
  isRemote?: boolean;
  traceFlags: number;
  traceState?: TraceState;
}

export interface Link {
  context: SpanContext;
  attributes?: Attributes;
  droppedAttributesCount?: number;
}

interface ExceptionWithCode {
  code: string | number;
  name?: string;
  message?: string;
  stack?: string;
}

interface ExceptionWithMessage {
  code?: string | number;
  message: string;
  name?: string;
  stack?: string;
}

interface ExceptionWithName {
  code?: string | number;
  message?: string;
  name: string;
  stack?: string;
}

export type Exception = ExceptionWithCode | ExceptionWithMessage | ExceptionWithName | string;

export interface Context {
  getValue(key: symbol): unknown;
  setValue(key: symbol, value: unknown): Context;
  deleteValue(key: symbol): Context;
}

export interface SpanOptions {
  kind?: SpanKind;
  attributes?: Attributes;
  links?: Link[];
  startTime?: TimeInput;
  root?: boolean;
}

export interface Span {
  spanContext(): SpanContext;
  setAttribute(key: string, value: AttributeValue): this;
  setAttributes(attributes: Attributes): this;
  addEvent(name: string, attributesOrStartTime?: Attributes | TimeInput, startTime?: TimeInput): this;
  addLink(link: Link): this;
  addLinks(links: Link[]): this;
  setStatus(status: SpanStatus): this;
  updateName(name: string): this;
  end(endTime?: TimeInput): void;
  isRecording(): boolean;
  recordException(exception: Exception, time?: TimeInput): void;
}

export interface Tracer {
  startSpan(name: string, options?: SpanOptions, context?: Context): Span;
  startActiveSpan<F extends (span: Span) => unknown>(name: string, fn: F): ReturnType<F>;
  startActiveSpan<F extends (span: Span) => unknown>(name: string, options: SpanOptions, fn: F): ReturnType<F>;
  startActiveSpan<F extends (span: Span) => unknown>(
    name: string,
    options: SpanOptions,
    context: Context,
    fn: F,
  ): ReturnType<F>;
}

/** The members of `@opentelemetry/api`'s `trace` (a `TraceAPI`) the README uses. */
export interface TraceApi {
  getTracer(name: string, version?: string): Tracer;
  getActiveSpan(): Span | undefined;
}

function isPrimitive(value: unknown): boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

/** The SDK's attribute check: a primitive, or an array whose non-null items share one primitive type. */
function isValidAttributeValue(value: unknown): boolean {
  if (isPrimitive(value)) return true;
  if (!Array.isArray(value)) return false;
  const types = new Set<string>();
  for (const item of value) {
    if (item === null || item === undefined) continue;
    if (!isPrimitive(item)) return false;
    types.add(typeof item);
  }
  return types.size <= 1;
}

export class RecordingSpan implements Span {
  readonly attributes: Attributes = {};
  readonly events: Array<{ name: string; attributes: Attributes | undefined }> = [];
  readonly statuses: SpanStatus[] = [];
  readonly exceptions: Exception[] = [];
  /** Attribute keys whose values OpenTelemetry would reject. */
  readonly invalidAttributes: string[] = [];
  endCount = 0;

  constructor(
    public name: string,
    attributes?: Attributes,
  ) {
    if (attributes) this.setAttributes(attributes);
  }

  spanContext(): SpanContext {
    return { traceId: '0af7651916cd43dd8448eb211c80319c', spanId: 'b7ad6b7169203331', traceFlags: 1 };
  }

  setAttribute(key: string, value: AttributeValue): this {
    if (isValidAttributeValue(value)) {
      this.attributes[key] = value;
    } else {
      this.invalidAttributes.push(key);
    }
    return this;
  }

  setAttributes(attributes: Attributes): this {
    for (const [key, value] of Object.entries(attributes)) {
      if (value !== undefined) this.setAttribute(key, value);
    }
    return this;
  }

  addEvent(name: string, attributesOrStartTime?: Attributes | TimeInput): this {
    const attributes =
      attributesOrStartTime === undefined ||
      typeof attributesOrStartTime === 'number' ||
      attributesOrStartTime instanceof Date ||
      Array.isArray(attributesOrStartTime)
        ? undefined
        : attributesOrStartTime;
    for (const [key, value] of Object.entries(attributes ?? {})) {
      if (value !== undefined && !isValidAttributeValue(value)) this.invalidAttributes.push(key);
    }
    this.events.push({ name, attributes });
    return this;
  }

  addLink(_link: Link): this {
    return this;
  }

  addLinks(_links: Link[]): this {
    return this;
  }

  setStatus(status: SpanStatus): this {
    this.statuses.push(status);
    return this;
  }

  updateName(name: string): this {
    this.name = name;
    return this;
  }

  end(_endTime?: TimeInput): void {
    this.endCount += 1;
  }

  isRecording(): boolean {
    return this.endCount === 0;
  }

  recordException(exception: Exception, _time?: TimeInput): void {
    this.exceptions.push(exception);
  }
}

/** An in-memory `trace` API: `getTracer()` records every started span; the active span is settable. */
export function createRecordingTrace() {
  const spans: RecordingSpan[] = [];
  let activeSpan: Span | undefined;

  const tracer: Tracer = {
    startSpan(name: string, options?: SpanOptions): Span {
      const span = new RecordingSpan(name, options?.attributes);
      spans.push(span);
      return span;
    },
    startActiveSpan(): never {
      throw new Error('createOtelDispatcher never calls startActiveSpan');
    },
  };

  const trace: TraceApi = {
    getTracer: () => tracer,
    getActiveSpan: () => activeSpan,
  };

  return {
    trace,
    spans,
    setActiveSpan(span: Span | undefined): void {
      activeSpan = span;
    },
  };
}
