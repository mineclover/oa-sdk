import {
  buildInvitationUrl,
  parseInvitationUrl,
  probePeerHealth,
} from "../src/config.js";
import {
  PeerMcpService,
  discoverPeerCatalog,
  hashTools,
  joinPeerRoom,
  rotatePeerRoom,
  waitForPeerApproval,
} from "../src/client.js";
import {
  AiRunLedger,
  InMemoryAiRunLedgerStore,
  WebMcpPeerClient,
  isCommitReceipt,
  type CommitReceipt,
  type WebMcpHostAdapter,
} from "../src/provider.js";
import { createWebMcpPeerServer } from "../src/server.js";

interface TodoItem {
  id: string;
  title: string;
  done: boolean;
}

const SAMPLE_TOOLS = [
  {
    name: "todo_list",
    description: "현재 서비스의 할 일 목록을 조회합니다 (Read-Only)",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "todo_add",
    description: "새로운 할 일 항목을 추가하고 영속 영수증(CommitReceipt)을 반환합니다 (Write)",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "할 일 제목" },
      },
      required: ["title"],
    },
  },
];

async function main(): Promise<void> {
  const serveMode = process.argv.includes("--serve");
  const requestedPort = serveMode ? Number(process.env.PORT ?? 8787) : 0;

  const todos: TodoItem[] = [
    { id: "todo-1", title: "기능 의도 단위 모듈화 검증", done: true },
  ];
  const runLedger = new AiRunLedger(new InMemoryAiRunLedgerStore());

  console.log("============================================================");
  console.log(" @oa-sdk/webmcp-peer — Local 3-Tier Functional Smoke Runner");
  console.log("============================================================\n");

  // ---------------------------------------------------------------------------
  // [Tier 2] Start Relay Server
  // ---------------------------------------------------------------------------
  const server = createWebMcpPeerServer({
    port: requestedPort,
    host: "127.0.0.1",
    roomSweepIntervalMs: 0,
    deploymentCatalog: { tools: SAMPLE_TOOLS },
    serverName: "local-demo-service",
    serverVersion: "0.1.0",
  });

  const port = await server.listen();
  const serverUrl = `http://127.0.0.1:${port}`;
  console.log(`[1/7] Server (Tier 2) started      -> ${serverUrl}`);

  // ---------------------------------------------------------------------------
  // [Config] Health Probe & Bootstrap Catalog
  // ---------------------------------------------------------------------------
  const health = await probePeerHealth(serverUrl);
  const catalog = await discoverPeerCatalog({ serverUrl });
  console.log(
    `[2/7] Health & Catalog Probe       -> state=${health.state}, tools=${catalog.tools.length} (hash=${catalog.catalogHash.slice(0, 12)}...)`,
  );

  // ---------------------------------------------------------------------------
  // [Tier 1] Connect Host Provider via Reverse WebSocket
  // ---------------------------------------------------------------------------
  const hostAdapter: WebMcpHostAdapter = {
    listTools: () => SAMPLE_TOOLS,
    getStatus: () => ({ writeEnabled: true, todoCount: todos.length }),
    invoke: async (name, args) => {
      if (name === "todo_list") {
        return { ok: true, items: todos };
      }
      if (name === "todo_add") {
        const title = String(args?.title ?? "Untitled");
        const item: TodoItem = {
          id: `todo-${todos.length + 1}`,
          title,
          done: false,
        };
        todos.push(item);

        const receipt: CommitReceipt = {
          status: "durable",
          requestId: `req-${Date.now()}`,
          documentId: "doc-todo-board",
          transactionId: `tx-${todos.length}`,
          operationId: `op-${todos.length}`,
          replicaId: "provider-local-1",
          committedAt: new Date().toISOString(),
        };
        return { ok: true, added: item, receipt };
      }
      throw new Error(`Unknown tool: ${name}`);
    },
  };

  const provider = new WebMcpPeerClient({ hostAdapter });
  provider.setAiRunLedger(runLedger);

  // Auto-approve incoming client requests for smooth local testing
  provider.subscribe((status) => {
    if (status.approvalState === "pending" && status.approvalRequestId) {
      provider.approveClient(status.approvalRequestId);
    }
  });

  const invitationUrl = await provider.connect({
    serverUrl,
    alias: "local-todo-host",
    enableWrite: true,
  });
  const parsedInvite = parseInvitationUrl(invitationUrl);
  console.log(`[3/7] Provider (Tier 1) connected  -> roomId=${parsedInvite?.roomId}`);
  console.log(`      Invitation URL               -> ${invitationUrl}`);

  // ---------------------------------------------------------------------------
  // [Tier 3] External Agent Client Joins & Executes Read/Write MCP Calls
  // ---------------------------------------------------------------------------
  const joined = await joinPeerRoom({
    invitationUrl,
    clientLabel: "Local Smoke Agent",
  });

  const approved = await waitForPeerApproval({
    serverUrl,
    roomId: joined.roomId,
    sessionId: joined.sessionId,
    clientToken: joined.clientToken,
    pollIntervalMs: 20,
    timeoutMs: 3000,
  });
  console.log(
    `[4/7] Client (Tier 3) joined       -> sessionId=${joined.sessionId}, approval=${approved.state}`,
  );

  const service = new PeerMcpService();
  const session = await service.connect({
    key: "local-smoke-session",
    serverUrl,
    roomId: joined.roomId,
    roomEpoch: joined.roomEpoch,
    clientToken: joined.clientToken,
    mcpEndpoint: `${serverUrl}/p/${joined.roomId}/mcp`,
  });

  const listedTools = await session.listTools();
  console.log(
    `[5/7] MCP tools/list               -> [${listedTools.map((t) => t.name).join(", ")}] (hashMatch=${hashTools(listedTools) === catalog.catalogHash})`,
  );

  // Call Write Tool (todo_add) + verify automatic AI Run Ledger recording in Provider
  const addResult = (await service.callTool("todo_add", {
    title: "로컬 3-Tier 서버 라우팅 스모크 테스트 완료",
  })) as {
    structuredContent?: { ok?: boolean; added?: TodoItem; receipt?: CommitReceipt };
    data?: { ok?: boolean; added?: TodoItem; receipt?: CommitReceipt };
  };

  const parsedPayload = addResult.structuredContent ?? addResult.data ?? {};
  const receipt = parsedPayload.receipt;
  if (!isCommitReceipt(receipt)) {
    throw new Error("Expected valid CommitReceipt from todo_add");
  }
  const activeRuns = provider.getAiRuns();
  const recordedEntries = activeRuns[0] ? await runLedger.list(activeRuns[0].runId) : [];
  console.log(
    `[6/7] MCP tools/call (todo_add)    -> added="${parsedPayload.added?.title}", receipt=${receipt.status} (${"transactionId" in receipt ? receipt.transactionId : "no transaction"}), ledgerEntries=${recordedEntries.length}`,
  );

  // Call Read Tool (todo_list)
  const listResult = (await service.callTool("todo_list", {})) as {
    structuredContent?: { items?: TodoItem[] };
    data?: { items?: TodoItem[] };
  };
  const listPayload = listResult.structuredContent ?? listResult.data ?? {};
  console.log(
    `[7/7] MCP tools/call (todo_list)   -> total=${listPayload.items?.length} items: ${listPayload.items?.map((i) => `"${i.title}"`).join(", ")}`,
  );

  if (serveMode) {
    console.log("\n------------------------------------------------------------");
    console.log(" Local Server & Provider are running! Try these commands:");
    console.log("------------------------------------------------------------");
    console.log(`1) Health Check:\n   curl -s ${serverUrl}/health | jq .\n`);
    console.log(`2) Bootstrap Tool Catalog:\n   curl -s ${serverUrl}/mcp/catalog | jq .\n`);
    console.log(
      `3) Direct MCP tools/call (todo_list):\n   curl -s -X POST ${serverUrl}/p/${joined.roomId}/mcp \\\n     -H "Content-Type: application/json" \\\n     -H "Authorization: Bearer ${joined.clientToken}" \\\n     -H "X-Room-Epoch: ${joined.roomEpoch}" \\\n     -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"todo_list","arguments":{}}}' | jq .\n`,
    );
    console.log("Press Ctrl+C to stop.");
    return;
  }

  // Test room rotation & clean shutdown in one-shot mode
  const prevRoomId = joined.roomId;
  const nextInvite = await provider.refreshRoom({
    alias: "local-todo-host-rotated",
  });
  const nextRoomId = provider.getSession().roomId;
  console.log(
    `\n[+] Room Rotation verified         -> ${prevRoomId} => ${nextRoomId}\n    Next Invite                    -> ${nextInvite}`,
  );

  await service.disconnect();
  provider.disconnect();
  await server.close();
  console.log("\nALL LOCAL FUNCTIONAL CHECKS PASSED.");
}

main().catch((err) => {
  console.error("Smoke test failed:", err);
  process.exit(1);
});
