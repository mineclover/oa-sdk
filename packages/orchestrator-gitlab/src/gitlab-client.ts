export interface GitlabProjectClientOptions {
  /** GitLab base URL, e.g. "http://localhost:8929" — no trailing slash. */
  readonly baseUrl: string;
  /** Personal access token, project access token, or CI token accepted by GitLab's PRIVATE-TOKEN header. */
  readonly token: string;
  /** Numeric project id or namespace/path. Already-encoded namespace paths are accepted and normalized. */
  readonly projectId: string | number;
  /** Optional fetch override for tests. Defaults to global fetch. */
  readonly fetchImpl?: typeof fetch;
}

export interface GitlabMaybeResponse<T = unknown> {
  readonly ok: boolean;
  readonly status: number;
  readonly body: T;
  readonly headers: Headers;
}

export class GitlabProjectClient {
  readonly #baseUrl: string;
  readonly #token: string;
  readonly #projectId: string;
  readonly #fetch: typeof fetch;

  constructor(opts: GitlabProjectClientOptions) {
    if (opts.baseUrl.endsWith("/")) {
      throw new Error("GitlabProjectClient: baseUrl must not end with '/'");
    }
    this.#baseUrl = opts.baseUrl;
    this.#token = opts.token;
    this.#projectId = encodeGitlabProjectId(opts.projectId);
    this.#fetch = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  get baseUrl(): string {
    return this.#baseUrl;
  }

  /** URL-encoded project identifier suitable for GitLab API path segments. */
  get encodedProjectId(): string {
    return this.#projectId;
  }

  projectApiPath(suffix = ""): string {
    const normalizedSuffix = suffix.length === 0 || suffix.startsWith("/") ? suffix : `/${suffix}`;
    return `/api/v4/projects/${this.#projectId}${normalizedSuffix}`;
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.rawRequest(method, path, body);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new GitlabApiError(method, path, res.status, text);
    }
    if (res.status === 204) {
      return undefined as T;
    }
    return (await res.json()) as T;
  }

  async requestText(method: string, path: string, body?: unknown): Promise<string> {
    const res = await this.rawRequest(method, path, body);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new GitlabApiError(method, path, res.status, text);
    }
    return await res.text();
  }

  async requestMaybe<T = unknown>(method: string, path: string, body?: unknown): Promise<GitlabMaybeResponse<T>> {
    const res = await this.rawRequest(method, path, body);
    const text = await res.text().catch(() => "");
    return {
      ok: res.ok,
      status: res.status,
      body: parseMaybeJson(text) as T,
      headers: res.headers,
    };
  }

  async rawRequest(method: string, path: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = {
      "PRIVATE-TOKEN": this.#token,
      Accept: "application/json",
    };
    let payload: string | undefined;
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const init: RequestInit = { method, headers };
    if (payload !== undefined) {
      init.body = payload;
    }
    return await this.#fetch(`${this.#baseUrl}${path}`, init);
  }
}

export class GitlabApiError extends Error {
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly responseBody: string;

  constructor(method: string, path: string, status: number, responseBody: string) {
    super(`GitLab API ${method} ${path} -> ${String(status)}`);
    this.name = "GitlabApiError";
    this.method = method;
    this.path = path;
    this.status = status;
    this.responseBody = responseBody;
  }
}

export function encodeGitlabProjectId(projectId: string | number): string {
  return encodeURIComponent(safelyDecodeURIComponent(String(projectId)));
}

function safelyDecodeURIComponent(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function parseMaybeJson(text: string): unknown {
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
