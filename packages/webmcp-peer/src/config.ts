export {
  WEBMCP_SUBPROTOCOL,
  WEBMCP_PEER_CONFIG_TYPE,
  DEFAULT_EXTERNAL_CONSENT_PREFIX,
  type WebMcpPeerConfigProfile,
  type CreatePeerConfigProfileOptions,
  type WebMcpParsedInvitationUrl,
  type ParsedPeerConfig,
  type ParsePeerConfigResult,
  type PeerServerPublicConfig,
  type PeerHealthState,
  type PeerHealthResult,
  type PeerHealthMessages,
  type PeerHealthProbeOptions,
} from "./config/types.js";

export {
  normalizePeerUrl,
  normalizePeerConfigUrl,
  isLocalPeerUrl,
  isSecurePeerTransport,
  redactInvitationUrl,
  externalConsentKey,
  parseInvitationUrl,
  buildInvitationUrl,
} from "./config/invitation.js";

export {
  createPeerConfigProfile,
  stringifyPeerConfigProfile,
  parsePeerConfig,
} from "./config/profile.js";

export {
  probePeerHealth,
  fetchPeerServerConfig,
} from "./config/probe.js";

export {
  PEER_RELAY_MAX_MESSAGE_BYTES,
  PEER_RELAY_MAX_REQUEST_BYTES,
  PEER_RELAY_MAX_CATALOG_BYTES,
  PEER_RELAY_MAX_ANNOUNCEMENT_BYTES,
} from "./config/limits.js";
