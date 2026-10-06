import * as path from 'node:path'
import type { DetectedSchemaItem, TargetRuntime } from '../types.js'

/** The spec entry point `oa-gen init` records when the project has none yet. */
export const DEFAULT_SCHEMA_ENTRY = 'openapi.yaml'

/**
 * The spec entry point an `oa-gen init` run records as the `schemaEntry` of its spec target:
 * the detected or given one, else `openapi.yaml`. Relative paths are relative to the project root,
 * where package.json scripts run.
 */
export function schemaEntryOf(options: { detectedSchema?: DetectedSchemaItem | undefined }): string {
  return options.detectedSchema?.filePath ?? DEFAULT_SCHEMA_ENTRY
}

/**
 * A package.json script that runs `oa-gen` with `args`, through `bun x` on Bun. A path argument
 * takes `/` separators, which Node accepts on every platform; an argument with characters a shell
 * would interpret, such as a space, is double-quoted, which both POSIX shells and cmd.exe read as
 * one argument.
 */
export function oaGenScript(runtime: TargetRuntime, args: readonly string[]): string {
  return [runtime === 'bun' ? 'bun x oa-gen' : 'oa-gen', ...args.map(scriptArgument)].join(' ')
}

/** `filePath` with the separators of this platform replaced by `/`. */
export function scriptPath(filePath: string): string {
  return filePath.split(path.sep).join('/')
}

function scriptArgument(value: string): string {
  if (/^[\w@%+=:,./-]+$/.test(value)) return value
  return `"${value.replace(/["\\$`]/g, '\\$&')}"`
}
