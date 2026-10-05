import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { stringify as stringifyYaml } from 'yaml'
import { serializeRefProjectionArtifact, type RefProjectionArtifact } from '../cli/lib/ref-projection-artifact.js'
import { createRefProjectionArtifactFromFiles } from '../cli/lib/ref-projection-files.js'
import { SUBPROCESS_TEST_BUDGET_MS } from './helpers/subprocess-budget.js'

const pkgDir = resolve(__dirname, '../..')
const cliPath = resolve(pkgDir, 'dist/cli/index.js')
const fixtureDir = resolve(pkgDir, 'test/fixtures/ref-projection')
const packageVersion = (JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')) as { version: string }).version

let workDir: string

beforeEach(() => {
  // A copy, so the command runs with the project root the test chooses.
  workDir = mkdtempSync(join(tmpdir(), 'oa-sdk-cli-ref-projection-'))
  cpSync(fixtureDir, workDir, { recursive: true })
})

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true })
})

function runCli(args: string[], root = workDir) {
  return runOaGen('ref-projection', root, args)
}

function runOaGen(command: string, root: string, args: string[]) {
  return spawnSync(process.execPath, [cliPath, command, '--root', root, ...args], {
    encoding: 'utf8',
    timeout: SUBPROCESS_TEST_BUDGET_MS,
  })
}

function writeYaml(filePath: string, value: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, stringifyYaml(value))
}

/** A definition-builder project: one target that emits a path and the schema it references. */
function writeBuildSpecProject(root: string): void {
  writeYaml(join(root, 'targets/public-api.yaml'), {
    name: 'public-api',
    scopes: ['public'],
    domains: ['book'],
    servers: [{ url: 'https://api.example.test' }],
    includePaths: ['/books'],
  })
  writeYaml(join(root, 'fragments/path/public/book/BooksPath.yaml'), {
    id: 'path:public/book/BooksPath',
    metadata: { path: '/books' },
    content: {
      get: {
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: 'oa://schema/public/book/Book' } },
              },
            },
          },
        },
      },
    },
  })
  writeYaml(join(root, 'fragments/schema/public/book/Book.yaml'), {
    id: 'schema:public/book/Book',
    content: { type: 'object', properties: { id: { type: 'string' } } },
  })
}

describe('oa-gen ref-projection', () => {
  it('writes the artifact to stdout, named after the codegen package that produced it', () => {
    const result = runCli(['--spec', 'api.yaml', '--provenance', 'provenance.json'])

    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(result.stdout).toBe(serializeRefProjectionArtifact(createRefProjectionArtifactFromFiles({
      specPath: 'api.yaml',
      provenancePath: 'provenance.json',
      root: workDir,
      generator: { name: '@oa-sdk/codegen', version: packageVersion },
    })))
  })

  it('writes byte-identical files on repeated runs and summarizes them on stdout', () => {
    const first = runCli(['--spec', 'api.yaml', '--provenance', 'provenance.json', '--output', 'out/first.json'])
    const second = runCli(['-s', 'api.yaml', '--provenance', 'provenance.json', '-o', 'out/second.json'])

    expect([first.status, second.status]).toEqual([0, 0])
    expect(first.stdout.trim()).toBe(
      'ref-projection: 13 nodes, 12 edges (recursion: 3 guarded, 2 unguarded), '
      + '6/13 nodes with canonicalId (unmapped: external-document 3, no-enclosing-provenance-entry 4), '
      + '5 diagnostics -> out/first.json',
    )
    const firstText = readFileSync(join(workDir, 'out/first.json'), 'utf8')
    expect(readFileSync(join(workDir, 'out/second.json'), 'utf8')).toBe(firstText)
    expect(firstText).not.toContain(workDir)
  })

  it('maps build-spec output to the same identities in every checkout', () => {
    const checkouts = [join(workDir, 'one'), join(workDir, 'two', 'nested')]
    const artifacts = checkouts.map((root) => {
      writeBuildSpecProject(root)
      const built = runOaGen('build-spec', root, [
        '--target', 'targets/public-api.yaml',
        '--output', 'out/api.yaml',
        '--provenance', 'out/provenance.json',
      ])
      expect(built.status, built.stderr).toBe(0)
      // build-spec records the absolute fragment paths of this checkout.
      expect(readFileSync(join(root, 'out/provenance.json'), 'utf8')).toContain(root)

      const projected = runCli([
        '--spec', 'out/api.yaml',
        '--provenance', 'out/provenance.json',
        '--output', 'out/ref-projection.json',
      ], root)
      expect(projected.status, projected.stderr).toBe(0)
      const text = readFileSync(join(root, 'out/ref-projection.json'), 'utf8')
      expect(text).not.toContain(root)
      return JSON.parse(text) as RefProjectionArtifact
    })

    const [first, second] = artifacts as [RefProjectionArtifact, RefProjectionArtifact]
    expect(first.nodes.map(node => [node.id, node.identity])).toEqual([
      ['#/components/schemas/Book', expect.objectContaining({
        status: 'mapped',
        canonicalId: 'schema:public/book/Book',
        sourcePath: 'fragments/schema/public/book/Book.yaml',
      })],
      ['#/paths/~1books', expect.objectContaining({
        status: 'mapped',
        canonicalId: 'path:public/book/BooksPath',
        sourcePath: 'fragments/path/public/book/BooksPath.yaml',
      })],
    ])
    // Only the hash of the provenance file differs: its bytes hold each
    // checkout's absolute paths.
    const withoutProvenanceHash = (artifact: RefProjectionArtifact) => ({
      ...artifact,
      source: { ...artifact.source, provenance: { ...artifact.source.provenance!, contentHash: '' } },
    })
    expect(withoutProvenanceHash(second)).toEqual(withoutProvenanceHash(first))
  })

  it('exits 1 without writing output when an input is missing or invalid', () => {
    writeFileSync(join(workDir, 'broken.yaml'), 'openapi: [3.2.0\n')
    writeFileSync(join(workDir, 'bad-provenance.json'), JSON.stringify({ '#/paths/~1x': 'path:public/x/x' }))
    // An empty canonicalId is reported against the input entry, not as an invalid artifact.
    writeFileSync(join(workDir, 'empty-id-provenance.json'), JSON.stringify({
      '#/components/schemas/Pet': {
        canonicalId: '',
        kind: 'schema',
        sourcePath: 'fragments/schema/pets/Pet.yaml',
        sourcePointer: '#',
        contentHash: `sha256:${'0'.repeat(64)}`,
      },
    }))
    const cases: Array<{ args: string[]; stderr: RegExp }> = [
      { args: [], stderr: /--spec 옵션이 필요합니다/ },
      { args: ['--spec', 'absent.yaml'], stderr: /spec 파일을 읽을 수 없습니다/ },
      { args: ['--spec', 'broken.yaml'], stderr: /spec 파일을 파싱할 수 없습니다/ },
      { args: ['--spec', 'api.yaml', '--provenance', 'absent.json'], stderr: /provenance 파일을 읽을 수 없습니다/ },
      { args: ['--spec', 'api.yaml', '--provenance', 'bad-provenance.json'], stderr: /Invalid provenance entry/ },
      {
        args: ['--spec', 'api.yaml', '--provenance', 'empty-id-provenance.json'],
        stderr: /Invalid provenance entry at #\/components\/schemas\/Pet: canonicalId must not be empty/,
      },
    ]
    for (const { args, stderr } of cases) {
      const result = runCli([...args, '--output', 'out/artifact.json'])
      expect(result.status, args.join(' ')).toBe(1)
      expect(result.stderr).toMatch(stderr)
      expect(result.stdout).toBe('')
      expect(existsSync(join(workDir, 'out/artifact.json'))).toBe(false)
    }
  })
})
