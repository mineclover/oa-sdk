import { readdir, readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import {
  createPeerConfigProfile,
  isLocalPeerUrl,
  isSecurePeerTransport,
  parseInvitationUrl,
  redactInvitationUrl,
} from "../src/config.js";
import { createWebMcpPeerServer, type WebMcpPeerServer } from "../src/server.js";

const DEMO_ASSET_DIR = new URL("./live-demo/", import.meta.url);

const ASSET_CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

type DemoAssets = ReadonlyMap<string, { file: string; contentType: string }>;

/**
 * Builds the exact-match route table of the browser demo from its asset directory. Requests are
 * looked up by full pathname, so nothing outside this table (e.g. `..` traversal) can be served.
 */
async function loadDemoAssets(): Promise<DemoAssets> {
  const routes = new Map<string, { file: string; contentType: string }>();
  for (const file of (await readdir(DEMO_ASSET_DIR)).sort()) {
    const contentType = ASSET_CONTENT_TYPES[file.slice(file.lastIndexOf("."))];
    if (!contentType || !/^[a-z0-9-]+\.[a-z]+$/.test(file)) continue;
    routes.set(`/demo/${file}`, { file, contentType });
  }
  const index = routes.get("/demo/index.html");
  if (!index) throw new Error("live-demo/index.html is missing");
  routes.set("/", index);
  routes.set("/demo", index);
  return routes;
}

/** Sample endpoints shown in the transport posture table next to the live origin. */
const TRANSPORT_SAMPLES = ["https://peer.example.com", "http://peer.example.com"] as const;

const MAX_POSTURE_BODY_BYTES = 16_384;

interface PostureRequest {
  serverUrl?: unknown;
  invitationUrl?: unknown;
  alias?: unknown;
  roomEpoch?: unknown;
  defaults?: unknown;
}

async function readJson(req: IncomingMessage): Promise<PostureRequest> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_POSTURE_BODY_BYTES) throw new Error("BODY_TOO_LARGE");
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? (JSON.parse(text) as PostureRequest) : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * Evaluates the Config & Security tier with the real `@oa-sdk/webmcp-peer/config` functions,
 * so the page shows exactly what the library decides (transport, redaction, profile sanitizing).
 */
function evaluatePosture(input: PostureRequest) {
  const serverUrl = asString(input.serverUrl);
  const invitationUrl = asString(input.invitationUrl);
  const parsed = invitationUrl ? parseInvitationUrl(invitationUrl) : null;
  const requestedDefaults = asRecord(input.defaults);
  const profile = createPeerConfigProfile({
    serverUrl: parsed?.serverUrl ?? serverUrl,
    alias: asString(input.alias) || undefined,
    // The invite token is deliberately not forwarded: a shareable profile must stay secret-free.
    roomId: parsed?.roomId,
    roomEpoch: typeof input.roomEpoch === "number" ? input.roomEpoch : undefined,
    defaults: requestedDefaults,
  });
  const strippedKeys = Object.keys(requestedDefaults).filter((key) => !(key in profile.defaults));
  return {
    transports: [serverUrl, ...TRANSPORT_SAMPLES].filter(Boolean).map((url) => ({
      url,
      local: isLocalPeerUrl(url),
      secure: isSecurePeerTransport(url),
    })),
    invitation: parsed
      ? {
          redactedUrl: redactInvitationUrl(invitationUrl),
          roomId: parsed.roomId,
          mcpEndpoint: parsed.mcpEndpoint,
        }
      : null,
    profile,
    strippedKeys,
  };
}

async function serveAsset(assets: DemoAssets, res: ServerResponse, pathname: string): Promise<boolean> {
  const asset = assets.get(pathname);
  if (!asset) return false;
  const body = await readFile(new URL(asset.file, DEMO_ASSET_DIR));
  res.writeHead(200, { "Content-Type": asset.contentType, "Cache-Control": "no-store" });
  res.end(body);
  return true;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

export interface LiveDemoServer {
  server: WebMcpPeerServer;
  port: number;
  url: string;
  close(): Promise<void>;
}

/** Starts the relay server with the demo page and the Config & Security posture endpoint. */
export async function startLiveDemoServer(options: { port?: number; host?: string } = {}): Promise<LiveDemoServer> {
  const host = options.host ?? "127.0.0.1";
  const assets = await loadDemoAssets();
  const server = createWebMcpPeerServer({
    port: options.port ?? 8788,
    host,
    roomSweepIntervalMs: 0,
    // Manual approval in the browser can take a while; keep pending approvals alive for 2 minutes.
    mcpRequestTimeoutMs: 120_000,
    serverName: "webmcp-live-demo",
    serverVersion: "0.1.0",
    deploymentCatalog: {
      tools: [
        {
          name: "scene_list",
          description: "현재 캔버스의 모든 장면 노드와 테마 상태를 조회합니다",
          inputSchema: { type: "object", properties: {} },
        },
      ],
    },
    customHttpHandler: async (req, res, url) => {
      if (req.method === "GET" && (await serveAsset(assets, res, url.pathname))) return true;
      if (req.method === "POST" && url.pathname === "/demo/api/posture") {
        try {
          sendJson(res, 200, evaluatePosture(await readJson(req)));
        } catch (error) {
          sendJson(res, 400, { error: error instanceof Error ? error.message : "INVALID_JSON_BODY" });
        }
        return true;
      }
      return false;
    },
  });
  const port = await server.listen();
  return { server, port, url: `http://${host}:${port}`, close: () => server.close() };
}

async function main(): Promise<void> {
  const { url } = await startLiveDemoServer({ port: Number(process.env.PORT ?? 8788) });
  console.log("============================================================");
  console.log(" @oa-sdk/webmcp-peer — Real-Time Dynamic MCP Demo Server");
  console.log("============================================================");
  console.log(` Live Demo Page : ${url}/demo`);
  console.log(` Health Check   : ${url}/health`);
  console.log("============================================================");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error("Failed to start WebMCP live demo server:", err);
    process.exit(1);
  });
}
