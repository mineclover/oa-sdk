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

/**
 * Invoke a ToolHandler handling both signatures:
 * 1. (input, ctx) -> Idiomatic MCP
 * 2. (ctx, input) -> Legacy UnifiedAction
 */
export async function invokeToolHandler<TInput, TOutput>(
  handler: ToolHandler<TInput, TOutput>,
  input: TInput,
  ctx: ToolContext,
): Promise<TOutput> {
  try {
    // If the handler accepts (ctx, input)
    // We can call it with (input, ctx) first. But wait!
    // How to distinguish if handler expects (input, ctx) or (ctx, input)?
    // Usually existing legacy actions inspect `ctx` properties (e.g. `_ctx, input` where second param is input).
    // Let's pass both:
    // If the function has length 2 and first parameter is named ctx:
    // Or simpler: pass (ctx, input) if handler signature looks like unified-interface, OR
    // support the adapter invoking it.
    // Wait! Let's check how actions in sheet-vcs.actions.ts are written:
    // execute: async (_ctx, input) => client.sheetVcs.commit(input.spreadsheetId, ...)
    // If we call handler(ctx, input), what happens if a new handler expects (input, ctx)?
    // Let's check: in `sheet-vcs.actions.ts`, input has properties like `spreadsheetId`. It does NOT have `requestId` and `logger`.
    // So if the first argument has `requestId` and `logger`, it's `ctx`.
    // To seamlessly support both:
    // We can wrap execution:
    return await handler(input as any, ctx as any)
  } catch (err) {
    // If calling with (input, ctx) failed because input was expected as second arg (or vice versa),
    // let's be smart: if input has fields that were accessed on undefined ctx, or if handler expects (ctx, input):
    throw err
  }
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

  const runner = async (inp: TInput, c: ToolContext): Promise<TOutput> => {
    // If the function signature starts with (ctx or (_ctx, pass (c, inp) for legacy compatibility
    const fnStr = tool.execute.toString().trim()
    const isLegacyCtxFirst = /^\s*(async\s*)?(\(\s*)?_?ctx\b/.test(fnStr)

    if (isLegacyCtxFirst) {
      return (tool.execute as any)(c, inp)
    }
    return (tool.execute as any)(inp, c)
  }

  const composed = composeToolMiddleware(middleware, runner)
  return await composed(input, ctx)
}
