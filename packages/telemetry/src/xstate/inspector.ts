import type { SymbolRegistry } from '../symbols/registry.js';
import type { SymbolDefinition } from '../symbols/types.js';
import { isValidTrackSymbol, parseTrackSymbol } from '../symbols/grammar.js';
import type { TelemetryDispatcher } from '../dispatcher/types.js';
import type { DpmTelemetryAdapter } from '../dpm/types.js';
import { createDpmTelemetryAdapter } from '../dpm/adapter.js';
import { createTelemetryEnvelope, generateTraceId } from '../envelope/builder.js';
import type { TelemetryContext, TelemetryContextInput } from '../envelope/types.js';
import { getGlobalTelemetryIdentity, type TelemetryIdentity } from '../identity/identity.js';

export interface XStateInspectorOptions {
  dispatcher: TelemetryDispatcher;
  /**
   * Symbol catalog. It is probed with `has()` before `get()`, so a strict registry never
   * throws from the inspector: an unregistered event is dispatched without a definition
   * (the GTM dispatcher's whitelist then skips it) unless `strictSymbols` rejects it.
   */
  registry?: SymbolRegistry;
  /**
   * Sanitizer for event payloads and the global identity. Defaults to
   * `createDpmTelemetryAdapter()`, whose tokens use a random per-instance key.
   */
  dpmAdapter?: DpmTelemetryAdapter;
  /**
   * Extra context merged over the inspector's defaults. Fields that are `undefined`
   * never erase a default (trace id, actor id, state node, identity token).
   */
  getContext?: () => TelemetryContextInput;
  /**
   * When true, an event whose type is neither a valid tracking symbol nor registered is
   * a violation: it is not dispatched and is reported through `onError`. The machine
   * still receives the event.
   */
  strictSymbols?: boolean;
  /**
   * Receives every telemetry failure: a `strictSymbols` violation, or an exception from
   * the sanitizer, `getContext` or a dispatcher. Telemetry failures never propagate into
   * XState, so they can never abort `actor.send()` or `createActor()`. The default
   * rethrows the error asynchronously (`setTimeout`), the way XState reports errors from
   * its own observers, so failures stay visible to global error handlers.
   */
  onError?: (error: unknown, inspectionEvent: InspectionEventLike) => void;
}

/**
 * The parts of an XState actor ref the inspector reads. Structural, because `xstate` is
 * an optional peer dependency; XState's own `ActorRefLike` is assignable to it.
 */
export interface ActorRefLike {
  id?: string;
  sessionId?: string;
  getSnapshot?: () => unknown;
}

export interface SnapshotLike {
  status?: string;
  value?: unknown;
  context?: unknown;
  error?: unknown;
}

/**
 * Structural supertype of XState v5's `InspectionEvent`, so the inspector is assignable
 * to `ActorOptions.inspect` under `strictFunctionTypes`.
 */
export type InspectionEventLike =
  | {
      type: '@xstate.actor';
      actorRef: ActorRefLike;
      rootId?: string;
    }
  | {
      type: '@xstate.event';
      /** The recipient of the event. */
      actorRef: ActorRefLike;
      /** The sender (the parent for an actor's `xstate.init`, the child for its error event). */
      sourceRef?: ActorRefLike | undefined;
      event: { type: string; [key: string]: unknown };
      rootId?: string;
    }
  | {
      type: '@xstate.snapshot';
      actorRef: ActorRefLike;
      snapshot: SnapshotLike;
      event: { type: string; [key: string]: unknown };
      rootId?: string;
    }
  | {
      type: '@xstate.transition' | '@xstate.microstep' | '@xstate.action';
      actorRef: ActorRefLike;
      rootId?: string;
    };

type InspectedEvent = Extract<InspectionEventLike, { type: '@xstate.event' }>;
type InspectedSnapshot = Extract<InspectionEventLike, { type: '@xstate.snapshot' }>;

interface ActorTelemetryState {
  /** Trace shared by every envelope and error of one actor system (unless the caller supplies one). */
  traceId?: string;
  /**
   * Whether the actor is the root of its system: it has no parent in its `xstate.init`
   * event, or its session id is the `rootId` of an inspection event about it.
   */
  isRoot: boolean;
  spanStarted: boolean;
  /** Open span id; cleared when the span ends, so a span is ended at most once. */
  openSpanId?: string | undefined;
  errorReported: boolean;
  /**
   * Errors this actor received from its children (`xstate.error.actor.*`), keyed by the
   * error event, until this actor has processed that event. Each was already reported for
   * the child that failed with it (directly, or through a child escalating it), so it is
   * not reported again when it fails this actor too.
   */
  inheritedErrors: Map<InspectedEvent['event'], unknown>;
  rootCheckScheduled: boolean;
}

const XSTATE_INIT = 'xstate.init';
const XSTATE_STOP = 'xstate.stop';
const XSTATE_ERROR_ACTOR_PREFIX = 'xstate.error.actor';
/** Namespace of identity tokens; matches the `userId` payload keys of `DEFAULT_PII_KEYS`. */
const IDENTITY_NAMESPACE = 'user';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function rethrowAsync(error: unknown): void {
  setTimeout(() => {
    throw error;
  });
}

function scheduleMicrotask(task: () => void): void {
  if (typeof queueMicrotask === 'function') {
    queueMicrotask(task);
  } else {
    void Promise.resolve().then(task);
  }
}

function actorIdOf(actorRef: ActorRefLike): string | undefined {
  return actorRef.id ?? actorRef.sessionId;
}

function snapshotOf(actorRef: ActorRefLike): Record<string, unknown> | undefined {
  const snapshot = actorRef.getSnapshot?.();
  return isRecord(snapshot) ? snapshot : undefined;
}

/** `'idle'` → `'idle'`, `{ checkout: { payment: 'pending' } }` → `'checkout.payment.pending'`. */
function resolveStateNodeSymbol(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (isRecord(value)) {
    const firstKey = Object.keys(value)[0];
    if (firstKey !== undefined) {
      const child = resolveStateNodeSymbol(value[firstKey]);
      return child === undefined ? firstKey : `${firstKey}.${child}`;
    }
  }
  return undefined;
}

/** `event.payload` when it is a plain object, otherwise the event's own fields minus `type`. */
function extractPayload(event: InspectedEvent['event']): Record<string, unknown> {
  if (isPlainRecord(event.payload)) {
    return { ...event.payload };
  }
  return Object.fromEntries(Object.entries(event).filter(([key]) => key !== 'type'));
}

/**
 * Creates an XState v5 `inspect` observer that projects machine events, actor
 * lifecycles and errors to the dispatcher.
 *
 * It only observes the inspection stream; it never subscribes to actors, so XState's own
 * error reporting is unchanged (an unhandled root error still reaches global handlers).
 * - Events: every non-`xstate.*` event is sanitized and dispatched with the recipient's
 *   `actorId` and the `stateNode` it was received in.
 * - Errors: each erroring actor is reported once through `dispatchError`. An error that
 *   bubbles from a child up its parent chain (unhandled, or escalated by a parent that
 *   forwards the child's error event) is reported once, for the child; actors outside
 *   that chain that fail with the same error object are reported separately. An error
 *   event that an active actor sends is not that actor's failure.
 * - Spans: one span per actor that starts while the inspector is attached, from
 *   `xstate.init` until it is done, stopped or errors. Actors that never start, or that
 *   were already running when the inspector was attached through `actor.system.inspect()`,
 *   get no span; their events and errors are still reported.
 */
export function createTelemetryInspector(
  options: XStateInspectorOptions,
): (inspectionEvent: InspectionEventLike) => void {
  const { dispatcher, registry, strictSymbols = false } = options;
  const dpm = options.dpmAdapter ?? createDpmTelemetryAdapter();
  const actors = new WeakMap<ActorRefLike, ActorTelemetryState>();
  let identityTokenCache: { userId: string; token: string } | undefined;

  function reportFailure(error: unknown, inspectionEvent: InspectionEventLike): void {
    if (!options.onError) {
      rethrowAsync(error);
      return;
    }
    try {
      options.onError(error, inspectionEvent);
    } catch (handlerError) {
      rethrowAsync(handlerError);
    }
  }

  function guarded(inspectionEvent: InspectionEventLike, task: () => void): void {
    try {
      task();
    } catch (error) {
      reportFailure(error, inspectionEvent);
    }
  }

  function stateOf(actorRef: ActorRefLike): ActorTelemetryState {
    let state = actors.get(actorRef);
    if (!state) {
      state = {
        isRoot: false,
        spanStarted: false,
        errorReported: false,
        inheritedErrors: new Map(),
        rootCheckScheduled: false,
      };
      actors.set(actorRef, state);
    }
    return state;
  }

  function traceIdOf(actorRef: ActorRefLike): string {
    const state = stateOf(actorRef);
    state.traceId ??= generateTraceId();
    return state.traceId;
  }

  function identityUserToken(identity: TelemetryIdentity | null): string | undefined {
    if (!identity) return undefined;
    if (identity.pseudonymToken) return identity.pseudonymToken;
    if (!identity.userId) return undefined;
    // The raw identity never enters the context: it is tokenized like a `userId` payload key.
    if (identityTokenCache?.userId !== identity.userId) {
      identityTokenCache = { userId: identity.userId, token: dpm.tokenize(IDENTITY_NAMESPACE, identity.userId) };
    }
    return identityTokenCache.token;
  }

  function buildContext(actorRef: ActorRefLike, stateNode: string | undefined): TelemetryContext {
    const identity = getGlobalTelemetryIdentity();
    const defaults: TelemetryContext = {
      traceId: traceIdOf(actorRef),
      actorId: actorIdOf(actorRef),
      actorSessionId: actorRef.sessionId,
      stateNode,
      userId: identityUserToken(identity),
      tenantId: identity?.tenantId,
    };
    const context: TelemetryContext = { ...defaults };
    const callerContext = options.getContext ? options.getContext() : {};
    for (const [key, value] of Object.entries(callerContext)) {
      if (value !== undefined) Object.assign(context, { [key]: value });
    }
    if (!context.traceId) context.traceId = defaults.traceId;
    return context;
  }

  function openSpan(actorRef: ActorRefLike, state: ActorTelemetryState): void {
    if (state.spanStarted || !dispatcher.dispatchSpanStart) return;
    state.spanStarted = true;
    const actorId = actorIdOf(actorRef) ?? 'unknown';
    const attributes: Record<string, unknown> = { 'xstate.actor.id': actorId };
    if (actorRef.sessionId !== undefined) attributes['xstate.actor.session_id'] = actorRef.sessionId;
    const spanId = dispatcher.dispatchSpanStart(`xstate.actor:${actorId}`, attributes);
    if (typeof spanId === 'string' && spanId) {
      state.openSpanId = spanId;
    }
  }

  function endSpan(state: ActorTelemetryState, status: 'ok' | 'error', error?: unknown): void {
    const spanId = state.openSpanId;
    if (spanId === undefined) return;
    state.openSpanId = undefined;
    dispatcher.dispatchSpanEnd?.(spanId, status, error);
  }

  /**
   * True the first time an actor errors, unless the error is one this actor inherited from
   * a child (it bubbled up the parent chain and was reported where it originated). The
   * dedupe is scoped to that chain: unrelated actors failing with the same error object
   * (a cached rejected promise, a shared abort reason) are each reported.
   */
  function claimErrorReport(state: ActorTelemetryState, error: unknown): boolean {
    if (state.errorReported) return false;
    state.errorReported = true;
    const inherited = [...state.inheritedErrors.values()].some((childError) => Object.is(childError, error));
    // The actor is terminal now; its pending child errors no longer matter.
    state.inheritedErrors.clear();
    return !inherited;
  }

  function handleActorError(
    actorRef: ActorRefLike,
    error: unknown,
    inspectionEvent: InspectionEventLike,
    stateValue?: unknown,
  ): void {
    const state = stateOf(actorRef);
    guarded(inspectionEvent, () => {
      if (!claimErrorReport(state, error) || !dispatcher.dispatchError) return;
      const stateNode = resolveStateNodeSymbol(stateValue ?? snapshotOf(actorRef)?.value);
      dispatcher.dispatchError(error, buildContext(actorRef, stateNode), stateNode);
    });
    guarded(inspectionEvent, () => endSpan(state, 'error', error));
  }

  /**
   * A root actor's error during event processing emits no inspection event, and
   * subscribing an error listener would suppress XState's unhandled-error report. So
   * after every event a root receives, its snapshot is checked once the call returns.
   */
  function scheduleRootErrorCheck(actorRef: ActorRefLike, inspectionEvent: InspectionEventLike): void {
    const state = stateOf(actorRef);
    if (state.rootCheckScheduled || state.errorReported) return;
    state.rootCheckScheduled = true;
    scheduleMicrotask(() => {
      state.rootCheckScheduled = false;
      guarded(inspectionEvent, () => {
        const snapshot = snapshotOf(actorRef);
        if (snapshot?.status === 'error') {
          handleActorError(actorRef, snapshot.error, inspectionEvent, snapshot.value);
        }
      });
    });
  }

  /**
   * Whether the event's recipient is the root of its system. Every inspection event carries
   * the root's session id (`rootId`), so this does not depend on having seen the actor's
   * `xstate.init`: an inspector attached with `actor.system.inspect()` after `start()`
   * never sees it.
   */
  function isRootActor(actorRef: ActorRefLike, state: ActorTelemetryState, inspectionEvent: InspectedEvent): boolean {
    if (!state.isRoot && inspectionEvent.rootId !== undefined && inspectionEvent.rootId === actorRef.sessionId) {
      state.isRoot = true;
    }
    return state.isRoot;
  }

  function onActorStart(inspectionEvent: InspectedEvent): void {
    const { actorRef, sourceRef } = inspectionEvent;
    const state = stateOf(actorRef);
    state.isRoot = sourceRef === undefined;
    // Children join their parent's trace.
    if (sourceRef !== undefined) state.traceId ??= traceIdOf(sourceRef);
    openSpan(actorRef, state);
  }

  /**
   * True when the sender of an `xstate.error.actor.*` event failed with its error. XState
   * puts an actor's snapshot into `error` before relaying that error to the parent, so an
   * active sender is not failing: it is forwarding a child's error (an escalation such as
   * `sendParent(({ event }) => event)`) or sending an error event by hand.
   */
  function senderFailedWith(sourceRef: ActorRefLike, error: unknown): boolean {
    const snapshot = snapshotOf(sourceRef);
    return snapshot?.status === 'error' && Object.is(snapshot.error, error);
  }

  /** True while the sender is still processing a child error that carried `error`. */
  function senderIsEscalating(sourceRef: ActorRefLike, error: unknown): boolean {
    const pending = actors.get(sourceRef)?.inheritedErrors;
    return pending !== undefined && [...pending.values()].some((childError) => Object.is(childError, error));
  }

  function onChildError(inspectionEvent: InspectedEvent): void {
    const { actorRef, sourceRef, event } = inspectionEvent;
    if (sourceRef === undefined) return;
    if (senderFailedWith(sourceRef, event.error)) {
      handleActorError(sourceRef, event.error, inspectionEvent);
    } else if (!senderIsEscalating(sourceRef, event.error)) {
      // Nobody has failed with this error yet: if it fails the recipient, that is the
      // recipient's own error, reported for the recipient.
      return;
    }
    // Pending until the recipient's snapshot for this event: unhandled, it fails the recipient.
    stateOf(actorRef).inheritedErrors.set(event, event.error);
  }

  function lookupSymbol(eventType: string): SymbolDefinition | undefined {
    return registry && registry.has(eventType) ? registry.get(eventType) : undefined;
  }

  function dispatchEvent(inspectionEvent: InspectedEvent): void {
    const { actorRef, event } = inspectionEvent;
    const eventType = event.type;
    const symbolDef = lookupSymbol(eventType);
    const isSymbol = isValidTrackSymbol(eventType);

    if (strictSymbols && !isSymbol && !symbolDef) {
      reportFailure(
        new Error(`[Telemetry] Event type "${eventType}" is not a valid tracking symbol or registered symbol.`),
        inspectionEvent,
      );
      return;
    }

    const domain = isSymbol ? parseTrackSymbol(eventType).domain : 'GLOBAL';
    // DPM 살균 및 가명화/마스킹 처리
    const sanitizedPayload = dpm.sanitize(extractPayload(event), symbolDef?.piiLevel, domain);
    if (sanitizedPayload === null) {
      // PII restricted 레벨로 인해 전체 드롭
      return;
    }

    // The recipient has not processed the event yet: this is the state it arrived in.
    const stateNode = resolveStateNodeSymbol(snapshotOf(actorRef)?.value);
    const envelope = createTelemetryEnvelope({
      symbol: eventType,
      payload: sanitizedPayload,
      context: buildContext(actorRef, stateNode),
    });
    dispatcher.dispatch(envelope, symbolDef);
  }

  function onEvent(inspectionEvent: InspectedEvent): void {
    const { actorRef, event } = inspectionEvent;
    const eventType = event.type;

    if (eventType === XSTATE_INIT) {
      guarded(inspectionEvent, () => onActorStart(inspectionEvent));
    } else if (eventType.startsWith(XSTATE_ERROR_ACTOR_PREFIX)) {
      guarded(inspectionEvent, () => onChildError(inspectionEvent));
    }

    if (isRootActor(actorRef, stateOf(actorRef), inspectionEvent)) {
      scheduleRootErrorCheck(actorRef, inspectionEvent);
    }

    // XState 내부 이벤트는 디스패치하지 않음
    if (eventType.startsWith('xstate.')) return;
    dispatchEvent(inspectionEvent);
  }

  function onSnapshot(inspectionEvent: InspectedSnapshot): void {
    const { actorRef, snapshot, event } = inspectionEvent;
    const state = stateOf(actorRef);

    if (snapshot.status === 'error') {
      handleActorError(actorRef, snapshot.error, inspectionEvent, snapshot.value);
    } else if (snapshot.status === 'done' || snapshot.status === 'stopped' || event.type === XSTATE_STOP) {
      state.inheritedErrors.clear();
      guarded(inspectionEvent, () => endSpan(state, 'ok'));
    }
    // This snapshot is the result of processing `event`: a child error it carried was
    // either handled (onError) or has just been checked against this actor's error.
    state.inheritedErrors.delete(event);
  }

  return (inspectionEvent: InspectionEventLike): void => {
    try {
      switch (inspectionEvent.type) {
        case '@xstate.event':
          onEvent(inspectionEvent);
          break;
        case '@xstate.snapshot':
          onSnapshot(inspectionEvent);
          break;
        default:
          // '@xstate.actor', '@xstate.transition', '@xstate.microstep', '@xstate.action'
          break;
      }
    } catch (error) {
      reportFailure(error, inspectionEvent);
    }
  };
}
