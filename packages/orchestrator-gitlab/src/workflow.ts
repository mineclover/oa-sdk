import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";

import { parse as parseYaml } from "yaml";

import type { OrchestratorConfig } from "./config.js";
import { ClaudeAgent } from "./agents/claude.js";
import { CodexAgent } from "./agents/codex.js";
import { EchoAgent } from "./agents/echo.js";
import { GitlabContextSearchService } from "./context-search.js";
import { GitlabDocumentSaveService } from "./document-save.js";
import { GitlabProjectClient, type GitlabProjectClientOptions } from "./gitlab-client.js";
import { GitlabIssueTaskService } from "./issue-tasks.js";
import { LiquidPromptBuilder, DEFAULT_PROMPT_TEMPLATE } from "./prompt-liquid.js";
import { GitlabTracker } from "./tracker.js";
import type { Agent, LabelConfig, Workspace } from "./types.js";
import { FsWorkspaceManager, type FsWorkspaceOptions } from "./workspace.js";

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/* -----------------------------------------------------------------------
 * Error classes — mirror Symphony SPEC §5.5
 * ---------------------------------------------------------------------*/

export class MissingWorkflowFileError extends Error {
  readonly code = "missing_workflow_file";
  constructor(path: string, cause?: unknown) {
    super(`workflow file not found or unreadable: ${path}`);
    this.name = "MissingWorkflowFileError";
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

export class WorkflowParseError extends Error {
  readonly code = "workflow_parse_error";
  constructor(message: string, cause?: unknown) {
    super(`failed to parse workflow file: ${message}`);
    this.name = "WorkflowParseError";
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

export class WorkflowFrontMatterNotAMapError extends Error {
  readonly code = "workflow_front_matter_not_a_map";
  constructor() {
    super("workflow front matter must decode to a YAML map (object)");
    this.name = "WorkflowFrontMatterNotAMapError";
  }
}

export class WorkflowValidationError extends Error {
  readonly code = "workflow_validation_error";
  constructor(field: string, reason: string) {
    super(`workflow config invalid at '${field}': ${reason}`);
    this.name = "WorkflowValidationError";
  }
}

/* -----------------------------------------------------------------------
 * Low-level: parse front matter + body
 * ---------------------------------------------------------------------*/

export interface ParsedWorkflow {
  readonly config: Record<string, unknown>;
  readonly promptTemplate: string;
}

const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function parseWorkflow(text: string): ParsedWorkflow {
  const match = FRONT_MATTER_RE.exec(text);
  if (match === null) {
    // No front matter — entire text is body, config is empty map.
    return { config: {}, promptTemplate: text.trim() };
  }
  const yamlText = match[1] ?? "";
  const body = match[2] ?? "";

  let parsed: unknown;
  try {
    parsed = parseYaml(yamlText);
  } catch (err) {
    throw new WorkflowParseError("YAML decode failed", err);
  }

  if (parsed === null || parsed === undefined) {
    return { config: {}, promptTemplate: body.trim() };
  }
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new WorkflowFrontMatterNotAMapError();
  }
  return {
    config: parsed as Record<string, unknown>,
    promptTemplate: body.trim(),
  };
}

export async function readAndParseWorkflow(path: string): Promise<ParsedWorkflow> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    throw new MissingWorkflowFileError(path, err);
  }
  return parseWorkflow(text);
}

/* -----------------------------------------------------------------------
 * High-level: build OrchestratorConfig from a WORKFLOW.md
 * ---------------------------------------------------------------------*/

export interface LoadWorkflowOverrides {
  /** Override the agent built from `agent.kind`. Useful for custom agent classes. */
  readonly agent?: Agent;
  /** Override the AbortSignal wired into OrchestratorConfig. */
  readonly signal?: AbortSignal;
  /** Override the log sink. */
  readonly log?: OrchestratorConfig["log"];
}

export async function loadWorkflow(
  path: string,
  overrides: LoadWorkflowOverrides = {},
): Promise<OrchestratorConfig> {
  const { config, promptTemplate } = await readAndParseWorkflow(path);
  return buildConfigFromWorkflow(config, promptTemplate, overrides);
}

export function buildConfigFromWorkflow(
  raw: Record<string, unknown>,
  promptTemplate: string,
  overrides: LoadWorkflowOverrides = {},
): OrchestratorConfig {
  const trackerCfg = getObject(raw, "tracker") ?? {};
  const gitlabOptions = buildGitlabClientOptions(trackerCfg);
  const tracker = new GitlabTracker(gitlabOptions);
  const contextSearch = new GitlabContextSearchService({
    client: new GitlabProjectClient(gitlabOptions),
    coordinateProjectId: String(gitlabOptions.projectId),
  });
  const issueTasks = new GitlabIssueTaskService({
    client: new GitlabProjectClient(gitlabOptions),
  });
  const documentSave = new GitlabDocumentSaveService({
    client: new GitlabProjectClient(gitlabOptions),
    defaultBranch: getString(getObject(raw, "documents") ?? {}, "default_branch") ?? "main",
  });
  const labels = buildLabels(getObject(raw, "tracker") ?? {});
  const workspace = buildWorkspace(getObject(raw, "workspace") ?? {}, getObject(raw, "hooks") ?? {});
  const agent = overrides.agent ?? buildAgent(getObject(raw, "agent") ?? {});
  const prompt = new LiquidPromptBuilder(
    promptTemplate.length > 0 ? promptTemplate : DEFAULT_PROMPT_TEMPLATE,
  );

  const polling = getObject(raw, "polling") ?? {};
  const agentCfg = getObject(raw, "agent") ?? {};
  const httpCfg = getObject(raw, "http") ?? {};

  const pollIntervalMs = getNumber(polling, "interval_ms");
  const maxConcurrent = getNumber(agentCfg, "max_concurrent_agents");
  const maxAttempts = getNumber(agentCfg, "max_attempts");
  const maxRetryBackoffMs = getNumber(agentCfg, "max_retry_backoff_ms");
  const maxTurns = getNumber(agentCfg, "max_turns");
  const reconciliationIntervalMs = getNumber(trackerCfg, "reconciliation_interval_ms");
  const continueLabel = getString(trackerCfg, "continue_label");
  const httpPort = getNumber(httpCfg, "port");
  const httpHost = getString(httpCfg, "host");
  const httpAuthTokenRaw = getString(httpCfg, "auth_token");
  const httpAuthToken = httpAuthTokenRaw !== undefined ? resolveVarRefs(httpAuthTokenRaw) : undefined;

  const out: Mutable<OrchestratorConfig> = {
    tracker,
    workspace,
    agent,
    prompt,
    contextSearch,
    documentSave,
    issueTasks,
  };
  if (labels !== undefined) out.labels = labels;
  if (pollIntervalMs !== undefined) out.pollIntervalMs = pollIntervalMs;
  if (maxConcurrent !== undefined) out.maxConcurrent = maxConcurrent;
  if (maxAttempts !== undefined) out.maxAttempts = maxAttempts;
  if (maxRetryBackoffMs !== undefined) out.maxRetryBackoffMs = maxRetryBackoffMs;
  if (maxTurns !== undefined) out.maxTurns = maxTurns;
  if (reconciliationIntervalMs !== undefined) out.reconciliationIntervalMs = reconciliationIntervalMs;
  if (continueLabel !== undefined) out.continueLabel = continueLabel;
  if (httpPort !== undefined) out.httpPort = httpPort;
  if (httpHost !== undefined) out.httpHost = httpHost;
  if (httpAuthToken !== undefined && httpAuthToken.length > 0) out.httpAuthToken = httpAuthToken;
  if (overrides.signal !== undefined) out.signal = overrides.signal;
  if (overrides.log !== undefined) out.log = overrides.log;
  return out;
}

/* -----------------------------------------------------------------------
 * Builders for individual sections
 * ---------------------------------------------------------------------*/

function buildGitlabClientOptions(rawTracker: Record<string, unknown>): GitlabProjectClientOptions {
  const kind = getString(rawTracker, "kind");
  if (kind !== "gitlab") {
    throw new WorkflowValidationError(
      "tracker.kind",
      `expected "gitlab", got ${kind === undefined ? "(missing)" : `"${kind}"`}. This package does not implement Symphony's "linear" tracker — see docs/internal/todo.md → 전략 결정 (2026-05-07).`,
    );
  }
  const baseUrl = required(getString(rawTracker, "base_url"), "tracker.base_url");
  const tokenRaw = required(getString(rawTracker, "token"), "tracker.token");
  const token = resolveVarRefs(tokenRaw);
  if (token.length === 0) {
    throw new WorkflowValidationError(
      "tracker.token",
      `resolved to empty string (likely a missing $VAR_NAME); raw value was "${tokenRaw}"`,
    );
  }
  const projectId = required(
    getString(rawTracker, "project_id") ?? toStringOrUndefined(getNumber(rawTracker, "project_id")),
    "tracker.project_id",
  );
  return {
    baseUrl: baseUrl.replace(/\/$/, ""),
    token,
    projectId,
  };
}

function buildLabels(rawTracker: Record<string, unknown>): Partial<LabelConfig> | undefined {
  const labelsRaw = getObject(rawTracker, "labels");
  if (labelsRaw === undefined) return undefined;
  const out: Mutable<Partial<LabelConfig>> = {};
  const ready = getString(labelsRaw, "ready");
  const running = getString(labelsRaw, "running");
  const done = getString(labelsRaw, "done");
  const failed = getString(labelsRaw, "failed");
  if (ready !== undefined) out.ready = ready;
  if (running !== undefined) out.running = running;
  if (done !== undefined) out.done = done;
  if (failed !== undefined) out.failed = failed;
  return Object.keys(out).length > 0 ? out : undefined;
}

function buildWorkspace(
  rawWorkspace: Record<string, unknown>,
  rawHooks: Record<string, unknown>,
): FsWorkspaceManager {
  const root = resolvePath(
    required(getString(rawWorkspace, "root") ?? getString(rawWorkspace, "path"), "workspace.root"),
  );
  const projectSlug = getString(rawWorkspace, "project_slug") ?? "default";
  const afterCreateScript = getString(rawHooks, "after_create");

  const opts: Mutable<FsWorkspaceOptions> = { root, projectSlug };
  if (afterCreateScript !== undefined) {
    opts.afterCreate = makeShellHook(afterCreateScript);
  }
  return new FsWorkspaceManager(opts);
}

function buildAgent(rawAgent: Record<string, unknown>): Agent {
  const kind = getString(rawAgent, "kind") ?? "echo";
  const opts = getObject(rawAgent, "options") ?? {};

  const bin = getString(opts, "bin");
  const timeoutMs = getNumber(opts, "timeout_ms");
  const extraEnv = getStringRecord(opts, "extra_env");

  switch (kind) {
    case "echo":
      return new EchoAgent();
    case "codex": {
      const subcommand = getString(opts, "subcommand");
      const globalArgs = getStringArray(opts, "global_args");
      const codexOpts: Mutable<ConstructorParameters<typeof CodexAgent>[0] & object> = {};
      if (bin !== undefined) codexOpts.bin = bin;
      if (subcommand !== undefined) codexOpts.subcommand = subcommand;
      if (timeoutMs !== undefined) codexOpts.timeoutMs = timeoutMs;
      if (globalArgs !== undefined) codexOpts.globalArgs = globalArgs;
      if (extraEnv !== undefined) codexOpts.extraEnv = extraEnv;
      return new CodexAgent(codexOpts);
    }
    case "claude": {
      const args = getStringArray(opts, "args");
      const promptDelivery = getString(opts, "prompt_delivery");
      const claudeOpts: Mutable<ConstructorParameters<typeof ClaudeAgent>[0] & object> = {};
      if (bin !== undefined) claudeOpts.bin = bin;
      if (timeoutMs !== undefined) claudeOpts.timeoutMs = timeoutMs;
      if (args !== undefined) claudeOpts.args = args;
      if (extraEnv !== undefined) claudeOpts.extraEnv = extraEnv;
      if (promptDelivery === "argv" || promptDelivery === "stdin") {
        claudeOpts.promptDelivery = promptDelivery;
      }
      return new ClaudeAgent(claudeOpts);
    }
    default:
      throw new WorkflowValidationError(
        "agent.kind",
        `unknown agent kind "${kind}"; supported: echo, codex, claude. Custom agents must be passed via loadWorkflow(..., { agent }).`,
      );
  }
}

function makeShellHook(script: string): (workspace: Readonly<Workspace>) => Promise<void> {
  return async (workspace) => {
    return new Promise<void>((resolve, reject) => {
      const child = spawn("bash", ["-lc", script], {
        cwd: workspace.path,
        stdio: ["ignore", "inherit", "inherit"],
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`workspace hook exited with code ${String(code)}`));
        }
      });
    });
  };
}

/* -----------------------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------------------*/

function required<T>(value: T | undefined, field: string): T {
  if (value === undefined) {
    throw new WorkflowValidationError(field, "required field is missing");
  }
  return value;
}

function getObject(o: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const v = o[key];
  if (v === null || v === undefined) return undefined;
  if (typeof v !== "object" || Array.isArray(v)) return undefined;
  return v as Record<string, unknown>;
}

function getString(o: Record<string, unknown>, key: string): string | undefined {
  const v = o[key];
  return typeof v === "string" ? v : undefined;
}

function getNumber(o: Record<string, unknown>, key: string): number | undefined {
  const v = o[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function getStringArray(o: Record<string, unknown>, key: string): ReadonlyArray<string> | undefined {
  const v = o[key];
  if (!Array.isArray(v)) return undefined;
  return v.filter((x): x is string => typeof x === "string");
}

function getStringRecord(o: Record<string, unknown>, key: string): Record<string, string> | undefined {
  const v = o[key];
  if (v === null || v === undefined || typeof v !== "object" || Array.isArray(v)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === "string") {
      out[k] = val;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function toStringOrUndefined(n: number | undefined): string | undefined {
  return n !== undefined ? String(n) : undefined;
}

/**
 * Replace `$VAR_NAME` occurrences with `process.env.VAR_NAME` value.
 *
 * Symphony §6.1: substitution applies only to values that explicitly contain
 * a `$VAR_NAME` reference. We support both bare references (`$LINEAR_API_KEY`)
 * and embedded references (`$HOME/code/...`). Missing env values resolve to
 * the empty string — caller validates afterwards.
 */
const VAR_REF = /\$([A-Z_][A-Z0-9_]*)/g;
export function resolveVarRefs(value: string): string {
  return value.replace(VAR_REF, (_match, name: string) => process.env[name] ?? "");
}

/** Same as `resolveVarRefs` but additionally expands a leading `~/` to `$HOME`. */
export function resolvePath(value: string): string {
  let out = value;
  if (out.startsWith("~/") && process.env.HOME !== undefined) {
    out = `${process.env.HOME}/${out.slice(2)}`;
  }
  return resolveVarRefs(out);
}
