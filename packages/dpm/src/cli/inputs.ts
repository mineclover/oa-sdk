import { readDpmCliCatalogSnapshot } from './input-catalog.js'
import { readDpmCliEstimatedRows } from './input-estimated-rows.js'
import { readDpmCliStructuredFile } from './input-file.js'
import { readDpmCliRegistrySnapshot } from './input-registry.js'
import type { DpmCliInputs } from './input-types.js'
import type { DpmCliParsedArgs } from './types.js'

export type { DpmCliInputs } from './input-types.js'
export { readDpmCliCatalogSnapshot } from './input-catalog.js'
export { readDpmCliEstimatedRows } from './input-estimated-rows.js'
export {
  readDpmCliStructuredFile,
  readDpmCliTextFile,
} from './input-file.js'
export { readDpmCliRegistrySnapshot } from './input-registry.js'

export function readDpmCliInputs(args: DpmCliParsedArgs): DpmCliInputs {
  const estimatedRows = args.estimatedRowsPath ? readDpmCliEstimatedRows(args.estimatedRowsPath) : undefined
  return {
    manifest: readDpmCliStructuredFile(args.manifestPath),
    catalog: readDpmCliCatalogSnapshot(args.catalogPath),
    registry: readDpmCliRegistrySnapshot(args.registryPath),
    ...(estimatedRows ? { estimatedRows } : {}),
  }
}
