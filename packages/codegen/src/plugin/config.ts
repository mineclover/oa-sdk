import {
  type TspConfig,
  type TspConfigInput,
  type TspPlugin,
  type TspPluginEntry,
  TspConfigValidationError,
} from './types.js'

function isTspPlugin(value: unknown): value is TspPlugin<unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && 'name' in value && typeof value.name === 'string'
}

/**
 * Whether a value is a usable plugin list entry: a plugin object (with a string `name`),
 * a `[plugin, options]` tuple, or a falsy placeholder (`false`, `null`, `undefined`).
 * Anything else is ignored by the pipeline.
 */
export function isTspPluginEntry(value: unknown): value is TspPluginEntry {
  if (value === false || value === null || value === undefined) return true
  if (Array.isArray(value)) return value.length >= 1 && value.length <= 2 && isTspPlugin(value[0])
  return isTspPlugin(value)
}

/**
 * Type-safe configuration helper for TypeSpec SSOT builds.
 */
export function defineTspConfig(config: TspConfig): TspConfig {
  return config
}

/**
 * Universal configuration helper matching openapi-ts conventions.
 */
export function defineConfig<T extends TspConfig>(config: T): T {
  return config
}

/**
 * Validates and normalizes a TspConfig object.
 */
export function validateTspConfig(raw: unknown): TspConfig {
  const details: string[] = []

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TspConfigValidationError('Configuration must be a non-null object', [
      'Expected an object configuration',
    ])
  }

  const config = raw as Record<string, unknown>

  // 1. Validate input
  if (!config.input) {
    details.push('Field "input" is required (.tsp file path or configuration object)')
  } else if (typeof config.input === 'string') {
    if (config.input.trim().length === 0) {
      details.push('Field "input" string cannot be empty')
    }
  } else if (typeof config.input === 'object' && !Array.isArray(config.input)) {
    const inputObj = config.input as Record<string, unknown>
    if (typeof inputObj.entrypoint !== 'string' || inputObj.entrypoint.trim().length === 0) {
      details.push('Field "input.entrypoint" must be a non-empty string')
    }
    if (inputObj.tspDir !== undefined && typeof inputObj.tspDir !== 'string') {
      details.push('Field "input.tspDir" must be a string if provided')
    }
  } else {
    details.push('Field "input" must be a string or an object with "entrypoint"')
  }

  // 2. Validate output / outputDir
  const output = config.output !== undefined ? config.output : config.outputDir
  if (output !== undefined && (typeof output !== 'string' || output.trim().length === 0)) {
    details.push('Field "output" / "outputDir" must be a non-empty string if provided')
  }

  // 3. Validate openApiVersion
  if (config.openApiVersion !== undefined) {
    const validVersions = ['3.0.0', '3.1.0', '3.2.0']
    if (!validVersions.includes(String(config.openApiVersion))) {
      details.push(
        `Field "openApiVersion" must be one of: ${validVersions.join(', ')} (received "${String(config.openApiVersion)}")`,
      )
    }
  }

  // 4. Validate plugins
  if (config.plugins !== undefined) {
    if (!Array.isArray(config.plugins)) {
      details.push('Field "plugins" must be an array if provided')
    }
  }

  if (details.length > 0) {
    throw new TspConfigValidationError(
      `Invalid TypeSpec configuration:\n${details.map(d => `  - ${d}`).join('\n')}`,
      details,
    )
  }

  const normalizedOutput = (output as string | undefined) ?? './src/generated'

  return {
    input: config.input as TspConfigInput,
    output: normalizedOutput,
    outputDir: normalizedOutput,
    openApiVersion: (config.openApiVersion as '3.0.0' | '3.1.0' | '3.2.0' | undefined) ?? '3.2.0',
    // Entries that are neither plugins, [plugin, options] tuples nor falsy placeholders are ignored
    // (the sorter would skip them as well); falsy placeholders are kept and skipped by the sorter.
    plugins: Array.isArray(config.plugins) ? config.plugins.filter(isTspPluginEntry) : [],
    dryRun: Boolean(config.dryRun),
    clean: config.clean !== undefined ? Boolean(config.clean) : true,
    format: config.format !== undefined ? Boolean(config.format) : true,
  }
}
