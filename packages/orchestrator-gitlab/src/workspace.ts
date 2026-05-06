import { mkdir, stat } from "node:fs/promises";
import { resolve } from "node:path";

import type { Issue, Workspace, WorkspaceManager } from "./types.js";

export interface FsWorkspaceOptions {
  /** Root directory under which per-issue workspaces are created. */
  readonly root: string;
  /** Project slug used to namespace workspaces — keep stable across runs. */
  readonly projectSlug: string;
  /**
   * Optional hook invoked once per workspace, when the directory is freshly
   * created. Typical use: `git clone`, dependency bootstrap.
   */
  readonly afterCreate?: (workspace: Readonly<Workspace>) => Promise<void>;
}

export class FsWorkspaceManager implements WorkspaceManager {
  readonly #opts: FsWorkspaceOptions;

  constructor(opts: FsWorkspaceOptions) {
    this.#opts = opts;
  }

  async ensure(issue: Readonly<Issue>): Promise<Workspace> {
    const key = sanitizeKey(`${this.#opts.projectSlug}-${issue.iid}`);
    const path = resolve(this.#opts.root, key);

    const existed = await pathExists(path);
    if (!existed) {
      await mkdir(path, { recursive: true });
    }

    const workspace: Workspace = {
      path,
      key,
      createdNow: !existed,
    };

    if (workspace.createdNow && this.#opts.afterCreate !== undefined) {
      await this.#opts.afterCreate(workspace);
    }

    return workspace;
  }
}

/**
 * Replace any character outside `[A-Za-z0-9._-]` with `_`. Mirrors the
 * Symphony SPEC §4.2 sanitization rule so we behave the same as the reference
 * implementation if anyone migrates back and forth.
 */
export function sanitizeKey(input: string): string {
  return input.replace(/[^A-Za-z0-9._-]/g, "_");
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw e;
  }
}
