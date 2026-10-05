/** Default to idempotent methods unless an operation explicitly overrides it. */
export function isOperationRetryable(operation: { method: string }): boolean {
  const explicit = 'x-oa-sdk-retryable' in operation ? operation['x-oa-sdk-retryable'] : undefined
  if (typeof explicit === 'boolean') return explicit
  return ['GET', 'HEAD', 'OPTIONS', 'DELETE'].includes(operation.method.toUpperCase())
}
