import { describe, expect, it, vi } from "vitest";

import { GitlabDocumentSaveService } from "../src/document-save.js";
import { GitlabProjectClient } from "../src/gitlab-client.js";

function makeService(fetchImpl = vi.fn<typeof fetch>()) {
  const client = new GitlabProjectClient({
    baseUrl: "https://gitlab.example.com",
    token: "token",
    projectId: "payments/checkout",
    fetchImpl,
  });
  return { service: new GitlabDocumentSaveService({ client, defaultBranch: "main" }), fetchImpl };
}

describe("GitlabDocumentSaveService", () => {
  it("builds wiki update requests", () => {
    const { service } = makeService();

    expect(service.buildRequest({
      target: "wiki",
      path: "wiki/release-pipelines",
      title: "Release pipelines",
      markdown: "## Release pipelines",
    })).toEqual({
      method: "PUT",
      path: "/api/v4/projects/payments%2Fcheckout/wikis/release-pipelines",
      body: {
        title: "Release pipelines",
        content: "## Release pipelines",
      },
    });
  });

  it("builds repository file create requests", () => {
    const { service } = makeService();

    expect(service.buildRequest({
      target: "repository",
      path: "docs/release.md",
      title: "Release",
      markdown: "# Release",
      mode: "create",
      branch: "docs/release",
    })).toEqual({
      method: "POST",
      path: "/api/v4/projects/payments%2Fcheckout/repository/files/docs%2Frelease.md",
      body: {
        branch: "docs/release",
        content: "# Release",
        commit_message: "Create docs/release.md",
      },
    });
  });

  it("builds release update requests", () => {
    const { service } = makeService();

    expect(service.buildRequest({
      target: "release",
      path: "release/v2.4",
      title: "Release v2.4",
      markdown: "release body",
    })).toEqual({
      method: "PUT",
      path: "/api/v4/projects/payments%2Fcheckout/releases/v2.4",
      body: {
        name: "Release v2.4",
        description: "release body",
      },
    });
  });

  it("returns dry-run result without calling GitLab", async () => {
    const { service, fetchImpl } = makeService();

    const result = await service.save({
      target: "release",
      path: "release/v2.4",
      title: "Release v2.4",
      markdown: "release body",
    }, { dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(result.request.method).toBe("PUT");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("executes GitLab requests when dry-run is false", async () => {
    const response = new Response("{}", { status: 200 });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response);
    const { service } = makeService(fetchImpl);

    await service.save({
      target: "wiki",
      path: "wiki/release-pipelines",
      title: "Release pipelines",
      markdown: "content",
    }, { dryRun: false });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://gitlab.example.com/api/v4/projects/payments%2Fcheckout/wikis/release-pipelines",
      expect.objectContaining({
        method: "PUT",
        headers: expect.objectContaining({ "PRIVATE-TOKEN": "token" }),
      }),
    );
  });
});
