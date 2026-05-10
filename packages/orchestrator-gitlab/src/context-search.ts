import { GitlabProjectClient } from "./gitlab-client.js";

export type GitlabContextKind =
  | "issue"
  | "issue_note"
  | "merge_request"
  | "discussion"
  | "repo_file"
  | "wiki_page"
  | "snippet"
  | "pipeline"
  | "release"
  | "label"
  | "milestone"
  | "board";

export interface GitlabContextSearchQuery {
  readonly text?: string;
  readonly kinds?: ReadonlyArray<GitlabContextKind>;
  readonly labels?: ReadonlyArray<string>;
  readonly state?: "opened" | "closed" | "merged" | "all";
  readonly branch?: string;
  readonly ref?: string;
  readonly milestone?: string;
  readonly authorUsername?: string;
  readonly updatedAfter?: string;
  readonly updatedBefore?: string;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface GitlabContextSearchResult {
  readonly id: string;
  readonly kind: GitlabContextKind;
  readonly title: string;
  readonly url?: string | undefined;
  readonly preview?: string | undefined;
  readonly score?: number | undefined;
  readonly updatedAt?: string | undefined;
  readonly ref?: string | undefined;
  readonly metadata: Readonly<Record<string, string | number | boolean>>;
}

export interface GitlabContextExpandOptions {
  readonly includeBody?: boolean;
  readonly includeComments?: boolean;
  readonly includeDiscussions?: boolean;
  readonly includeDiffSummary?: boolean;
  readonly includePipelineStatus?: boolean;
  readonly includeLinkedObjects?: boolean;
  readonly maxBodyChars?: number;
  readonly maxComments?: number;
}

export interface GitlabContextDocument {
  readonly id: string;
  readonly kind: GitlabContextKind;
  readonly title: string;
  readonly body?: string | undefined;
  readonly url?: string | undefined;
  readonly ref?: string | undefined;
  readonly updatedAt?: string | undefined;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly links: ReadonlyArray<{ readonly rel: string; readonly target: string }>;
}

export interface GitlabContextCapabilities {
  readonly version: string;
  readonly enterprise: boolean;
  readonly supportsWiki: boolean;
  readonly supportsProjectSnippets: boolean;
  readonly supportsIssueBoards: boolean;
  readonly supportsMergeRequests: boolean;
  readonly supportsPipelineCreate: boolean;
  readonly supportsReleaseEvidence: boolean;
}

export interface GitlabContextSearchServiceOptions {
  readonly client: GitlabProjectClient;
  /** Stable project id segment used in gitlab:// coordinates. Defaults to the encoded project id. */
  readonly coordinateProjectId?: string;
}

interface GitlabIssueSearchRaw {
  readonly iid: number;
  readonly title: string;
  readonly description: string | null;
  readonly state: string;
  readonly labels: ReadonlyArray<string>;
  readonly web_url: string;
  readonly updated_at: string;
}

interface GitlabMergeRequestSearchRaw {
  readonly iid: number;
  readonly title: string;
  readonly description: string | null;
  readonly state: string;
  readonly labels: ReadonlyArray<string>;
  readonly web_url: string;
  readonly updated_at: string;
  readonly source_branch: string;
  readonly target_branch: string;
  readonly head_pipeline?: GitlabPipelineRaw | null;
}

interface GitlabNoteRaw {
  readonly id: number;
  readonly body: string;
  readonly system: boolean;
  readonly created_at: string;
  readonly updated_at?: string;
  readonly author?: { readonly username?: string; readonly name?: string };
}

interface GitlabDiscussionRaw {
  readonly id: string;
  readonly individual_note: boolean;
  readonly notes: ReadonlyArray<GitlabNoteRaw>;
}

interface GitlabTreeRaw {
  readonly path: string;
  readonly type: "blob" | "tree";
}

interface GitlabFileRaw {
  readonly file_path: string;
  readonly ref: string;
  readonly last_commit_id?: string;
  readonly content_sha256?: string;
}

interface GitlabWikiRaw {
  readonly slug: string;
  readonly title: string;
  readonly content?: string;
  readonly format?: string;
}

interface GitlabSnippetRaw {
  readonly id: number;
  readonly title: string;
  readonly description: string | null;
  readonly web_url?: string;
  readonly updated_at?: string;
  readonly visibility: string;
}

interface GitlabReleaseRaw {
  readonly tag_name: string;
  readonly name: string;
  readonly description: string | null;
  readonly released_at?: string;
  readonly created_at?: string;
  readonly _links?: { readonly self?: string };
}

interface GitlabPipelineRaw {
  readonly id: number;
  readonly status: string;
  readonly ref?: string;
  readonly sha?: string;
  readonly web_url?: string;
  readonly updated_at?: string;
}

interface GitlabVersionRaw {
  readonly version?: string;
  readonly enterprise?: boolean;
}

const DEFAULT_KINDS: ReadonlyArray<GitlabContextKind> = [
  "issue",
  "merge_request",
  "repo_file",
  "wiki_page",
  "snippet",
  "release",
];

const DEFAULT_LIMIT = 20;

export class GitlabContextSearchService {
  readonly #client: GitlabProjectClient;
  readonly #coordinateProjectId: string;

  constructor(opts: GitlabContextSearchServiceOptions) {
    this.#client = opts.client;
    this.#coordinateProjectId = opts.coordinateProjectId ?? opts.client.encodedProjectId;
  }

  async search(query: GitlabContextSearchQuery): Promise<ReadonlyArray<GitlabContextSearchResult>> {
    const limit = normalizeLimit(query.limit);
    const kinds = query.kinds ?? DEFAULT_KINDS;
    const tasks = kinds.map((kind) => this.#searchKind(kind, query, limit));
    const settled = await Promise.allSettled(tasks);
    const results: GitlabContextSearchResult[] = [];
    for (const result of settled) {
      if (result.status === "fulfilled") {
        results.push(...result.value);
      }
    }
    return sortResults(results).slice(0, limit);
  }

  async expand(id: string, options: GitlabContextExpandOptions = {}): Promise<GitlabContextDocument> {
    const coordinate = parseGitlabContextCoordinate(id);
    switch (coordinate.kind) {
      case "issue":
        return await this.#expandIssue(coordinate.issueIid, options);
      case "merge_request":
        return await this.#expandMergeRequest(coordinate.mergeRequestIid, options);
      case "repo_file":
        return await this.#expandRepoFile(coordinate.path, coordinate.ref, options);
      case "wiki_page":
        return await this.#expandWikiPage(coordinate.slug, options);
      case "snippet":
        return await this.#expandSnippet(coordinate.snippetId, options);
      case "release":
        return await this.#expandRelease(coordinate.tagName, options);
      default:
        throw new Error("expand unsupported for coordinate kind");
    }
  }

  async discoverCapabilities(): Promise<GitlabContextCapabilities> {
    const [version, wiki, snippets, boards, mergeRequests, pipelines] = await Promise.all([
      this.#client.requestMaybe<GitlabVersionRaw>("GET", "/api/v4/version"),
      this.#client.requestMaybe<unknown>("GET", this.#client.projectApiPath("/wikis?per_page=1")),
      this.#client.requestMaybe<unknown>("GET", this.#client.projectApiPath("/snippets?per_page=1")),
      this.#client.requestMaybe<unknown>("GET", this.#client.projectApiPath("/boards?per_page=1")),
      this.#client.requestMaybe<unknown>("GET", this.#client.projectApiPath("/merge_requests?per_page=1")),
      this.#client.requestMaybe<unknown>("GET", this.#client.projectApiPath("/pipelines?per_page=1")),
    ]);

    const enterprise = Boolean(version.body.enterprise);
    return {
      version: version.body.version ?? "",
      enterprise,
      supportsWiki: wiki.ok,
      supportsProjectSnippets: snippets.ok,
      supportsIssueBoards: boards.ok,
      supportsMergeRequests: mergeRequests.ok,
      supportsPipelineCreate: pipelines.ok,
      supportsReleaseEvidence: enterprise,
    };
  }

  async #searchKind(
    kind: GitlabContextKind,
    query: GitlabContextSearchQuery,
    limit: number,
  ): Promise<ReadonlyArray<GitlabContextSearchResult>> {
    switch (kind) {
      case "issue":
        return await this.#searchIssues(query, limit);
      case "merge_request":
        return await this.#searchMergeRequests(query, limit);
      case "repo_file":
        return await this.#searchRepoFiles(query, limit);
      case "wiki_page":
        return await this.#searchWikiPages(query, limit);
      case "snippet":
        return await this.#searchSnippets(query, limit);
      case "release":
        return await this.#searchReleases(query, limit);
      default:
        return [];
    }
  }

  async #searchIssues(query: GitlabContextSearchQuery, limit: number): Promise<ReadonlyArray<GitlabContextSearchResult>> {
    const params = new URLSearchParams({
      per_page: String(limit),
      order_by: "updated_at",
      sort: "desc",
    });
    if (query.text !== undefined && query.text.length > 0) params.set("search", query.text);
    if (query.state !== undefined && query.state !== "merged") params.set("state", query.state);
    if (query.labels !== undefined && query.labels.length > 0) params.set("labels", query.labels.join(","));
    if (query.milestone !== undefined) params.set("milestone", query.milestone);
    if (query.updatedAfter !== undefined) params.set("updated_after", query.updatedAfter);
    if (query.updatedBefore !== undefined) params.set("updated_before", query.updatedBefore);

    const raws = await this.#client.request<ReadonlyArray<GitlabIssueSearchRaw>>(
      "GET",
      this.#client.projectApiPath(`/issues?${params.toString()}`),
    );
    return raws.map((issue) => ({
      id: gitlabIssueCoordinate(this.#coordinateProjectId, issue.iid),
      kind: "issue",
      title: issue.title,
      url: issue.web_url,
      preview: truncate(issue.description ?? "", 240),
      updatedAt: issue.updated_at,
      metadata: {
        iid: issue.iid,
        state: issue.state,
        labels: issue.labels.join(","),
      },
    }));
  }

  async #searchMergeRequests(
    query: GitlabContextSearchQuery,
    limit: number,
  ): Promise<ReadonlyArray<GitlabContextSearchResult>> {
    const params = new URLSearchParams({
      per_page: String(limit),
      order_by: "updated_at",
      sort: "desc",
    });
    if (query.text !== undefined && query.text.length > 0) params.set("search", query.text);
    if (query.state !== undefined && query.state !== "all") params.set("state", query.state);
    if (query.labels !== undefined && query.labels.length > 0) params.set("labels", query.labels.join(","));
    if (query.branch !== undefined) {
      params.set("source_branch", query.branch);
    }
    if (query.updatedAfter !== undefined) params.set("updated_after", query.updatedAfter);
    if (query.updatedBefore !== undefined) params.set("updated_before", query.updatedBefore);

    const raws = await this.#client.request<ReadonlyArray<GitlabMergeRequestSearchRaw>>(
      "GET",
      this.#client.projectApiPath(`/merge_requests?${params.toString()}`),
    );
    return raws.map((mr) => ({
      id: gitlabMergeRequestCoordinate(this.#coordinateProjectId, mr.iid),
      kind: "merge_request",
      title: mr.title,
      url: mr.web_url,
      preview: truncate(mr.description ?? "", 240),
      updatedAt: mr.updated_at,
      ref: mr.source_branch,
      metadata: {
        iid: mr.iid,
        state: mr.state,
        sourceBranch: mr.source_branch,
        targetBranch: mr.target_branch,
        labels: mr.labels.join(","),
      },
    }));
  }

  async #searchRepoFiles(query: GitlabContextSearchQuery, limit: number): Promise<ReadonlyArray<GitlabContextSearchResult>> {
    const ref = query.ref ?? query.branch ?? "main";
    const params = new URLSearchParams({
      recursive: "true",
      per_page: String(Math.min(Math.max(limit, 1), 100)),
      ref,
    });
    const items = await this.#client.request<ReadonlyArray<GitlabTreeRaw>>(
      "GET",
      this.#client.projectApiPath(`/repository/tree?${params.toString()}`),
    );
    const text = query.text?.toLowerCase();
    return items
      .filter((item) => item.type === "blob")
      .filter((item) => text === undefined || item.path.toLowerCase().includes(text))
      .slice(0, limit)
      .map((item) => ({
        id: gitlabRepoFileCoordinate(this.#coordinateProjectId, item.path, ref),
        kind: "repo_file",
        title: item.path,
        ref,
        metadata: {
          path: item.path,
          ref,
        },
      }));
  }

  async #searchWikiPages(query: GitlabContextSearchQuery, limit: number): Promise<ReadonlyArray<GitlabContextSearchResult>> {
    const pages = await this.#client.request<ReadonlyArray<GitlabWikiRaw>>(
      "GET",
      this.#client.projectApiPath("/wikis?with_content=0"),
    );
    const text = query.text?.toLowerCase();
    return pages
      .filter((page) => text === undefined || page.title.toLowerCase().includes(text) || page.slug.toLowerCase().includes(text))
      .slice(0, limit)
      .map((page) => ({
        id: gitlabWikiPageCoordinate(this.#coordinateProjectId, page.slug),
        kind: "wiki_page",
        title: page.title,
        metadata: {
          slug: page.slug,
          format: page.format ?? "",
        },
      }));
  }

  async #searchSnippets(query: GitlabContextSearchQuery, limit: number): Promise<ReadonlyArray<GitlabContextSearchResult>> {
    const params = new URLSearchParams({ per_page: String(limit) });
    const snippets = await this.#client.request<ReadonlyArray<GitlabSnippetRaw>>(
      "GET",
      this.#client.projectApiPath(`/snippets?${params.toString()}`),
    );
    const text = query.text?.toLowerCase();
    return snippets
      .filter((snippet) => text === undefined || snippet.title.toLowerCase().includes(text) || (snippet.description ?? "").toLowerCase().includes(text))
      .map((snippet) => ({
        id: gitlabSnippetCoordinate(this.#coordinateProjectId, snippet.id),
        kind: "snippet",
        title: snippet.title,
        url: snippet.web_url,
        preview: truncate(snippet.description ?? "", 240),
        updatedAt: snippet.updated_at,
        metadata: {
          snippetId: snippet.id,
          visibility: snippet.visibility,
        },
      }));
  }

  async #searchReleases(query: GitlabContextSearchQuery, limit: number): Promise<ReadonlyArray<GitlabContextSearchResult>> {
    const params = new URLSearchParams({ per_page: String(limit) });
    const releases = await this.#client.request<ReadonlyArray<GitlabReleaseRaw>>(
      "GET",
      this.#client.projectApiPath(`/releases?${params.toString()}`),
    );
    const text = query.text?.toLowerCase();
    return releases
      .filter((release) => text === undefined || release.name.toLowerCase().includes(text) || release.tag_name.toLowerCase().includes(text))
      .map((release) => ({
        id: gitlabReleaseCoordinate(this.#coordinateProjectId, release.tag_name),
        kind: "release",
        title: release.name,
        url: release._links?.self,
        preview: truncate(release.description ?? "", 240),
        updatedAt: release.released_at ?? release.created_at,
        ref: release.tag_name,
        metadata: {
          tagName: release.tag_name,
        },
      }));
  }

  async #expandIssue(iid: string, options: GitlabContextExpandOptions): Promise<GitlabContextDocument> {
    const issue = await this.#client.request<GitlabIssueSearchRaw>(
      "GET",
      this.#client.projectApiPath(`/issues/${encodeURIComponent(iid)}`),
    );
    const notes = options.includeComments === true ? await this.#listIssueNotes(iid, options.maxComments) : undefined;
    return {
      id: gitlabIssueCoordinate(this.#coordinateProjectId, issue.iid),
      kind: "issue",
      title: issue.title,
      body: options.includeBody === false ? undefined : truncate(issue.description ?? "", options.maxBodyChars),
      url: issue.web_url,
      updatedAt: issue.updated_at,
      metadata: {
        iid: issue.iid,
        state: issue.state,
        labels: issue.labels,
        ...(notes === undefined ? {} : { comments: notes.map(normalizeNote) }),
      },
      links:
        notes === undefined || options.includeLinkedObjects !== true
          ? []
          : notes.map((note) => ({
              rel: "comment",
              target: gitlabIssueNoteCoordinate(this.#coordinateProjectId, issue.iid, note.id),
            })),
    };
  }

  async #expandMergeRequest(iid: string, options: GitlabContextExpandOptions): Promise<GitlabContextDocument> {
    const mr = await this.#client.request<GitlabMergeRequestSearchRaw>(
      "GET",
      this.#client.projectApiPath(`/merge_requests/${encodeURIComponent(iid)}`),
    );
    const discussions =
      options.includeDiscussions === true ? await this.#listMergeRequestDiscussions(iid, options.maxComments) : undefined;
    const links = buildMergeRequestLinks(this.#coordinateProjectId, mr, discussions, options);
    return {
      id: gitlabMergeRequestCoordinate(this.#coordinateProjectId, mr.iid),
      kind: "merge_request",
      title: mr.title,
      body: options.includeBody === false ? undefined : truncate(mr.description ?? "", options.maxBodyChars),
      url: mr.web_url,
      ref: mr.source_branch,
      updatedAt: mr.updated_at,
      metadata: {
        iid: mr.iid,
        state: mr.state,
        sourceBranch: mr.source_branch,
        targetBranch: mr.target_branch,
        labels: mr.labels,
        ...(mr.head_pipeline === undefined || mr.head_pipeline === null || options.includePipelineStatus !== true
          ? {}
          : { headPipeline: normalizePipeline(mr.head_pipeline) }),
        ...(discussions === undefined ? {} : { discussions: discussions.map(normalizeDiscussion) }),
      },
      links,
    };
  }

  async #expandRepoFile(path: string, ref: string, options: GitlabContextExpandOptions): Promise<GitlabContextDocument> {
    const encodedPath = encodeURIComponent(path);
    const encodedRef = encodeURIComponent(ref);
    const file = await this.#client.request<GitlabFileRaw>(
      "GET",
      this.#client.projectApiPath(`/repository/files/${encodedPath}?ref=${encodedRef}`),
    );
    let body: string | undefined;
    if (options.includeBody !== false) {
      body = await this.#client.requestText("GET", this.#client.projectApiPath(`/repository/files/${encodedPath}/raw?ref=${encodedRef}`));
      body = truncate(body, options.maxBodyChars);
    }
    return {
      id: gitlabRepoFileCoordinate(this.#coordinateProjectId, path, ref),
      kind: "repo_file",
      title: file.file_path,
      body,
      ref,
      metadata: {
        path: file.file_path,
        lastCommitId: file.last_commit_id,
        contentSha256: file.content_sha256,
      },
      links: [],
    };
  }

  async #expandWikiPage(slug: string, options: GitlabContextExpandOptions): Promise<GitlabContextDocument> {
    const page = await this.#client.request<GitlabWikiRaw>(
      "GET",
      this.#client.projectApiPath(`/wikis/${encodeURIComponent(slug)}`),
    );
    return {
      id: gitlabWikiPageCoordinate(this.#coordinateProjectId, page.slug),
      kind: "wiki_page",
      title: page.title,
      body: options.includeBody === false ? undefined : truncate(page.content ?? "", options.maxBodyChars),
      metadata: {
        slug: page.slug,
        format: page.format,
      },
      links: [],
    };
  }

  async #expandSnippet(snippetId: string, options: GitlabContextExpandOptions): Promise<GitlabContextDocument> {
    const snippet = await this.#client.request<GitlabSnippetRaw>(
      "GET",
      this.#client.projectApiPath(`/snippets/${encodeURIComponent(snippetId)}`),
    );
    return {
      id: gitlabSnippetCoordinate(this.#coordinateProjectId, snippet.id),
      kind: "snippet",
      title: snippet.title,
      body: options.includeBody === false ? undefined : truncate(snippet.description ?? "", options.maxBodyChars),
      url: snippet.web_url,
      updatedAt: snippet.updated_at,
      metadata: {
        snippetId: snippet.id,
        visibility: snippet.visibility,
      },
      links: [],
    };
  }

  async #expandRelease(tagName: string, options: GitlabContextExpandOptions): Promise<GitlabContextDocument> {
    const release = await this.#client.request<GitlabReleaseRaw>(
      "GET",
      this.#client.projectApiPath(`/releases/${encodeURIComponent(tagName)}`),
    );
    return {
      id: gitlabReleaseCoordinate(this.#coordinateProjectId, release.tag_name),
      kind: "release",
      title: release.name,
      body: options.includeBody === false ? undefined : truncate(release.description ?? "", options.maxBodyChars),
      url: release._links?.self,
      ref: release.tag_name,
      updatedAt: release.released_at ?? release.created_at,
      metadata: {
        tagName: release.tag_name,
      },
      links: [],
    };
  }

  async #listIssueNotes(iid: string, maxComments: number | undefined): Promise<ReadonlyArray<GitlabNoteRaw>> {
    const params = new URLSearchParams({
      sort: "asc",
      order_by: "created_at",
      per_page: String(normalizeLimit(maxComments ?? 20)),
    });
    return await this.#client.request<ReadonlyArray<GitlabNoteRaw>>(
      "GET",
      this.#client.projectApiPath(`/issues/${encodeURIComponent(iid)}/notes?${params.toString()}`),
    );
  }

  async #listMergeRequestDiscussions(
    iid: string,
    maxDiscussions: number | undefined,
  ): Promise<ReadonlyArray<GitlabDiscussionRaw>> {
    const params = new URLSearchParams({
      per_page: String(normalizeLimit(maxDiscussions ?? 20)),
    });
    return await this.#client.request<ReadonlyArray<GitlabDiscussionRaw>>(
      "GET",
      this.#client.projectApiPath(`/merge_requests/${encodeURIComponent(iid)}/discussions?${params.toString()}`),
    );
  }
}

type ParsedCoordinate =
  | { readonly kind: "issue"; readonly issueIid: string }
  | { readonly kind: "merge_request"; readonly mergeRequestIid: string }
  | { readonly kind: "repo_file"; readonly path: string; readonly ref: string }
  | { readonly kind: "wiki_page"; readonly slug: string }
  | { readonly kind: "snippet"; readonly snippetId: string }
  | { readonly kind: "pipeline"; readonly pipelineId: string }
  | { readonly kind: "issue_note"; readonly issueIid: string; readonly noteId: string }
  | { readonly kind: "discussion"; readonly mergeRequestIid: string; readonly discussionId: string }
  | { readonly kind: "release"; readonly tagName: string };

export function gitlabIssueCoordinate(projectId: string, iid: string | number): string {
  return `gitlab://project/${encodeURIComponent(projectId)}/issues/${encodeURIComponent(String(iid))}`;
}

export function gitlabIssueNoteCoordinate(projectId: string, iid: string | number, noteId: string | number): string {
  return `${gitlabIssueCoordinate(projectId, iid)}/notes/${encodeURIComponent(String(noteId))}`;
}

export function gitlabMergeRequestCoordinate(projectId: string, iid: string | number): string {
  return `gitlab://project/${encodeURIComponent(projectId)}/merge-requests/${encodeURIComponent(String(iid))}`;
}

export function gitlabDiscussionCoordinate(projectId: string, iid: string | number, discussionId: string): string {
  return `${gitlabMergeRequestCoordinate(projectId, iid)}/discussions/${encodeURIComponent(discussionId)}`;
}

export function gitlabRepoFileCoordinate(projectId: string, path: string, ref: string): string {
  return `gitlab://project/${encodeURIComponent(projectId)}/repository/files/${encodeURIComponent(path)}?ref=${encodeURIComponent(ref)}`;
}

export function gitlabWikiPageCoordinate(projectId: string, slug: string): string {
  return `gitlab://project/${encodeURIComponent(projectId)}/wiki/${encodeURIComponent(slug)}`;
}

export function gitlabSnippetCoordinate(projectId: string, snippetId: string | number): string {
  return `gitlab://project/${encodeURIComponent(projectId)}/snippets/${encodeURIComponent(String(snippetId))}`;
}

export function gitlabPipelineCoordinate(projectId: string, pipelineId: string | number): string {
  return `gitlab://project/${encodeURIComponent(projectId)}/pipelines/${encodeURIComponent(String(pipelineId))}`;
}

export function gitlabReleaseCoordinate(projectId: string, tagName: string): string {
  return `gitlab://project/${encodeURIComponent(projectId)}/releases/${encodeURIComponent(tagName)}`;
}

export function parseGitlabContextCoordinate(id: string): ParsedCoordinate {
  const url = new URL(id);
  if (url.protocol !== "gitlab:" || url.hostname !== "project") {
    throw new Error(`invalid GitLab context coordinate: ${id}`);
  }
  const parts = url.pathname.split("/").filter((part) => part.length > 0).map(decodeURIComponent);
  if (parts.length < 2) {
    throw new Error(`invalid GitLab context coordinate path: ${id}`);
  }
  const [_projectId, collection, ...rest] = parts;
  switch (collection) {
    case "issues":
      if (rest[1] === "notes") {
        return {
          kind: "issue_note",
          issueIid: requiredPart(rest[0], id),
          noteId: requiredPart(rest[2], id),
        };
      }
      return { kind: "issue", issueIid: requiredPart(rest[0], id) };
    case "merge-requests":
      if (rest[1] === "discussions") {
        return {
          kind: "discussion",
          mergeRequestIid: requiredPart(rest[0], id),
          discussionId: requiredPart(rest[2], id),
        };
      }
      return { kind: "merge_request", mergeRequestIid: requiredPart(rest[0], id) };
    case "repository":
      if (rest[0] !== "files") throw new Error(`unsupported repository coordinate: ${id}`);
      return {
        kind: "repo_file",
        path: requiredPart(rest[1], id),
        ref: url.searchParams.get("ref") ?? "main",
      };
    case "wiki":
      return { kind: "wiki_page", slug: requiredPart(rest[0], id) };
    case "snippets":
      return { kind: "snippet", snippetId: requiredPart(rest[0], id) };
    case "pipelines":
      return { kind: "pipeline", pipelineId: requiredPart(rest[0], id) };
    case "releases":
      return { kind: "release", tagName: requiredPart(rest[0], id) };
    default:
      throw new Error(`unsupported GitLab context coordinate collection '${collection}'`);
  }
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_LIMIT;
  if (!Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.floor(limit), 1), 100);
}

function sortResults(results: ReadonlyArray<GitlabContextSearchResult>): GitlabContextSearchResult[] {
  return [...results].sort((a, b) => {
    const au = a.updatedAt ?? "";
    const bu = b.updatedAt ?? "";
    if (au !== bu) return bu.localeCompare(au);
    return a.title.localeCompare(b.title);
  });
}

function truncate(value: string, maxChars = 1_000): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 3))}...`;
}

function requiredPart(value: string | undefined, original: string): string {
  if (value === undefined || value.length === 0) {
    throw new Error(`invalid GitLab context coordinate path: ${original}`);
  }
  return value;
}

function normalizeNote(note: GitlabNoteRaw): Record<string, unknown> {
  return {
    id: note.id,
    body: note.body,
    system: note.system,
    createdAt: note.created_at,
    updatedAt: note.updated_at,
    authorUsername: note.author?.username,
    authorName: note.author?.name,
  };
}

function normalizeDiscussion(discussion: GitlabDiscussionRaw): Record<string, unknown> {
  return {
    id: discussion.id,
    individualNote: discussion.individual_note,
    notes: discussion.notes.map(normalizeNote),
  };
}

function normalizePipeline(pipeline: GitlabPipelineRaw): Record<string, unknown> {
  return {
    id: pipeline.id,
    status: pipeline.status,
    ref: pipeline.ref,
    sha: pipeline.sha,
    url: pipeline.web_url,
    updatedAt: pipeline.updated_at,
  };
}

function buildMergeRequestLinks(
  projectId: string,
  mr: GitlabMergeRequestSearchRaw,
  discussions: ReadonlyArray<GitlabDiscussionRaw> | undefined,
  options: GitlabContextExpandOptions,
): ReadonlyArray<{ readonly rel: string; readonly target: string }> {
  const links: Array<{ readonly rel: string; readonly target: string }> = [];
  if (options.includePipelineStatus === true && mr.head_pipeline !== undefined && mr.head_pipeline !== null) {
    links.push({ rel: "pipeline", target: gitlabPipelineCoordinate(projectId, mr.head_pipeline.id) });
  }
  if (options.includeLinkedObjects === true && discussions !== undefined) {
    for (const discussion of discussions) {
      links.push({ rel: "discussion", target: gitlabDiscussionCoordinate(projectId, mr.iid, discussion.id) });
    }
  }
  return links;
}
