/**
 * @oa-sdk/mcp-mesh — CLI error reporting helpers
 */

/** Message of a thrown value: its `message` member when present, otherwise its string form. */
export function thrownMessage(error: unknown): string {
  const message: unknown = typeof error === 'object' && error !== null ? Reflect.get(error, 'message') : undefined
  return message === undefined || message === null ? String(error) : String(message)
}
