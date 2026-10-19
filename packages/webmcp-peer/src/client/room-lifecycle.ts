import { parseInvitationUrl } from "../config/invitation.js";
import { isJsonObject, JsonObjectSchema, parseJsonObject, readResponseText } from "../config/json.js";
import { hashTools, normalizeTools } from "./catalog-hash.js";
import { PeerMcpError } from "./errors.js";
import { PeerClientTicketSchema, PeerSessionStatusSchema } from "./schemas.js";
import { PeerMcpSession } from "./session.js";
import {
  asCatalogVersion,
  asNonEmptyString,
  normalizeServerUrl,
  parseRoomId,
  websocketUrl,
} from "./transport.js";
import {
  DEFAULT_TIMEOUT_MS,
  PACKAGE_VERSION,
  PROTOCOL_VERSION,
  type DiscoveredPeerCatalog,
  type DiscoverPeerCatalogOptions,
  type JoinedPeerRoom,
  type JoinPeerRoomOptions,
  type PeerClientTicket,
  type PeerSessionStatusOptions,
  type RotatePeerRoomOptions,
  type WaitForPeerApprovalOptions,
} from "./types.js";

export async function discoverPeerCatalog(
  options: DiscoverPeerCatalogOptions = {},
): Promise<DiscoveredPeerCatalog> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new PeerMcpError("fetch is unavailable; provide fetchImpl", "TRANSPORT_UNAVAILABLE");
  }
  const parsedInvite = options.invitationUrl ? parseInvitationUrl(options.invitationUrl) : null;
  const serverUrl = normalizeServerUrl(options.serverUrl ?? parsedInvite?.serverUrl);
  const roomId = parseRoomId(options.roomId ?? parsedInvite?.roomId);
  const endpoint =
    asNonEmptyString(options.mcpEndpoint) ||
    parsedInvite?.mcpEndpoint ||
    (roomId ? `${serverUrl}/p/${encodeURIComponent(roomId)}/mcp` : `${serverUrl}/mcp/catalog`);

  if (endpoint.endsWith("/mcp/catalog")) {
    const response = await fetchImpl(endpoint, {
      method: "GET",
      headers: {
        accept: "application/json",
        "user-agent": `framebook-peer-mcp-client/${PACKAGE_VERSION}`,
      },
    });
    const body = parseJsonObject(await readResponseText(response));
    if (!response.ok) {
      const errStr = typeof body.error === "string" ? body.error : undefined;
      throw new PeerMcpError(
        errStr || `HTTP ${response.status}: catalog discovery failed`,
        errStr || `HTTP_${response.status}`,
        body,
      );
    }
    const tools = normalizeTools({ result: { tools: body.tools } });
    return {
      protocolVersion: (typeof body.protocol === "string" ? body.protocol : undefined) || PROTOCOL_VERSION,
      tools,
      catalogVersion: asCatalogVersion(body.catalogVersion) ?? 1,
      catalogHash: asNonEmptyString(body.catalogHash) || hashTools(tools),
      _meta: body,
    };
  }

  // The session builds its own Streamable HTTP transport so the transport's `ready` frame and
  // every response reach the session's callbacks; the client ticket rides as a bearer token.
  const session = new PeerMcpSession({
    mcpEndpoint: endpoint,
    clientToken: options.clientToken,
    fetchImpl,
    protocolVersion: options.protocolVersion ?? PROTOCOL_VERSION,
    requestTimeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });
  try {
    const initResult = await session.initialize();
    const tools = await session.listTools();
    const snapshot = session.getCatalogSnapshot();
    return {
      serverInfo: isJsonObject(initResult.serverInfo) ? initResult.serverInfo : undefined,
      protocolVersion: typeof initResult.protocolVersion === "string" ? initResult.protocolVersion : PROTOCOL_VERSION,
      tools,
      catalogVersion: snapshot.catalogVersion,
      catalogHash: snapshot.catalogHash,
      _meta: isJsonObject(initResult._meta) ? initResult._meta : undefined,
    };
  } finally {
    await session.disconnect();
  }
}

export async function joinPeerRoom(options: JoinPeerRoomOptions = {}): Promise<JoinedPeerRoom> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new PeerMcpError("fetch is unavailable; provide fetchImpl", "TRANSPORT_UNAVAILABLE");
  }
  const parsedInvite = options.invitationUrl ? parseInvitationUrl(options.invitationUrl) : null;
  const serverUrl = normalizeServerUrl(options.serverUrl ?? parsedInvite?.serverUrl);
  const roomId = parseRoomId(options.roomId ?? parsedInvite?.roomId);
  const inviteToken = asNonEmptyString(options.inviteToken) ?? parsedInvite?.inviteToken;
  if (!roomId) throw new PeerMcpError("A roomId or invitationUrl is required to join a peer room", "ROOM_ID_REQUIRED");
  if (!inviteToken) {
    throw new PeerMcpError("An inviteToken or invitationUrl is required to join a peer room", "INVITE_TOKEN_REQUIRED");
  }

  const capabilities =
    Array.isArray(options.capabilities) && options.capabilities.length > 0
      ? options.capabilities
      : ["mcp-control"];
  const response = await fetchImpl(`${serverUrl}/p/${encodeURIComponent(roomId)}/join`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "user-agent": `framebook-peer-mcp-client/${PACKAGE_VERSION}`,
    },
    body: JSON.stringify({
      inviteToken,
      clientLabel: asNonEmptyString(options.clientLabel) || "MCP client",
      capabilities,
    }),
  });
  const text = await readResponseText(response);
  if (!response.ok) {
    const body = parseJsonObject(text);
    const errStr = typeof body.error === "string" ? body.error : undefined;
    throw new PeerMcpError(
      errStr || `HTTP ${response.status}: peer room join failed`,
      errStr || `HTTP_${response.status}`,
      body,
    );
  }
  let ticket: PeerClientTicket;
  try {
    ticket = PeerClientTicketSchema.parse(JSON.parse(text));
  } catch (error) {
    throw new PeerMcpError(
      `Peer room join returned an invalid client ticket: ${error instanceof Error ? error.message : String(error)}`,
      "INVALID_JOIN_RESPONSE",
      parseJsonObject(text),
    );
  }
  return {
    ...ticket,
    serverUrl,
    wsUrl: websocketUrl(serverUrl, roomId),
    mcpEndpoint: `${serverUrl}/p/${encodeURIComponent(roomId)}/mcp`,
  };
}

/**
 * Reads a successful relay response as a JSON object, and turns a failed one into a PeerMcpError
 * carrying the relay's `error` code when it sent one.
 */
async function readRelayObject(response: Response, failure: string, invalidCode: string): Promise<Record<string, unknown>> {
  const text = await readResponseText(response);
  if (!response.ok) {
    const body = parseJsonObject(text);
    const errStr = typeof body.error === "string" ? body.error : undefined;
    throw new PeerMcpError(errStr || `HTTP ${response.status}: ${failure}`, errStr || `HTTP_${response.status}`, body);
  }
  try {
    return JsonObjectSchema.parse(JSON.parse(text));
  } catch {
    throw new PeerMcpError(`Peer relay returned an invalid response: ${failure}`, invalidCode);
  }
}

export async function getPeerSessionStatus(
  options: PeerSessionStatusOptions = {},
): Promise<Record<string, unknown>> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new PeerMcpError("fetch is unavailable; provide fetchImpl", "TRANSPORT_UNAVAILABLE");
  }
  const serverUrl = normalizeServerUrl(options.serverUrl);
  const roomId = parseRoomId(options.roomId);
  const sessionId = asNonEmptyString(options.sessionId);
  const clientToken = asNonEmptyString(options.clientToken);
  if (!roomId) throw new PeerMcpError("roomId is required", "ROOM_ID_REQUIRED");
  if (!sessionId) throw new PeerMcpError("sessionId is required", "SESSION_REQUIRED");
  if (!clientToken) throw new PeerMcpError("clientToken is required", "CLIENT_TOKEN_REQUIRED");

  const response = await fetchImpl(
    `${serverUrl}/p/${encodeURIComponent(roomId)}/sessions/${encodeURIComponent(sessionId)}`,
    {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${clientToken}`,
        "user-agent": `framebook-peer-mcp-client/${PACKAGE_VERSION}`,
      },
    },
  );
  const body = await readRelayObject(response, "failed to read peer session status", "INVALID_SESSION_STATUS");
  try {
    return PeerSessionStatusSchema.parse(body);
  } catch (error) {
    throw new PeerMcpError(
      `Peer session status is invalid: ${error instanceof Error ? error.message : String(error)}`,
      "INVALID_SESSION_STATUS",
      body,
    );
  }
}

export async function waitForPeerApproval(
  options: WaitForPeerApprovalOptions = {},
): Promise<Record<string, unknown>> {
  const pollIntervalMs = Math.max(25, options.pollIntervalMs ?? 250);
  const timeoutMs = Math.max(pollIntervalMs, options.timeoutMs ?? 30_000);
  const deadline = Date.now() + timeoutMs;

  while (true) {
    if (options.signal?.aborted) {
      throw new PeerMcpError("Waiting for peer approval was aborted", "APPROVAL_ABORTED");
    }
    const status = await getPeerSessionStatus(options);
    if (status.state === "approved") {
      return status;
    }
    if (status.state === "rejected") {
      throw new PeerMcpError("Peer approval request was rejected", "CLIENT_APPROVAL_DENIED", status);
    }
    if (status.state === "revoked") {
      throw new PeerMcpError("Peer session was revoked", "SESSION_REVOKED", status);
    }
    if (status.state === "expired") {
      throw new PeerMcpError("Peer session expired", "APPROVAL_EXPIRED", status);
    }
    if (status.state === "room-rotated") {
      throw new PeerMcpError("Peer room was rotated", "ROOM_ROTATED", status);
    }
    if (Date.now() >= deadline) {
      throw new PeerMcpError("Timed out waiting for peer approval", "APPROVAL_TIMEOUT", status);
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

export async function rotatePeerRoom(
  options: RotatePeerRoomOptions = {},
): Promise<Record<string, unknown>> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new PeerMcpError("fetch is unavailable; provide fetchImpl", "TRANSPORT_UNAVAILABLE");
  }
  const serverUrl = normalizeServerUrl(options.serverUrl);
  const roomId = parseRoomId(options.roomId);
  const providerToken = asNonEmptyString(options.providerToken);
  if (!roomId) throw new PeerMcpError("roomId is required to rotate a peer room", "ROOM_ID_REQUIRED");
  if (!providerToken) {
    throw new PeerMcpError("providerToken is required to rotate a peer room", "PROVIDER_TOKEN_REQUIRED");
  }

  const response = await fetchImpl(`${serverUrl}/p/${encodeURIComponent(roomId)}/rotate`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      authorization: `Bearer ${providerToken}`,
      "user-agent": `framebook-peer-mcp-client/${PACKAGE_VERSION}`,
    },
    body: JSON.stringify({
      roomId,
      ...(Number.isSafeInteger(options.roomEpoch) ? { roomEpoch: options.roomEpoch } : {}),
      ...(asNonEmptyString(options.alias) ? { alias: asNonEmptyString(options.alias) } : {}),
      requestedAt: new Date().toISOString(),
    }),
  });
  return readRelayObject(response, "peer room rotate failed", "INVALID_ROTATE_RESPONSE");
}
