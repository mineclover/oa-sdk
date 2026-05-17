import { GitlabProjectClient } from "./gitlab-client.js";

export interface GitlabIssueTaskServiceOptions {
  readonly client: GitlabProjectClient;
}

export interface GitlabIssueTask {
  readonly line: number;
  readonly text: string;
  readonly checked: boolean;
  readonly inapplicable: boolean;
  readonly marker: "[ ]" | "[x]" | "[X]" | "[~]";
}

export interface GitlabIssueTaskSummary {
  readonly count: number;
  readonly completedCount: number;
}

export interface GitlabIssueTaskReport {
  readonly iid: string;
  readonly title: string;
  readonly url?: string | undefined;
  readonly state: string;
  readonly summary: GitlabIssueTaskSummary;
  readonly tasks: ReadonlyArray<GitlabIssueTask>;
  readonly remainingTasks: ReadonlyArray<GitlabIssueTask>;
}

export interface GitlabIssueTaskUpdate {
  readonly text?: string;
  readonly checked?: boolean;
  readonly inapplicable?: boolean;
}

interface GitlabIssueTaskRaw {
  readonly iid: number;
  readonly title: string;
  readonly description: string | null;
  readonly state: string;
  readonly web_url?: string;
  readonly task_completion_status?: {
    readonly count?: number;
    readonly completed_count?: number;
  };
}

export class GitlabIssueTaskService {
  readonly #client: GitlabProjectClient;

  constructor(opts: GitlabIssueTaskServiceOptions) {
    this.#client = opts.client;
  }

  async getIssueTasks(iid: string | number): Promise<GitlabIssueTaskReport> {
    return buildTaskReport(await this.#getIssue(iid));
  }

  async addIssueTask(iid: string | number, text: string): Promise<GitlabIssueTaskReport> {
    const raw = await this.#getIssue(iid);
    const description = raw.description ?? "";
    const nextDescription = appendTask(description, text);
    const updated = await this.#updateIssueDescription(iid, nextDescription);
    return buildTaskReport(updated);
  }

  async updateIssueTask(
    iid: string | number,
    line: number,
    update: GitlabIssueTaskUpdate,
  ): Promise<GitlabIssueTaskReport> {
    const raw = await this.#getIssue(iid);
    const nextDescription = updateTaskLine(raw.description ?? "", line, update);
    const updated = await this.#updateIssueDescription(iid, nextDescription);
    return buildTaskReport(updated);
  }

  async deleteIssueTask(iid: string | number, line: number): Promise<GitlabIssueTaskReport> {
    const raw = await this.#getIssue(iid);
    const nextDescription = deleteTaskLine(raw.description ?? "", line);
    const updated = await this.#updateIssueDescription(iid, nextDescription);
    return buildTaskReport(updated);
  }

  async #getIssue(iid: string | number): Promise<GitlabIssueTaskRaw> {
    return await this.#client.request<GitlabIssueTaskRaw>(
      "GET",
      this.#client.projectApiPath(`/issues/${encodeURIComponent(String(iid))}`),
    );
  }

  async #updateIssueDescription(iid: string | number, description: string): Promise<GitlabIssueTaskRaw> {
    return await this.#client.request<GitlabIssueTaskRaw>(
      "PUT",
      this.#client.projectApiPath(`/issues/${encodeURIComponent(String(iid))}`),
      { description },
    );
  }
}

export function parseGitLabIssueTasks(markdown: string): ReadonlyArray<GitlabIssueTask> {
  return markdown
    .split(/\r?\n/)
    .map((line, index) => parseTaskLine(line, index + 1))
    .filter((task): task is GitlabIssueTask => task !== undefined);
}

function parseTaskLine(line: string, lineNumber: number): GitlabIssueTask | undefined {
  const match = /^(\s*)(?:[-+*]|\d+[.)])\s+(\[[ xX~]\])\s+(.*)$/.exec(line);
  if (match === null) return undefined;
  const marker = match[2] as GitlabIssueTask["marker"];
  const text = (match[3] ?? "").trim();
  return {
    line: lineNumber,
    text,
    marker,
    checked: marker === "[x]" || marker === "[X]",
    inapplicable: marker === "[~]",
  };
}

function appendTask(description: string, text: string): string {
  const taskText = normalizeTaskText(text);
  if (description.trim().length === 0) return `- [ ] ${taskText}`;
  return `${description.replace(/\s+$/, "")}\n- [ ] ${taskText}`;
}

function updateTaskLine(markdown: string, line: number, update: GitlabIssueTaskUpdate): string {
  const lines = markdown.split(/\r?\n/);
  const targetIndex = line - 1;
  const currentLine = lines[targetIndex];
  if (line < 1 || currentLine === undefined) {
    throw new Error(`task line ${String(line)} does not exist`);
  }
  const match = /^(\s*)((?:[-+*]|\d+[.)])\s+)(\[[ xX~]\])\s+(.*)$/.exec(currentLine);
  if (match === null) {
    throw new Error(`line ${String(line)} is not a GitLab task list item`);
  }
  const marker = markerForUpdate(match[3] as GitlabIssueTask["marker"], update);
  const text = update.text === undefined ? (match[4] ?? "").trim() : normalizeTaskText(update.text);
  lines[targetIndex] = `${match[1] ?? ""}${match[2] ?? "- "}${marker} ${text}`;
  return lines.join("\n");
}

function deleteTaskLine(markdown: string, line: number): string {
  const lines = markdown.split(/\r?\n/);
  const targetIndex = line - 1;
  const currentLine = lines[targetIndex];
  if (line < 1 || currentLine === undefined) {
    throw new Error(`task line ${String(line)} does not exist`);
  }
  if (parseTaskLine(currentLine, line) === undefined) {
    throw new Error(`line ${String(line)} is not a GitLab task list item`);
  }
  lines.splice(targetIndex, 1);
  return lines.join("\n").replace(/\s+$/, "");
}

function markerForUpdate(
  current: GitlabIssueTask["marker"],
  update: GitlabIssueTaskUpdate,
): GitlabIssueTask["marker"] {
  if (update.inapplicable === true) return "[~]";
  if (update.checked === true) return "[x]";
  if (update.checked === false || update.inapplicable === false) return "[ ]";
  return current;
}

function normalizeTaskText(text: string): string {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (normalized.length === 0) {
    throw new Error("task text must be a non-empty string");
  }
  return normalized;
}

function buildTaskReport(raw: GitlabIssueTaskRaw): GitlabIssueTaskReport {
  const tasks = parseGitLabIssueTasks(raw.description ?? "");
  const summary = normalizeTaskSummary(raw, tasks);
  return {
    iid: String(raw.iid),
    title: raw.title,
    ...(raw.web_url !== undefined ? { url: raw.web_url } : {}),
    state: raw.state,
    summary,
    tasks,
    remainingTasks: tasks.filter((task) => !task.checked && !task.inapplicable),
  };
}

function normalizeTaskSummary(
  raw: GitlabIssueTaskRaw,
  tasks: ReadonlyArray<GitlabIssueTask>,
): GitlabIssueTaskSummary {
  const count = raw.task_completion_status?.count;
  const completedCount = raw.task_completion_status?.completed_count;
  if (typeof count === "number" && typeof completedCount === "number") {
    return { count, completedCount };
  }
  return {
    count: tasks.length,
    completedCount: tasks.filter((task) => task.checked).length,
  };
}
