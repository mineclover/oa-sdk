export {
  DEFAULT_SERVER_URL,
  PROTOCOL_VERSION,
  type PeerMcpTransportMessage,
  type PeerMcpRpcResponse,
  type PeerMcpContentBlock,
  type PeerMcpCallToolResult,
  type PeerMcpCatalogCache,
  type PeerMcpTool,
  type PeerMcpSessionState,
  type PeerMcpCatalogSnapshot,
  type PeerMcpSessionInfo,
  type PeerMcpStore,
  type PeerMcpTransportCallbacks,
  type PeerMcpTransportClose,
  type PeerMcpTransport,
  type PeerMcpSessionOptions,
  type PeerMcpServiceSessionOptions,
  type PeerMcpRequestOptions,
  type PeerMcpCallOptions,
  type PeerMcpListener,
  type PeerMcpCatalogListener,
  type DiscoverPeerCatalogOptions,
  type DiscoveredPeerCatalog,
  type JoinPeerRoomOptions,
  type PeerClientTicket,
  type JoinedPeerRoom,
  type PeerSessionStatusOptions,
  type WaitForPeerApprovalOptions,
  type RotatePeerRoomOptions,
} from "./client/types.js";

export {
  PeerMcpError,
  PeerMcpRpcError,
  PeerMcpCatalogChangedError,
  canonicalRpcErrorCode,
  isCatalogChangedRpcError,
} from "./client/errors.js";

export {
  hashTools,
  normalizeTools,
} from "./client/catalog-hash.js";

export {
  normalizeServerUrl,
  websocketUrl,
  parseRoomId,
} from "./client/transport.js";

export {
  PeerMcpSession,
  createPeerMcpSession,
} from "./client/session.js";

export {
  PeerMcpService,
  JsonPeerMcpStore,
  createJsonPeerMcpStore,
  createPeerMcpService,
} from "./client/service.js";

export {
  discoverPeerCatalog,
  joinPeerRoom,
  getPeerSessionStatus,
  waitForPeerApproval,
  rotatePeerRoom,
} from "./client/room-lifecycle.js";

export {
  normalizePeerUrl,
  normalizePeerConfigUrl,
  isLocalPeerUrl,
  externalConsentKey,
  parseInvitationUrl,
  buildInvitationUrl,
  createPeerConfigProfile,
  stringifyPeerConfigProfile,
  parsePeerConfig,
  probePeerHealth,
  fetchPeerServerConfig,
  type CreatePeerConfigProfileOptions,
  type ParsedPeerConfig,
  type ParsePeerConfigResult,
  type PeerServerPublicConfig,
} from "./config.js";
