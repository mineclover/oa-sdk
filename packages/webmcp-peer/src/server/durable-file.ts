import { randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  ftruncateSync,
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

const NEWLINE = 0x0a;

/**
 * Appends `line` (which should end in "\n") and fsyncs it. The whole buffer is written, retrying
 * short writes, so a successful return always means the full line - terminating newline included -
 * reached the file. A row without its newline is therefore an append that never completed.
 */
export function appendDurableLineSync(filePath: string, line: string): void {
  const bytes = Buffer.from(line, "utf8");
  const fd = openSync(filePath, constants.O_CREAT | constants.O_APPEND | constants.O_WRONLY, 0o600);
  try {
    for (let offset = 0; offset < bytes.length;) {
      const written = writeSync(fd, bytes, offset, bytes.length - offset);
      if (written <= 0) throw new Error(`DURABLE_APPEND_INCOMPLETE:${filePath}`);
      offset += written;
    }
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/**
 * Removes a torn final row - bytes after the last "\n" left by an append that was interrupted
 * (crash, power loss) - so the next append starts on a row boundary. Works on byte offsets, so
 * multi-byte UTF-8 content in earlier rows is never cut. Call it while holding the file's lock
 * (`withFileLockSync`). Returns `true` when the file was truncated.
 */
export function truncateUnterminatedTailSync(filePath: string): boolean {
  if (!existsSync(filePath)) return false;
  const bytes = readFileSync(filePath);
  if (bytes.length === 0 || bytes[bytes.length - 1] === NEWLINE) return false;
  const fd = openSync(filePath, "r+");
  try {
    ftruncateSync(fd, bytes.lastIndexOf(NEWLINE) + 1);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  return true;
}

/** A named runtime validator for one JSONL row: `parse` returns the validated row or throws. */
export interface DurableJsonRowSchema<T> {
  parse(value: unknown): T;
}

export interface ReadDurableJsonLinesOptions {
  /**
   * Skip a final segment that is not terminated by "\n" instead of reading it. Appends write the
   * row and its newline together (`appendDurableLineSync`), so such a segment is an append that
   * never completed and was never acknowledged. Default `false`: the segment is read as a row, and
   * an unparsable one throws `"<errorCode>: truncated final row"`.
   */
  readonly ignoreUnterminatedTail?: boolean;
}

/**
 * Reads a JSONL file, validating every row with `schema`. Empty interior rows, unparsable rows and
 * rows the schema rejects throw `"<errorCode>: row <n>"` (the schema's error is the `cause`).
 */
export function readDurableJsonLinesSync<T>(
  filePath: string,
  errorCode: string,
  schema: DurableJsonRowSchema<T>,
  options: ReadDurableJsonLinesOptions = {},
): T[] {
  const raw = readFileSync(filePath, "utf8");
  if (raw.length === 0) return [];
  const lines = raw.split("\n");
  // The segment after the last "\n" is "" for a terminated file, otherwise an unterminated row.
  const tail = lines.pop()!;
  const readsTail = tail.length > 0 && options.ignoreUnterminatedTail !== true;
  if (readsTail) lines.push(tail);
  const rows: T[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (!line.trim()) throw new Error(`${errorCode}: empty row ${index + 1}`);
    try {
      rows.push(schema.parse(JSON.parse(line)));
    } catch (error) {
      const suffix = readsTail && index === lines.length - 1 ? "truncated final row" : `row ${index + 1}`;
      throw new Error(`${errorCode}: ${suffix}`, { cause: error });
    }
  }
  return rows;
}
