import { randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { dirname } from "node:path";

export function withFileLockSync<T>(
  filePath: string,
  work: () => T,
  options: { readonly maxWaitMs?: number; readonly staleAfterMs?: number; readonly retryMs?: number } = {},
): T {
  const lockPath = `${filePath}.lock`;
  const parent = dirname(filePath);
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
  const maxWaitMs = Math.max(1, options.maxWaitMs ?? 60_000);
  const staleAfterMs = Math.max(1, options.staleAfterMs ?? 60_000);
  const retryMs = Math.max(1, options.retryMs ?? 2);
  const startedAt = Date.now();
  const token = `${process.pid}:${randomBytes(12).toString("hex")}`;
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  let lockFd: number | undefined;

  while (lockFd === undefined) {
    try {
      lockFd = openSync(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
      writeFileSync(lockFd, `${token}\n`, { encoding: "utf8" });
      fsyncSync(lockFd);
    } catch (error) {
      if (lockFd !== undefined) {
        try { closeSync(lockFd); } catch { /* best effort */ }
        try { unlinkSync(lockPath); } catch { /* best effort */ }
        lockFd = undefined;
      }
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        const age = Date.now() - statSync(lockPath).mtimeMs;
        if (age >= staleAfterMs) {
          unlinkSync(lockPath);
          continue;
        }
      } catch {
        // Owner may have released lock between stat and unlink.
      }
      if (Date.now() - startedAt >= maxWaitMs) {
        const timeout = new Error(`FILE_LOCK_TIMEOUT:${filePath}`);
        (timeout as Error & { code?: string }).code = "FILE_LOCK_TIMEOUT";
        throw timeout;
      }
      Atomics.wait(sleeper, 0, 0, retryMs);
    }
  }

  try {
    return work();
  } finally {
    try { fsyncSync(lockFd); } catch { /* advisory */ }
    try { closeSync(lockFd); } catch { /* best effort */ }
    try { unlinkSync(lockPath); } catch { /* already removed */ }
  }
}

export function appendDurableLineSync(filePath: string, line: string): void {
  const fd = openSync(filePath, constants.O_CREAT | constants.O_APPEND | constants.O_WRONLY, 0o600);
  try {
    writeSync(fd, line, undefined, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

export function readDurableJsonLinesSync<T>(filePath: string, errorCode: string): T[] {
  const raw = readFileSync(filePath, "utf8");
  if (raw.length === 0) return [];
  const terminated = raw.endsWith("\n");
  const lines = raw.split("\n");
  if (terminated) lines.pop();
  const rows: T[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (!line.trim()) throw new Error(`${errorCode}: empty row ${index + 1}`);
    try {
      rows.push(JSON.parse(line) as T);
    } catch {
      const suffix = !terminated && index === lines.length - 1 ? "truncated final row" : `row ${index + 1}`;
      throw new Error(`${errorCode}: ${suffix}`);
    }
  }
  return rows;
}
