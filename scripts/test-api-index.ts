import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { apiIndexPackages, compareExportNames, extractDocNames, extractExportsFromFile } from './lib/api-index.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const temporary = mkdtempSync(join(tmpdir(), 'oa-api-index-'))
const write = (path: string, content: string) => {
  const absolute = join(temporary, path)
  mkdirSync(dirname(absolute), { recursive: true })
  writeFileSync(absolute, content)
  return absolute
}
try {
  // Only actual export declarations count, including async functions and $ names.
  const entry = write('extract/index.ts', [
    '/** export const Phantom = 1 */',
    'const example = "export interface Imaginary {}";',
    'export async function executeTool() {}',
    'export const $token = 1, other = 2;',
    'const local = 3; export { local as renamed };',
    'export type { Item as Input } from "./leaf.js";',
    'export * from "./leaf.js";',
    'export * as helpers from "./leaf.js";',
  ].join('\n'))
  write('extract/leaf.ts', 'export interface Item {}\nexport default function hidden() {}\nexport async function* stream() {}\nexport * from "./index.js";')
  assert.deepEqual([...extractExportsFromFile(entry).names].sort(), ['$token', 'Input', 'Item', 'executeTool', 'helpers', 'other', 'renamed', 'stream'].sort())
  const broken = write('extract/broken.ts', 'export * from "./missing.js";')
  assert.throws(() => extractExportsFromFile(broken), /Cannot resolve export/)
  assert.throws(() => extractExportsFromFile(join(temporary, 'missing.ts')), /ENOENT/)
  const malformed = write('extract/malformed.ts', 'export const = ;')
  assert.throws(() => extractExportsFromFile(malformed), /Cannot parse exports/)

  // Sibling package names and descriptive inline identifiers cannot contaminate exports.
  const docs = extractDocNames([
    '## Root (`@oa-sdk/chunk-stream`)', '| Export | Description |', '|---|---|', '| `Store` | uses `$ref` |',
    '## UI (`@oa-sdk/chunk-stream-ui`)', '| Export | Description |', '|---|---|', '| `Player` | uses `Store` |',
    '### 내부 (`@oa-sdk/chunk-stream`)', '| `Hidden` | internal |',
    '## Decorators (`@oa-sdk/typespec-decorators`)', '| Export | Description |', '| `$crdt` | decorator |',
    '## Extra (`@oa-sdk/chunk-stream/reader`)', '| Export | Description |', '| `OnlySubpath` | subpath |',
    '## Types (`@oa-sdk/parser`)', '| 파일 | 스펙 | 주요 타입 |', '| model.ts | spec | `Model<T>` |',
  ].join('\n'))
  assert.deepEqual([...docs.get('chunk-stream')!], ['Store'])
  assert.deepEqual([...docs.get('chunk-stream-ui')!], ['Player'])
  assert.deepEqual([...docs.get('chunk-stream/reader')!], ['OnlySubpath'])
  assert.deepEqual([...docs.get('typespec-decorators')!], ['$crdt'])
  assert.deepEqual([...docs.get('parser')!], ['Model'])
  assert.deepEqual(compareExportNames(new Set(['Store', 'missing']), new Set(['Store', 'stale'])), { missing: ['missing'], orphaned: ['stale'] })

  // Exercise the actual source CLI in an isolated repository without any dist build.
  const initialized = spawnSync('git', ['init', '-q', temporary], { encoding: 'utf8' })
  assert.equal(initialized.status, 0, initialized.stderr)
  const policy = { releaseTracked: ['@oa-sdk/tools', '@oa-sdk/chunk-stream', '@oa-sdk/chunk-stream-ui', '@oa-sdk/codegen', '@oa-sdk/schemas'], distributionCandidates: ['@oa-sdk/peer-transport'] }
  write('docs/internal/release-policy.json', JSON.stringify(policy))
  for (const [pkg, names] of Object.entries({ tools: ['executeTool'], 'chunk-stream': ['Store'], 'chunk-stream-ui': ['Player'], 'peer-transport': ['send'], dpm: ['Dpm'], codegen: ['TypegenOptions', 'SchemaToTsOptions'] })) {
    write(`packages/${pkg}/package.json`, JSON.stringify({ name: `@oa-sdk/${pkg}`, exports: { '.': { import: './dist/index.js', types: './dist/index.d.ts' }, ...(pkg === 'codegen' ? { './typegen': './dist/typegen/index.js' } : {}) } }))
    write(`packages/${pkg}/src/index.ts`, names.map(name => `export async function ${name}() {}`).join('\n'))
  }
  write('packages/codegen/src/typegen/index.ts', 'export type TypegenOptions = {}; export type SchemaToTsOptions = {};')
  write('packages/schemas/package.json', JSON.stringify({ name: '@oa-sdk/schemas', exports: { '.': './dist/openapi.json', './openapi.yaml': './dist/openapi.yaml' } }))
  const documentation = [
    ...Object.entries({ tools: ['executeTool'], 'chunk-stream': ['Store'], 'chunk-stream-ui': ['Player'], 'peer-transport': ['send'], dpm: ['Dpm'], codegen: ['TypegenOptions', 'SchemaToTsOptions'] }).flatMap(([pkg, names]) => [
      `## Surface (\`@oa-sdk/${pkg}\`)`, '| Export | Source |', '|---|---|', ...names.map(name => `| \`${name}\` | index.ts |`),
    ]),
    '@oa-sdk/codegen/typegen',
    '## Assets (`@oa-sdk/schemas`)', '| Export | Target |', '|---|---|', '| `.` | `./dist/openapi.json` |', '| `./openapi.yaml` | `./dist/openapi.yaml` |',
  ].join('\n')
  write('docs/internal/api-index.md', documentation)
  const require = createRequire(import.meta.url)
  const run = () => spawnSync(process.execPath, ['--import', require.resolve('tsx'), join(root, 'scripts/check-api-index.ts')], { cwd: temporary, encoding: 'utf8', timeout: 15_000, env: { ...process.env, GIT_DIR: undefined, GIT_WORK_TREE: undefined } })
  const clean = run()
  assert.equal(clean.status, 0, clean.stdout + clean.stderr)
  assert.match(clean.stdout, /7 packages/)
  write('docs/internal/api-index.md', documentation.replace('| `executeTool` | index.ts |', ''))
  const missing = run()
  assert.equal(missing.status, 1)
  assert.match(missing.stdout, /Missing from docs: `executeTool`/)
  write('docs/internal/api-index.md', documentation.replace('| `send` | index.ts |', '| `send`, `retired` | index.ts |'))
  const orphaned = run()
  assert.equal(orphaned.status, 1)
  assert.match(orphaned.stdout, /Orphaned in docs:.*`retired`/)
  write('docs/internal/api-index.md', documentation)
  rmSync(join(temporary, 'packages/tools/src/index.ts'))
  const unreadable = run()
  assert.equal(unreadable.status, 1)
  assert.match(unreadable.stdout, /ENOENT/)
  write('packages/tools/src/index.ts', 'export async function executeTool() {}')
  write('packages/tools/package.json', JSON.stringify({ name: '@oa-sdk/tools', exports: {} }))
  const removedRoot = run()
  assert.equal(removedRoot.status, 1)
  assert.match(removedRoot.stdout, /root export mapping/)
  write('packages/tools/package.json', JSON.stringify({ name: '@oa-sdk/tools', exports: { '.': { import: './dist/other.js', types: './dist/index.d.ts' } } }))
  const remappedRoot = run()
  assert.equal(remappedRoot.status, 1)
  assert.match(remappedRoot.stdout, /Root export must map/)
  write('packages/tools/package.json', JSON.stringify({ name: '@oa-sdk/tools', exports: { '.': { import: './dist/index.js', types: './dist/index.d.ts' } } }))
  write('docs/internal/release-policy.json', JSON.stringify({ ...policy, releaseTracked: [...policy.releaseTracked, '@oa-sdk/new-library'] }))
  assert.ok(apiIndexPackages(temporary).includes('new-library'))
  const untracked = run()
  assert.equal(untracked.status, 1)
  assert.match(untracked.stdout, /@oa-sdk\/new-library/)
  write('docs/internal/release-policy.json', JSON.stringify(policy))
  write('packages/schemas/package.json', JSON.stringify({ name: '@oa-sdk/schemas', exports: { '.': './dist/new.openapi.json' } }))
  const assets = run()
  assert.equal(assets.status, 1)
  assert.match(assets.stdout, /Undocumented schema asset/)
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  assert.equal(manifest.scripts['check:api-index'], 'node --import tsx scripts/check-api-index.ts')
  console.log('API index regression tests passed (AST, package isolation, policy inventory, source CLI, missing/orphaned exports, missing entrypoint, assets).')
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
