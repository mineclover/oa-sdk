/**
 * @oa-sdk/popup-bridge — protocol, contract conventions and RPC generation utilities shared by both
 * sides of a popup bridge. Host code lives in `@oa-sdk/popup-bridge/host`, popup code in
 * `@oa-sdk/popup-bridge/popup`, in-memory test doubles in `@oa-sdk/popup-bridge/testing`.
 */

export {
  BridgeError,
  fromWireError,
  isBridgeError,
  toBridgeError,
} from './protocol/errors.js'
export type { BridgeErrorCode, BridgeErrorOptions, WireError } from './protocol/errors.js'

export { PROTOCOL_VERSION, compareVersions, negotiateProtocol, parseVersion, satisfies } from './protocol/version.js'

export {
  DEFAULT_FEATURES,
  FEATURE_EVENTS_COALESCE,
  FEATURE_EVENTS_REPLAY,
  MAX_FEATURES,
  NO_FEATURES,
  assertFeatureIds,
  createFeatureSet,
  isFeatureId,
  negotiateFeatures,
  normalizeFeatures,
} from './protocol/features.js'
export type { FeatureSet } from './protocol/features.js'

export { REPLAY_METHOD } from './events/replay.js'
export type { ReplayEntry } from './events/replay.js'
export type { CoalescePolicy, CoalesceReducer, ErasedCoalescePolicy } from './events/coalesce.js'

export { backoffDelay, createBackoff, resolveBackoff } from './backoff.js'
export type { Backoff, BackoffOptions, ResolvedBackoff, RetryEvent, RetryPhase, RetryTarget } from './backoff.js'

export { SESSION_PARAM, attachSession, createId, isBridgeMessage, parseBridgeMessage, readSession } from './protocol/messages.js'
export type {
  BridgeMessage,
  Capability,
  CloseMessage,
  CloseReason,
  ConnectMessage,
  HelloMessage,
  InitFailedMessage,
  ReadyMessage,
  RejectMessage,
} from './protocol/messages.js'

export type { SecurityEvent, SecurityListener } from './protocol/security.js'

export { runSchema } from './contract/schema.js'
export type { Schema, SchemaLike, ValidationIssue } from './contract/schema.js'

export { RESERVED_PREFIX, assertName, defineContract, event, method } from './contract/define.js'
export type {
  AnyContract,
  AnyEventSpec,
  AnyMethodSpec,
  BridgeContract,
  CallArgs,
  CallOptions,
  ContractInput,
  EventMap,
  EventName,
  EventOptions,
  EventSpec,
  HandlerContext,
  HandlerResult,
  Handlers,
  InitOf,
  InputOf,
  MethodCaller,
  MethodHandler,
  MethodMap,
  MethodName,
  MethodOptions,
  MethodSpec,
  OutputOf,
  ParamsShape,
  PayloadOf,
  RpcApi,
} from './contract/define.js'

export { definePopup } from './contract/definition.js'
export type { CapabilityRequirement, DefinePopupOptions, PopupDefinition } from './contract/definition.js'

export { HandlerRegistry } from './contract/registry.js'
export type { FeatureRegistration } from './contract/registry.js'

export { createMethodCaller, createRpcApi, describeContract } from './contract/client.js'
export type { ContractManifest, MethodCallerOptions, RpcInvoke } from './contract/client.js'

export { createMemoryChannelPair, fromMessagePort } from './rpc/channel.js'
export type { RpcChannel } from './rpc/channel.js'

export { CANCEL_METHOD, createRpcEndpoint } from './rpc/endpoint.js'
export type { EndpointLimits, GuardInfo, LimitEvent, RpcEndpoint, RpcEndpointOptions, RpcId, RpcRegistration } from './rpc/endpoint.js'

export { isDataCloneError, isTransferred, withTransfer } from './rpc/transfer.js'
export type { Transferred } from './rpc/transfer.js'

export { IdempotencyStore } from './rpc/idempotency.js'

export { browserHostEnvironment, browserPopupEnvironment, systemClock } from './env.js'
export type { Clock, HostEnvironment, IncomingWindowMessage, OpenWindowOptions, PeerHandle, PopupEnvironment } from './env.js'

export { createAttentionManager } from './attention/manager.js'
export type { AttentionManager, AttentionOptions, AttentionSource } from './attention/manager.js'
export { browserAttentionSurface } from './attention/surface.js'
export type { AttentionSurface } from './attention/surface.js'
export { ATTENTION_ACK_METHOD, ATTENTION_METHOD, parseAttentionRequest } from './attention/types.js'
export type {
  AttentionEffect,
  AttentionIntent,
  AttentionRequest,
  AttentionResult,
  AttentionSkipReason,
  AttentionUrgency,
  AttentionVisibility,
  AttentionWireRequest,
} from './attention/types.js'

export { TOPOLOGY_METHOD, createBridgeNode } from './node/node.js'
export type {
  BridgeNode,
  BridgeNodeOptions,
  NodeSnapshot,
  TopologyLink,
  TopologyNode,
  TraceEvent,
} from './node/node.js'
export type {
  AttentionRequestOptions,
  AttentionWaitOptions,
  LinkRole,
  PeerAttention,
  PeerLink,
} from './node/link.js'

export type { RpcTrace } from './rpc/endpoint.js'

export { defineSharedState } from './state/shared.js'
export type {
  OwnedState,
  OwnedStateOptions,
  ReplicaState,
  ReplicaStatus,
  SharedStateDefinition,
  SharedStateInput,
  SharedStates,
  StateChange,
  StateSnapshot,
} from './state/shared.js'
