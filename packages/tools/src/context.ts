/**
 * @oa-sdk/tools — Context and Middleware Engine
 */
import { randomUUID } from 'node:crypto'
import type { ToolContext, ToolDefinition, ToolHandler, ToolLogger, ToolMiddleware } from './types.js'

/**
 * Standard console logger implementation
 */
export const defaultToolLogger: ToolLogger = {
  debug: (msg, ...args) => console.debug(`[DEBUG] ${msg}`, ...args),
  info: (msg, ...args) => console.info(`[INFO] ${msg}`, ...args),
  warn: (msg, ...args) => console.warn(`[WARN] ${msg}`, ...args),
  error: (msg, ...args) => console.error(`[ERROR] ${msg}`, ...args),
}

/**
 * Create a new ToolContext instance
 */
export function createToolContext(options?: Partial<ToolContext>): ToolContext {
  return {
    requestId: options?.requestId ?? randomUUID(),
    logger: options?.logger ?? defaultToolLogger,
    signal: options?.signal,
    meta: options?.meta ?? {},
  }
}

/**
 * Check if the first argument passed is a ToolContext
 */
export function isToolContext(val: unknown): val is ToolContext {
  return (
    typeof val === 'object' &&
    val !== null &&
    'requestId' in val &&
    'logger' in val &&
    typeof (val as Record<string, unknown>).requestId === 'string'
  )
}

/** Invoke the public (context, input) handler contract. */
export async function invokeToolHandler<TInput, TOutput>(
  handler: ToolHandler<TInput, TOutput>,
  input: TInput,
  ctx: ToolContext,
): Promise<TOutput> {
  return handler(ctx, input)
}

/** Explicitly adapt an older input-first handler to the public contract. */
export function adaptInputFirstHandler<TInput, TOutput>(
  handler: (input: TInput, ctx: ToolContext) => Promise<TOutput>,
): ToolHandler<TInput, TOutput> {
  return (ctx, input) => handler(input, ctx)
}

/**
 * Compose middleware chain for a tool
 */
export function composeToolMiddleware<TInput, TOutput>(
  middleware: ToolMiddleware<TInput, TOutput>[],
  execute: (input: TInput, ctx: ToolContext) => Promise<TOutput>,
): (input: TInput, ctx: ToolContext) => Promise<TOutput> {
  if (middleware.length === 0) {
    return execute
  }

  return (input: TInput, ctx: ToolContext) => {
    let index = -1

    const dispatch = async (i: number): Promise<TOutput> => {
      if (i <= index) {
        throw new Error('next() called multiple times')
      }
      index = i

      if (i < middleware.length) {
        const mw = middleware[i]!
        return mw(ctx, input, () => dispatch(i + 1))
      }
      return execute(input, ctx)
    }

    return dispatch(0)
  }
}

/**
 * Execute a tool definition with context and middleware
 */
export async function executeTool<TInput, TOutput>(
  tool: ToolDefinition<TInput, TOutput>,
  input: TInput,
  ctx: ToolContext = createToolContext(),
): Promise<TOutput> {
  const middleware = tool.middleware ?? []

  const runner = (inp: TInput, c: ToolContext): Promise<TOutput> =>
    invokeToolHandler(tool.execute, inp, c)

  const composed = composeToolMiddleware(middleware, runner)
  return await composed(input, ctx)
}
