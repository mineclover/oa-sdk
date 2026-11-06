/**
 * Marks a pipeline contract function whose body a later implementation phase fills in.
 * The phase id names the task in `docs/internal/architecture/pydantic-codegen-pipeline.md` §7.
 */
export function notImplemented(symbol: string, phase: 'P1a' | 'P1b' | 'P1c'): never {
  throw new Error(`${symbol} is not implemented yet (pydantic codegen ${phase})`)
}
