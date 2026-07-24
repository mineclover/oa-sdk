/** Default to idempotent methods unless an operation explicitly overrides it. */
export function isOperationRetryable(operation: { method: string }): boolean {
  const explicit = (operation as unknown as Record<string, unknown>)['x-oa-sdk-retryable']
  if (typeof explicit === 'boolean') return explicit
  return ['GET', 'HEAD', 'OPTIONS', 'DELETE'].includes(operation.method.toUpperCase())
}
