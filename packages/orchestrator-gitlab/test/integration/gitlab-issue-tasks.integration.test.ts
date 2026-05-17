/**
 * API-first GitLab issue task integration test against a real CE project.
 *
 * Required env:
 *   GITLAB_INTEGRATION_BASE_URL
 *   GITLAB_INTEGRATION_TOKEN
 *   GITLAB_INTEGRATION_PROJECT_ID
 */
import { describe, expect, it } from "vitest";

import { GitlabProjectClient } from "../../src/gitlab-client.js";
import { GitlabIssueTaskService } from "../../src/issue-tasks.js";
import { closeIssue, createIssue } from "./gitlab-helpers.js";

const ENV_BASE_URL = process.env.GITLAB_INTEGRATION_BASE_URL;
const ENV_TOKEN = process.env.GITLAB_INTEGRATION_TOKEN;
const ENV_PROJECT_ID = process.env.GITLAB_INTEGRATION_PROJECT_ID;

const ENABLED =
  ENV_BASE_URL !== undefined &&
  ENV_BASE_URL.length > 0 &&
  ENV_TOKEN !== undefined &&
  ENV_TOKEN.length > 0 &&
  ENV_PROJECT_ID !== undefined &&
  ENV_PROJECT_ID.length > 0;

const describeIfEnabled = ENABLED ? describe : describe.skip;

describeIfEnabled("GitLab CE issue task management", () => {
  it("returns and mutates remaining tasks for a specific issue", async () => {
    const ctx = {
      baseUrl: ENV_BASE_URL as string,
      token: ENV_TOKEN as string,
      projectId: ENV_PROJECT_ID as string,
    };
    const service = new GitlabIssueTaskService({
      client: new GitlabProjectClient(ctx),
    });
    const marker = `issue-task-${Date.now().toString(36)}`;
    const issue = await createIssue(ctx, {
      title: `Issue task lookup ${marker}`,
      description: [
        "- [ ] Write release notes",
        "- [x] Publish dry-run evidence",
        "1. [ ] Confirm GitLab Markdown payload",
      ].join("\n"),
      labels: [],
    });

    try {
      const report = await service.getIssueTasks(issue.iid);

      expect(report.iid).toBe(String(issue.iid));
      expect(report.summary.count).toBeGreaterThanOrEqual(3);
      expect(report.remainingTasks.map((task) => task.text)).toEqual([
        "Write release notes",
        "Confirm GitLab Markdown payload",
      ]);

      const added = await service.addIssueTask(issue.iid, "Publish release note");
      expect(added.remainingTasks.map((task) => task.text)).toEqual([
        "Write release notes",
        "Confirm GitLab Markdown payload",
        "Publish release note",
      ]);

      const checked = await service.updateIssueTask(issue.iid, 1, { checked: true });
      expect(checked.remainingTasks.map((task) => task.text)).toEqual([
        "Confirm GitLab Markdown payload",
        "Publish release note",
      ]);

      const deleted = await service.deleteIssueTask(issue.iid, 3);
      expect(deleted.remainingTasks.map((task) => task.text)).toEqual([
        "Publish release note",
      ]);
    } finally {
      await closeIssue(ctx, issue.iid);
    }
  });
});
