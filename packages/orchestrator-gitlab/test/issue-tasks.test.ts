import { describe, expect, it, vi } from "vitest";

import { GitlabProjectClient } from "../src/gitlab-client.js";
import { GitlabIssueTaskService, parseGitLabIssueTasks } from "../src/issue-tasks.js";

describe("parseGitLabIssueTasks", () => {
  it("parses GitLab task list markers and leaves only unchecked applicable tasks as remaining", () => {
    const tasks = parseGitLabIssueTasks([
      "- [ ] write docs",
      "- [x] publish docs",
      "  * [X] nested done",
      "1. [ ] numbered task",
      "- [~] not applicable",
      "- normal bullet",
    ].join("\n"));

    expect(tasks).toEqual([
      { line: 1, text: "write docs", marker: "[ ]", checked: false, inapplicable: false },
      { line: 2, text: "publish docs", marker: "[x]", checked: true, inapplicable: false },
      { line: 3, text: "nested done", marker: "[X]", checked: true, inapplicable: false },
      { line: 4, text: "numbered task", marker: "[ ]", checked: false, inapplicable: false },
      { line: 5, text: "not applicable", marker: "[~]", checked: false, inapplicable: true },
    ]);
  });
});

describe("GitlabIssueTaskService", () => {
  it("fetches an issue and reports remaining tasks from its description", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      iid: 42,
      title: "Task issue",
      description: "- [ ] first\n- [x] done\n- [ ] second",
      state: "opened",
      web_url: "https://gitlab.example.com/group/project/-/issues/42",
      task_completion_status: { count: 3, completed_count: 1 },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const service = new GitlabIssueTaskService({
      client: new GitlabProjectClient({
        baseUrl: "https://gitlab.example.com",
        token: "tok",
        projectId: "group/project",
        fetchImpl,
      }),
    });

    await expect(service.getIssueTasks(42)).resolves.toEqual({
      iid: "42",
      title: "Task issue",
      url: "https://gitlab.example.com/group/project/-/issues/42",
      state: "opened",
      summary: { count: 3, completedCount: 1 },
      tasks: [
        { line: 1, text: "first", marker: "[ ]", checked: false, inapplicable: false },
        { line: 2, text: "done", marker: "[x]", checked: true, inapplicable: false },
        { line: 3, text: "second", marker: "[ ]", checked: false, inapplicable: false },
      ],
      remainingTasks: [
        { line: 1, text: "first", marker: "[ ]", checked: false, inapplicable: false },
        { line: 3, text: "second", marker: "[ ]", checked: false, inapplicable: false },
      ],
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://gitlab.example.com/api/v4/projects/group%2Fproject/issues/42",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("adds, updates, and deletes issue tasks through GitLab description updates", async () => {
    let description = "- [ ] first\n- [x] done";
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      if (init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as { description: string };
        description = body.description;
      }
      return new Response(JSON.stringify({
        iid: 42,
        title: "Task issue",
        description,
        state: "opened",
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const service = new GitlabIssueTaskService({
      client: new GitlabProjectClient({
        baseUrl: "https://gitlab.example.com",
        token: "tok",
        projectId: "group/project",
        fetchImpl,
      }),
    });

    await service.addIssueTask(42, " second task ");
    expect(description).toBe("- [ ] first\n- [x] done\n- [ ] second task");

    const updated = await service.updateIssueTask(42, 1, { checked: true, text: "first task" });
    expect(description).toBe("- [x] first task\n- [x] done\n- [ ] second task");
    expect(updated.remainingTasks.map((task) => task.text)).toEqual(["second task"]);

    const deleted = await service.deleteIssueTask(42, 2);
    expect(description).toBe("- [x] first task\n- [ ] second task");
    expect(deleted.tasks.map((task) => task.text)).toEqual(["first task", "second task"]);
  });
});
