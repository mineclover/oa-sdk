/**
 * Internal helper: project any option set onto exactly the semantic option keys.
 * Listing the keys explicitly lets the compiler check completeness instead of
 * asserting the shape of an `Object.fromEntries` result.
 */
import type { PydanticSemanticOptions } from './options.js'

export function pickPydanticSemanticOptions(options: Readonly<PydanticSemanticOptions>): PydanticSemanticOptions {
  const {
    extra, optionalStyle, naming, regex, enumStyle, datetime, uri, intBounds,
    encodingPolicy, extensions, docstrings, frozen, oneOfMode,
  } = options
  return {
    extra, optionalStyle, naming, regex, enumStyle, datetime, uri, intBounds,
    encodingPolicy, extensions, docstrings, frozen, oneOfMode,
  }
}
