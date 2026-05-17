import { GitlabProjectClient } from "./gitlab-client.js";

export type GitlabDocumentTarget = "wiki" | "repository" | "release";
export type GitlabDocumentSaveMode = "create" | "update";

export interface GitlabDocumentSaveInput {
  readonly target: GitlabDocumentTarget;
  readonly path: string;
  readonly title: string;
  readonly markdown: string;
  readonly mode?: GitlabDocumentSaveMode;
  readonly branch?: string;
}

export interface GitlabDocumentSaveRequest {
  readonly method: "POST" | "PUT";
  readonly path: string;
  readonly body: Readonly<Record<string, string>>;
}

export interface GitlabDocumentSaveResult {
  readonly dryRun: boolean;
  readonly request: GitlabDocumentSaveRequest;
  readonly response?: unknown;
}

export interface GitlabDocumentSaveServiceOptions {
  readonly client: GitlabProjectClient;
  readonly defaultBranch?: string;
}

export class GitlabDocumentSaveService {
  readonly #client: GitlabProjectClient;
  readonly #defaultBranch: string;

  constructor(opts: GitlabDocumentSaveServiceOptions) {
    this.#client = opts.client;
    this.#defaultBranch = opts.defaultBranch ?? "main";
  }

  buildRequest(input: GitlabDocumentSaveInput): GitlabDocumentSaveRequest {
    if (input.target === "wiki") return this.#buildWikiRequest(input);
    if (input.target === "repository") return this.#buildRepositoryFileRequest(input);
    return this.#buildReleaseRequest(input);
  }

  async save(input: GitlabDocumentSaveInput, opts: { readonly dryRun?: boolean } = {}): Promise<GitlabDocumentSaveResult> {
    const request = this.buildRequest(input);
    if (opts.dryRun === true) {
      return { dryRun: true, request };
    }
    const response = await this.#client.request<unknown>(request.method, request.path, request.body);
    return { dryRun: false, request, response };
  }

  #buildWikiRequest(input: GitlabDocumentSaveInput): GitlabDocumentSaveRequest {
    const mode = input.mode ?? "update";
    const slug = wikiSlugFromPath(input.path);
    return {
      method: mode === "create" ? "POST" : "PUT",
      path: mode === "create"
        ? this.#client.projectApiPath("/wikis")
        : this.#client.projectApiPath(`/wikis/${encodeURIComponent(slug)}`),
      body: {
        title: input.title,
        content: input.markdown,
      },
    };
  }

  #buildRepositoryFileRequest(input: GitlabDocumentSaveInput): GitlabDocumentSaveRequest {
    const mode = input.mode ?? "update";
    const branch = input.branch ?? this.#defaultBranch;
    const filePath = input.path.replace(/^repository\//, "");
    return {
      method: mode === "create" ? "POST" : "PUT",
      path: this.#client.projectApiPath(`/repository/files/${encodeURIComponent(filePath)}`),
      body: {
        branch,
        content: input.markdown,
        commit_message: `${mode === "create" ? "Create" : "Update"} ${filePath}`,
      },
    };
  }

  #buildReleaseRequest(input: GitlabDocumentSaveInput): GitlabDocumentSaveRequest {
    const tagName = input.path.replace(/^release\//, "");
    return {
      method: "PUT",
      path: this.#client.projectApiPath(`/releases/${encodeURIComponent(tagName)}`),
      body: {
        name: input.title,
        description: input.markdown,
      },
    };
  }
}

function wikiSlugFromPath(path: string): string {
  return path.replace(/^wiki\//, "");
}
