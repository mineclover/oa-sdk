import type {
  GetFileEntriesOptions,
  SpecSourceReadBudget,
} from '../../application/ports/spec-source.port.js'
import { resolveSpecLensTypeSpecSourceReadBudget } from '@oa-sdk/codegen/spec-lens'

export type SizedSourceCandidate = {
  relativePath: string
  size: number
}

export function resolveSourceReadBudget(
  options: GetFileEntriesOptions,
): SpecSourceReadBudget | undefined {
  const budget = options.readBudget
  if (options.sourceKind === 'typespec-bundle') {
    if (budget === undefined) {
      throw new Error('TypeSpec source reads require an explicit readBudget')
    }
    validateSourceReadBudget(budget)
    return budget
  }
  if (budget !== undefined) {
    throw new Error('readBudget is only valid for TypeSpec source reads')
  }
  return undefined
}

export function validateSourceReadBudget(budget: SpecSourceReadBudget): void {
  const canonical = resolveSpecLensTypeSpecSourceReadBudget()
  if (budget.schemaVersion !== 'oa-sdk.spec-lens.source-read-budget.v1') {
    throw new Error(`unsupported source read budget schema: ${String(budget.schemaVersion)}`)
  }
  for (const [name, value] of Object.entries({
    maxFiles: budget.maxFiles,
    maxFileBytes: budget.maxFileBytes,
    maxTotalBytes: budget.maxTotalBytes,
    maxConcurrency: budget.maxConcurrency,
  })) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`source read budget ${name} must be a positive safe integer`)
    }
  }
  if (budget.maxFileBytes > budget.maxTotalBytes) {
    throw new Error('source read budget maxFileBytes must not exceed maxTotalBytes')
  }
  for (const key of ['maxFiles', 'maxFileBytes', 'maxTotalBytes', 'maxConcurrency'] as const) {
    if (budget[key] > canonical[key]) {
      throw new Error(`source read budget ${key} must not exceed canonical maximum ${canonical[key]}`)
    }
  }
}

export function assertSizedSourceCandidates(
  candidates: readonly SizedSourceCandidate[],
  budget: SpecSourceReadBudget,
  label: string,
): void {
  validateSourceReadBudget(budget)
  if (candidates.length > budget.maxFiles) {
    throw new Error(`${label} file count ${candidates.length} exceeds limit ${budget.maxFiles}`)
  }
  let totalBytes = 0
  for (const candidate of candidates) {
    if (!Number.isSafeInteger(candidate.size) || candidate.size < 0) {
      throw new Error(`${label} has missing or invalid size metadata: ${candidate.relativePath}`)
    }
    if (candidate.size > budget.maxFileBytes) {
      throw new Error(
        `${label} file ${candidate.relativePath} exceeds ${budget.maxFileBytes} bytes: ${candidate.size}`,
      )
    }
    totalBytes += candidate.size
    if (!Number.isSafeInteger(totalBytes) || totalBytes > budget.maxTotalBytes) {
      throw new Error(`${label} aggregate bytes exceed limit ${budget.maxTotalBytes}`)
    }
  }
}

export function createSourceReadTracker(budget: SpecSourceReadBudget, label: string) {
  validateSourceReadBudget(budget)
  let totalBytes = 0
  return {
    record(relativePath: string, bytes: number): void {
      if (!Number.isSafeInteger(bytes) || bytes < 0) {
        throw new Error(`${label} produced an invalid byte count for ${relativePath}`)
      }
      if (bytes > budget.maxFileBytes) {
        throw new Error(`${label} file ${relativePath} exceeds ${budget.maxFileBytes} bytes: ${bytes}`)
      }
      totalBytes += bytes
      if (!Number.isSafeInteger(totalBytes) || totalBytes > budget.maxTotalBytes) {
        throw new Error(`${label} aggregate bytes exceed limit ${budget.maxTotalBytes}`)
      }
    },
    get totalBytes(): number {
      return totalBytes
    },
  }
}

export type StreamingSourceReadLease = {
  readonly maxBytes: number
  readonly aggregateLimit: number
  acquireOverflowProbe(): Promise<() => void>
  complete(actualBytes: number): void
  fail(error: unknown): void
  registerCancel(cancel: () => void | Promise<void>): () => void
}

export type StreamingSourceReadTracker = {
  acquire(
    relativePath: string,
    declaredBytes: number | undefined,
    maxFileBytes: number,
  ): Promise<StreamingSourceReadLease>
  fail(error: unknown): void
  registerCancel(cancel: () => void | Promise<void>): () => void
  readonly committedBytes: number
  readonly failure: Error | undefined
}

/**
 * Coordinates bounded HTTP body reads that do not have source-size metadata.
 * Every body reserves the per-file cap because Content-Length is untrusted and
 * may under-report the bytes that the stream actually produces. When less than
 * one full per-file reservation remains, a single exclusive body reserves the
 * remainder and may use one BYOB byte only to detect overflow. Any failure
 * cancels all active readers and rejects queued acquisitions.
 */
export function createStreamingSourceReadTracker(
  budget: SpecSourceReadBudget,
  label: string,
): StreamingSourceReadTracker {
  validateSourceReadBudget(budget)
  let committedBytes = 0
  let reservedBytes = 0
  let activeLeases = 0
  let overflowProbeActive = false
  let failure: Error | undefined
  const waiters = new Set<() => void>()
  const overflowProbeWaiters = new Set<() => void>()
  const cancellations = new Set<() => void | Promise<void>>()

  const notifyWaiters = (): void => {
    const current = [...waiters]
    waiters.clear()
    for (const notify of current) notify()
  }

  const notifyOverflowProbeWaiters = (): void => {
    const current = [...overflowProbeWaiters]
    overflowProbeWaiters.clear()
    for (const notify of current) notify()
  }

  const fail = (error: unknown): void => {
    if (failure !== undefined) return
    failure = toError(error)
    for (const cancel of [...cancellations]) {
      try {
        void Promise.resolve(cancel()).catch(() => undefined)
      } catch {
        // The original source-read failure remains authoritative.
      }
    }
    notifyWaiters()
    notifyOverflowProbeWaiters()
  }

  const registerCancel = (cancel: () => void | Promise<void>): (() => void) => {
    if (failure !== undefined) {
      try {
        void Promise.resolve(cancel()).catch(() => undefined)
      } catch {
        // The source-read failure remains authoritative.
      }
      return () => undefined
    }
    cancellations.add(cancel)
    return () => cancellations.delete(cancel)
  }

  const acquireOverflowProbe = async (): Promise<() => void> => {
    while (true) {
      if (failure !== undefined) throw failure
      if (!overflowProbeActive) {
        overflowProbeActive = true
        let released = false
        return () => {
          if (released) return
          released = true
          overflowProbeActive = false
          notifyOverflowProbeWaiters()
        }
      }
      await new Promise<void>(resolveWait => overflowProbeWaiters.add(resolveWait))
    }
  }

  const acquire = async (
    relativePath: string,
    declaredBytes: number | undefined,
    maxFileBytes: number,
  ): Promise<StreamingSourceReadLease> => {
    if (!Number.isSafeInteger(maxFileBytes) || maxFileBytes <= 0 || maxFileBytes > budget.maxFileBytes) {
      throw new Error(`${label} has invalid per-file reservation for ${relativePath}: ${maxFileBytes}`)
    }
    if (declaredBytes !== undefined && (!Number.isSafeInteger(declaredBytes) || declaredBytes < 0)) {
      throw new Error(`${label} has invalid declared bytes for ${relativePath}: ${declaredBytes}`)
    }

    // Content-Length is useful for rejecting an obvious per-file overflow, but
    // it is not authoritative for aggregate accounting. Reserving maxFileBytes
    // prevents several under-reported bodies from each consuming an overflow
    // detection byte concurrently.
    let reservation = maxFileBytes
    while (true) {
      if (failure !== undefined) throw failure
      const remainingBytes = budget.maxTotalBytes - committedBytes - reservedBytes
      if (reservation <= remainingBytes) break

      if (activeLeases > 0) {
        await new Promise<void>(resolveWait => waiters.add(resolveWait))
        continue
      }

      // No other lease can release capacity now. Reserve the exact remainder;
      // the bounded BYOB reader may consume one extra byte only to prove that
      // the body does not fit. Because this lease is exclusive, that detection
      // byte cannot multiply by maxConcurrency.
      reservation = Math.max(0, remainingBytes)
      break
    }

    reservedBytes += reservation
    activeLeases++
    let closed = false
    const leaseCancellations = new Set<() => void | Promise<void>>()

    const closeReservation = (actualBytes: number): void => {
      if (closed) return
      closed = true
      reservedBytes -= reservation
      activeLeases--
      for (const cancel of leaseCancellations) cancellations.delete(cancel)
      if (failure !== undefined) {
        notifyWaiters()
        throw failure
      }
      if (!Number.isSafeInteger(actualBytes) || actualBytes < 0 || actualBytes > reservation) {
        const error = new Error(`${label} aggregate bytes exceed limit ${budget.maxTotalBytes}`)
        fail(error)
        throw error
      }
      committedBytes += actualBytes
      if (committedBytes > budget.maxTotalBytes) {
        const error = new Error(`${label} aggregate bytes exceed limit ${budget.maxTotalBytes}`)
        fail(error)
        throw error
      }
      notifyWaiters()
    }

    return {
      maxBytes: reservation,
      aggregateLimit: budget.maxTotalBytes,
      acquireOverflowProbe,
      complete(actualBytes): void {
        closeReservation(actualBytes)
      },
      fail(error): void {
        if (!closed) {
          closed = true
          reservedBytes -= reservation
          activeLeases--
          for (const cancel of leaseCancellations) cancellations.delete(cancel)
        }
        fail(error)
      },
      registerCancel(cancel): () => void {
        if (failure !== undefined) {
          try {
            void Promise.resolve(cancel()).catch(() => undefined)
          } catch {
            // The source-read failure remains authoritative.
          }
          return () => undefined
        }
        leaseCancellations.add(cancel)
        cancellations.add(cancel)
        return () => {
          leaseCancellations.delete(cancel)
          cancellations.delete(cancel)
        }
      },
    }
  }

  return {
    acquire,
    fail,
    registerCancel,
    get committedBytes(): number {
      return committedBytes
    },
    get failure(): Error | undefined {
      return failure
    },
  }
}

export async function withSourceReadConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  maxConcurrency: number,
): Promise<T[]> {
  if (!Number.isSafeInteger(maxConcurrency) || maxConcurrency <= 0) {
    throw new Error('source read concurrency must be a positive safe integer')
  }
  const results: T[] = new Array(tasks.length)
  let next = 0
  let stopped = false
  let hasFailure = false
  let firstFailure: unknown
  async function worker(): Promise<void> {
    while (!stopped && next < tasks.length) {
      const index = next++
      try {
        results[index] = await tasks[index]!()
      } catch (error) {
        stopped = true
        if (!hasFailure) {
          hasFailure = true
          firstFailure = error
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(maxConcurrency, tasks.length) }, worker))
  if (hasFailure) throw firstFailure
  return results
}

export async function readResponseBytesBounded(
  response: Response,
  maxBytes: number,
  label: string,
  aggregate?: {
    tracker: StreamingSourceReadTracker
    relativePath: string
  },
): Promise<Buffer> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error(`${label} byte cap must be a positive safe integer`)
  }
  let declaredBytes: number | undefined
  try {
    const contentLength = response.headers.get('content-length')
    if (contentLength !== null) {
      if (!/^\d+$/.test(contentLength)) {
        throw new Error(`${label} has invalid Content-Length: ${contentLength}`)
      }
      declaredBytes = Number(contentLength)
      if (!Number.isSafeInteger(declaredBytes) || declaredBytes > maxBytes) {
        throw new Error(`${label} Content-Length exceeds ${maxBytes} bytes: ${contentLength}`)
      }
    }
  } catch (error) {
    aggregate?.tracker.fail(error)
    if (response.body !== null) await response.body.cancel().catch(() => undefined)
    throw error
  }

  let lease: StreamingSourceReadLease | undefined
  if (aggregate !== undefined) {
    try {
      lease = await aggregate.tracker.acquire(
        aggregate.relativePath,
        declaredBytes,
        maxBytes,
      )
    } catch (error) {
      if (response.body !== null) await response.body.cancel().catch(() => undefined)
      throw error
    }
  }
  if (response.body === null) {
    lease?.complete(0)
    return Buffer.alloc(0)
  }

  let reader: BoundedResponseReader
  try {
    reader = createBoundedResponseReader(response.body, aggregate !== undefined)
  } catch (error) {
    lease?.fail(error)
    await response.body.cancel().catch(() => undefined)
    throw error
  }
  let cancelPromise: Promise<void> | undefined
  const cancelReader = (): Promise<void> => {
    cancelPromise ??= reader.cancel()
    return cancelPromise
  }
  const unregisterCancel = lease?.registerCancel(cancelReader)
  const chunks: Buffer[] = []
  let totalBytes = 0
  let releaseOverflowProbe: (() => void) | undefined
  try {
    while (true) {
      const aggregateCap = lease?.maxBytes ?? maxBytes
      const remaining = Math.min(maxBytes, aggregateCap) - totalBytes
      if (lease !== undefined && remaining <= 0) {
        releaseOverflowProbe = await lease.acquireOverflowProbe()
      }
      const { done, value } = await reader.read(remaining > 0 ? remaining : 1)
      if (done) {
        releaseOverflowProbe?.()
        releaseOverflowProbe = undefined
        break
      }
      if (value === undefined) throw new Error(`${label} returned an empty stream chunk`)
      const chunk = Buffer.from(value)
      totalBytes += chunk.byteLength
      if (totalBytes > maxBytes) {
        if (lease === undefined) await cancelReader()
        throw new Error(`${label} streamed body exceeds ${maxBytes} bytes`)
      }
      if (lease !== undefined && totalBytes > lease.maxBytes) {
        throw new Error(
          `${label} aggregate bytes exceed limit ${lease.aggregateLimit} while reading ${aggregate?.relativePath ?? label}`,
        )
      }
      chunks.push(chunk)
    }
    lease?.complete(totalBytes)
  } catch (error) {
    lease?.fail(error)
    if (lease !== undefined) await cancelReader().catch(() => undefined)
    throw error
  } finally {
    releaseOverflowProbe?.()
    unregisterCancel?.()
    reader.releaseLock()
  }
  return Buffer.concat(chunks, totalBytes)
}

export async function readResponseTextBounded(
  response: Response,
  maxBytes: number,
  label: string,
  aggregate?: {
    tracker: StreamingSourceReadTracker
    relativePath: string
  },
): Promise<{ text: string; bytes: number }> {
  const bytes = await readResponseBytesBounded(response, maxBytes, label, aggregate)
  return { text: bytes.toString('utf8'), bytes: bytes.byteLength }
}

type BoundedResponseReader = {
  read(maxBytes: number): Promise<BoundedResponseReadResult>
  cancel(): Promise<void>
  releaseLock(): void
}

type BoundedResponseReadResult = {
  done: boolean
  value: Uint8Array | undefined
}

function createBoundedResponseReader(
  stream: ReadableStream<Uint8Array>,
  requireByteSizedReads: boolean,
): BoundedResponseReader {
  try {
    const reader = stream.getReader({ mode: 'byob' })
    return {
      async read(maxBytes): Promise<BoundedResponseReadResult> {
        const size = Math.max(1, Math.min(maxBytes, 64 * 1024))
        const result = await reader.read(new Uint8Array(size))
        return result
      },
      async cancel(): Promise<void> {
        await reader.cancel()
      },
      releaseLock(): void {
        reader.releaseLock()
      },
    }
  } catch (error) {
    if (requireByteSizedReads) {
      throw new Error(
        `bounded aggregate source reads require a byte-oriented response stream: ${toError(error).message}`,
      )
    }
    const reader = stream.getReader()
    return {
      read: () => reader.read(),
      async cancel(): Promise<void> {
        await reader.cancel()
      },
      releaseLock(): void {
        reader.releaseLock()
      },
    }
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
