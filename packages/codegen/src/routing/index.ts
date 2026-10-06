/**
 * @oa-sdk/codegen - Output Path Routing Customization Subsystem
 */

export {
  toKebabCase,
  toCamelCase,
  toPascalCase,
  splitWords,
  sanitizePathPreserve,
  casingTransformers,
  extractGroupFromPath,
  resolvePathPattern,
} from './token-resolver.js'
export type {
  CasingStyle,
  TokenContext,
  ResolveTokenOptions,
} from './token-resolver.js'

export {
  loadTsconfig,
  stripJsonComments,
  toPosixPath,
  formatExtension,
  matchTsconfigPathAlias,
  resolveImportSpecifier,
} from './import-resolver.js'
export type {
  ParsedTsconfig,
  ResolveImportOptions,
} from './import-resolver.js'

export {
  DEFAULT_BANNER_MARKERS,
  MANIFEST_PRODUCERS,
  OaManifestManager,
  manifestArtifactOwner,
} from './manifest-manager.js'
export type {
  ManifestArtifact,
  ManifestArtifactOwner,
  OaManifest,
  WriteArtifactInput,
  WriteArtifactResult,
  PruneOrphansOptions,
  PruneSkippedEntry,
  PruneResult,
} from './manifest-manager.js'

export {
  matchesRoutingRule,
  dispatchArtifactPath,
  PathDispatcher,
  createPathDispatcher,
} from './path-dispatcher.js'
export type {
  DispatchPathOptions,
  DispatchedArtifactPath,
} from './path-dispatcher.js'
