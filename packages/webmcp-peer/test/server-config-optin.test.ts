// Regression tests: an embedded WebMcpPeerServer must not parse the host process's argv or load
// `.env` files into process.env; both stay available as explicit opt-ins for a CLI entry point.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createWebMcpPeerServer,
  loadConfigFile,
  loadDeploymentCatalog,
  resolvePeerServerConfig,
  type WebMcpPeerServer,
} from "../src/server.js";

const SENTINEL = `WEBMCP_PEER_DOTENV_SENTINEL_${process.pid}`;
let tempDir = "";
const originalArgv = process.argv;
const originalCwd = process.cwd();

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "webmcp-peer-config-"));
  fs.writeFileSync(path.join(tempDir, ".env"), `${SENTINEL}=from-dotenv\n`);
});

afterEach(() => {
  process.argv = originalArgv;
  process.chdir(originalCwd);
  delete process.env[SENTINEL];
  delete process.env.WEBMCP_CATALOG_PATH;
  delete process.env.FRAMEBOOK_COLLAB_JOURNAL_PATH;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

// Constructed only (never listening, no sweep timer), so there is nothing to close.
function embedded(options: Parameters<typeof createWebMcpPeerServer>[0] = {}): WebMcpPeerServer {
  return createWebMcpPeerServer({ port: 0, host: "127.0.0.1", roomSweepIntervalMs: 0, ...options });
}

describe("embedded server configuration", () => {
  it("ignores the host process's argv", () => {
    process.argv = [originalArgv[0]!, originalArgv[1]!, "--port", "45679", "--host", "0.0.0.0", "-c", "missing.json"];
    const server = embedded();
    expect(server.port).toBe(0);
    expect(server.host).toBe("127.0.0.1");
    expect(server.configPath).toBeUndefined();
  });

  it("does not load .env files into process.env", () => {
    process.chdir(tempDir);
    embedded();
    expect(process.env[SENTINEL]).toBeUndefined();
    embedded({ cwd: tempDir });
    expect(process.env[SENTINEL]).toBeUndefined();
  });

  it("applies argv and .env loading when the caller opts in", () => {
    const server = embedded({ argv: ["--host", "localhost", "--publish-key", "cli-key"], cwd: tempDir, loadEnvFiles: true });
    expect(server.host).toBe("localhost");
    expect(server.publishKeyConfigured).toBe(true);
    expect(process.env[SENTINEL]).toBe("from-dotenv");
  });

  it("keeps .env loading on by default for direct resolvePeerServerConfig callers", () => {
    resolvePeerServerConfig({}, [], tempDir, { loadEnvFiles: false });
    expect(process.env[SENTINEL]).toBeUndefined();
    resolvePeerServerConfig({}, [], tempDir);
    expect(process.env[SENTINEL]).toBe("from-dotenv");
  });

  it("validates JSON config files field by field", () => {
    const configPath = path.join(tempDir, "peer-server.config.json");
    fs.writeFileSync(configPath, JSON.stringify({ port: 9001, host: 7, allowedOrigins: ["https://a.example", 3], rateLimit: { max: 4 } }));
    expect(loadConfigFile(configPath)).toEqual({ port: 9001, allowedOrigins: ["https://a.example"], publishRateLimitMax: 4 });
    fs.writeFileSync(configPath, "[]");
    expect(loadConfigFile(configPath)).toEqual({});
    fs.writeFileSync(configPath, JSON.stringify({ publishKey: "" }));
    expect(() => loadConfigFile(configPath)).toThrow("PUBLISH_KEY_CONFIG_INVALID");
    fs.writeFileSync(configPath, "{not json");
    expect(() => loadConfigFile(configPath)).toThrow(/^PEER_SERVER_CONFIG_INVALID/);
  });
});

describe("paths resolved against cwd", () => {
  const catalogFile = (dir: string, name: string) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "webmcp-tools.json"), JSON.stringify({ tools: [{ name, inputSchema: { type: "object" } }] }));
  };

  it("loads the deployment catalog from the cwd option, not from the process's working directory", () => {
    catalogFile(path.join(tempDir, "api"), "from_cwd");
    const server = embedded({ cwd: tempDir });
    expect(server.deploymentCatalog.source).toBe("deployment");
    expect(server.deploymentCatalog.tools.map((tool) => tool.name)).toEqual(["from_cwd"]);

    // A relative catalog path from the environment is resolved against cwd too.
    catalogFile(path.join(tempDir, "catalogs"), "from_env");
    process.env.WEBMCP_CATALOG_PATH = "catalogs/webmcp-tools.json";
    expect(loadDeploymentCatalog(undefined, tempDir).tools.map((tool) => tool.name)).toEqual(["from_env"]);
  });

  it("does not look for a deployment catalog in another package's directory", () => {
    catalogFile(path.join(tempDir, "packages", "peer-server", "api"), "other_package");
    expect(loadDeploymentCatalog(undefined, tempDir).source).toBe("empty");
  });

  it("no longer resolves a journalPath, which nothing used", () => {
    process.env.FRAMEBOOK_COLLAB_JOURNAL_PATH = "journal.log";
    const config = resolvePeerServerConfig({}, ["--journal-path", "cli-journal.log"], tempDir, { loadEnvFiles: false });
    expect(config).not.toHaveProperty("journalPath");
  });
});
