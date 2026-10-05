import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { embeddedVersionTables } from './embedded-workspace-versions.mjs'
import { readBuiltAgainstVersions } from './workspace-versions.mjs'

/**
 * The archetypes `oa-gen init` scaffolds, each with the `@oa-sdk` packages besides codegen that it
 * must write and the private ones it must leave out, outside a workspace. Every archetype must
 * write codegen, and every `@oa-sdk` package any of them writes must carry its built-against
 * range; the lists name the packages only some archetypes use, so that the smoke fails when the
 * packed init stops writing or reporting them rather than checking fewer packages.
 */
const INIT_ARCHETYPES = [
  { id: 'mvp', writes: [], omits: [] },
  { id: 'microservice', writes: ['@oa-sdk/core'], omits: [] },
  { id: 'enterprise', writes: ['@oa-sdk/core'], omits: ['@oa-sdk/personas'] },
]

const packageDirectory = new URL('..', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'oa-sdk-codegen-pack-'))

try {
  execFileSync('pnpm', ['pack', '--pack-destination', temporaryDirectory], {
    cwd: packageDirectory,
    stdio: 'inherit',
  })

  const archives = readdirSync(temporaryDirectory).filter(file => file.endsWith('.tgz'))
  if (archives.length !== 1) throw new Error(`expected one packed archive, received ${archives.length}`)

  const archive = join(temporaryDirectory, archives[0])
  const files = new Set(execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .map(file => file.replace(/^package\//, '')))
  const packedManifest = JSON.parse(execFileSync('tar', ['-xOf', archive, 'package/package.json'], { encoding: 'utf8' }))

  const expected = new Set(['package.json', 'README.md', 'LICENSE'])
  for (const entry of Object.values(manifest.exports)) {
    expected.add(stripRelativePrefix(entry.import))
    expected.add(stripRelativePrefix(entry.types))
  }
  for (const entry of Object.values(manifest.bin ?? {})) expected.add(stripRelativePrefix(entry))

  const missing = [...expected].filter(file => !files.has(file))
  const outsideBoundary = [...files].filter(file => file !== 'package.json' && file !== 'README.md' && file !== 'LICENSE' && !file.startsWith('dist/'))
  const workspaceDependency = Object.entries({
    ...(packedManifest.dependencies ?? {}),
    ...(packedManifest.optionalDependencies ?? {}),
    ...(packedManifest.peerDependencies ?? {}),
  }).find(([, version]) => typeof version === 'string' && version.startsWith('workspace:'))

  if (missing.length > 0) throw new Error(`packed oa-gen is missing expected files: ${missing.join(', ')}`)
  if (outsideBoundary.length > 0) throw new Error(`packed oa-gen has files outside its boundary: ${outsideBoundary.join(', ')}`)
  if (workspaceDependency) throw new Error(`packed oa-gen retains workspace protocol: ${workspaceDependency[0]}=${workspaceDependency[1]}`)

  // A package the packed code imports but the manifest does not declare is absent from a
  // published install (devDependencies are not installed). Only companion packages may be
  // undeclared, and only behind a dynamic import, which the companion loader turns into an
  // install hint instead of a crash.
  execFileSync('tar', ['-xzf', archive, '-C', temporaryDirectory])
  const companions = new Set(
    packageImports(fileURLToPath(new URL('../src/cli/lib/companion-packages.ts', import.meta.url)))
      .filter(entry => entry.dynamic)
      .map(entry => entry.packageName),
  )
  if (companions.size === 0) throw new Error('companion loader imports no companion package; the smoke cannot find them')
  const unresolvable = undeclaredPackageImports(join(temporaryDirectory, 'package'), packedManifest, companions)
  if (unresolvable.length > 0) {
    throw new Error(`packed oa-gen imports packages a published install cannot resolve: ${unresolvable.join('; ')}`)
  }

  // `oa-gen init` in a consumer outside any workspace must write specifiers a registry install
  // accepts: npm rejects the `workspace:` protocol, so each @oa-sdk package gets the range of the
  // version this codegen was built against, and a private package, which no registry has, is left
  // out and reported. Every archetype runs, as each scaffolds its own @oa-sdk packages. The packed
  // CLI runs against this package's own dependencies, linked next to it as an install would place
  // them.
  const builtAgainst = readBuiltAgainstVersions(fileURLToPath(packageDirectory))
  symlinkSync(fileURLToPath(new URL('../node_modules', import.meta.url)), join(temporaryDirectory, 'package', 'node_modules'), 'dir')
  const scaffolds = INIT_ARCHETYPES.map(archetype =>
    runPackedInit(join(temporaryDirectory, 'package', manifest.bin['oa-gen']), join(temporaryDirectory, `consumer-${archetype.id}`), archetype))
  for (const { archetype, specifiers, omitted } of scaffolds) {
    const described = `${archetype.id}: ${specifiers.map(([name, specifier]) => `${name}=${specifier}`).join(', ') || '(none)'}`
    const unpinned = specifiers.filter(([name, specifier]) => builtAgainst[name] === undefined || specifier !== `^${builtAgainst[name]}`)
    const missing = [manifest.name, ...archetype.writes].filter(name => !specifiers.some(([written]) => written === name))
    if (unpinned.length > 0 || missing.length > 0) {
      throw new Error(
        `packed oa-gen init must write the built-against range of every @oa-sdk package outside a workspace` +
          `${missing.length > 0 ? ` (missing ${missing.join(', ')})` : ''}, received ${described}`,
      )
    }
    const unreported = archetype.omits.filter(name =>
      specifiers.some(([written]) => written === name) || !omitted.includes(name))
    if (unreported.length > 0) {
      throw new Error(
        `packed oa-gen init must leave out and report the private packages ${unreported.join(', ')} ` +
          `outside a workspace, received ${described}; reported as not added: ${omitted.join(', ') || '(none)'}`,
      )
    }
  }

  // Install hints for a missing companion, and the specifiers `oa-gen init` writes, name the
  // range this codegen supports, from the versions the build embeds (tsup.config.ts); they must
  // be the versions it was built against of the companions, of codegen itself, and of every
  // package an init scaffold writes.
  const embeddedPackages = [...new Set([
    ...companions,
    manifest.name,
    ...scaffolds.flatMap(({ specifiers }) => specifiers.map(([name]) => name)),
  ])]
  const embeddedTables = embeddedVersionTables(join(temporaryDirectory, 'package'), embeddedPackages)
  const unembedded = embeddedPackages.filter(name =>
    builtAgainst[name] === undefined || !embeddedTables.some(table => table[name] === builtAgainst[name]))
  if (unembedded.length > 0) {
    throw new Error(
      `packed oa-gen does not embed the versions it was built against: ` +
        unembedded.map(name => `${name}@${builtAgainst[name] ?? '(not a workspace dependency)'}`).join(', '),
    )
  }

  console.log(
    `OA Gen pack smoke OK: ${files.size} files, no workspace protocols, every import declared ` +
      `or a dynamically loaded companion (${[...companions].map(name => `${name}@^${builtAgainst[name]}`).join(', ')}), ` +
      `init writes registry ranges (${scaffolds.map(({ archetype, specifiers, omitted }) =>
        `${archetype.id}: ${specifiers.map(([name, specifier]) => `${name}@${specifier}`).join(', ')}` +
          `${omitted.length > 0 ? `; leaves out ${omitted.join(', ')}` : ''}`).join(' | ')})`,
  )
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true })
}

function stripRelativePrefix(value) {
  return value.startsWith('./') ? value.slice(2) : value
}

/**
 * Runs the packed `oa-gen init --yes` for `archetype` in a new consumer project at `consumer`,
 * outside any workspace, and returns the `@oa-sdk` specifiers it wrote to package.json and the
 * packages it reported as not added.
 */
function runPackedInit(cli, consumer, archetype) {
  mkdirSync(consumer)
  writeFileSync(join(consumer, 'package.json'), `${JSON.stringify({ name: 'consumer', private: true }, null, 2)}\n`)
  const output = execFileSync(process.execPath, [cli, 'init', '--yes', '--archetype', archetype.id, '--cwd', consumer], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  const scaffolded = JSON.parse(readFileSync(join(consumer, 'package.json'), 'utf8'))
  const specifiers = Object.entries({
    ...scaffolded.dependencies,
    ...scaffolded.devDependencies,
    ...scaffolded.optionalDependencies,
    ...scaffolded.peerDependencies,
  }).filter(([name]) => name.startsWith('@oa-sdk/'))
  const omitted = [...output.matchAll(/"(@oa-sdk\/[^"]+)": not added \(/g)].map(match => match[1])
  return { archetype, specifiers, omitted }
}

/**
 * Imports of the packed JavaScript that a published install cannot resolve: a bare package
 * that is neither a Node built-in, the package itself, nor a declared dependency, optional
 * dependency, or peer dependency, unless it is a companion loaded with a dynamic import.
 */
function undeclaredPackageImports(packageRoot, packedManifest, companions) {
  const declared = new Set([
    packedManifest.name,
    ...Object.keys(packedManifest.dependencies ?? {}),
    ...Object.keys(packedManifest.optionalDependencies ?? {}),
    ...Object.keys(packedManifest.peerDependencies ?? {}),
  ])
  const unresolvable = new Map()
  for (const file of listFiles(packageRoot).filter(path => path.endsWith('.js'))) {
    for (const { packageName, dynamic } of packageImports(file)) {
      if (declared.has(packageName) || (dynamic && companions.has(packageName))) continue
      const label = `${packageName} (${dynamic ? 'dynamic' : 'static'})`
      const importers = unresolvable.get(label) ?? new Set()
      importers.add(relative(packageRoot, file))
      unresolvable.set(label, importers)
    }
  }
  return [...unresolvable].map(([label, importers]) => `${label} imported by ${[...importers].join(', ')}`)
}

/**
 * Bare package imports of a JavaScript or TypeScript module: import and export declarations
 * (static) and `import()` calls with a literal specifier (dynamic). The module is parsed, so
 * import statements inside generated-code string templates are not mistaken for imports.
 */
function packageImports(file) {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, false)
  const imports = []
  const record = (specifier, dynamic) => {
    const packageName = bareSpecifierPackage(specifier)
    if (packageName) imports.push({ packageName, dynamic })
  }
  const visit = node => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      if (!(ts.isImportDeclaration(node) && node.importClause?.isTypeOnly) && !(ts.isExportDeclaration(node) && node.isTypeOnly)) {
        record(node.moduleSpecifier.text, false)
      }
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [specifier] = node.arguments
      if (specifier && ts.isStringLiteralLike(specifier)) record(specifier.text, true)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return imports
}

function bareSpecifierPackage(specifier) {
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:')) return undefined
  if (/^[a-z][a-z0-9+.-]*:/i.test(specifier)) return undefined
  const segments = specifier.split('/')
  const packageName = specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0]
  return builtinModules.includes(packageName) ? undefined : packageName
}

function listFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? listFiles(path) : [path]
  })
}
