import {
  importCompanion,
  type CompanionImporter,
  type CompanionPackageName,
} from '../../cli/lib/companion-packages.js'

/**
 * The error Node's ESM loader raises for a bare specifier whose package is not
 * installed. `companion-packages.test.ts` checks this shape against a real
 * resolution failure.
 */
export function packageNotFoundError(
  packageName: string,
  importedFrom = '/consumer/node_modules/@oa-sdk/codegen/dist/cli/index.js',
): Error {
  return Object.assign(
    new Error(`Cannot find package '${packageName}' imported from ${importedFrom}`),
    { code: 'ERR_MODULE_NOT_FOUND' },
  )
}

/** Importer of a published install in which the `missing` packages were not installed. */
export function importerWithout(...missing: CompanionPackageName[]): CompanionImporter {
  return (name) => missing.includes(name)
    ? Promise.reject(packageNotFoundError(name))
    : importCompanion(name)
}
