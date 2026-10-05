import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { serializeRefProjectionArtifact } from '../cli/lib/ref-projection-artifact.js'
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

function runCli(args: string[]) {
  return spawnSync(process.execPath, [cliPath, 'ref-projection', '--root', workDir, ...args], {
    encoding: 'utf8',
    timeout: SUBPROCESS_TEST_BUDGET_MS,
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
      + '3 diagnostics -> out/first.json',
    )
    const firstText = readFileSync(join(workDir, 'out/first.json'), 'utf8')
    expect(readFileSync(join(workDir, 'out/second.json'), 'utf8')).toBe(firstText)
    expect(firstText).not.toContain(workDir)
  })

  it('exits 1 without writing output when an input is missing or invalid', () => {
    writeFileSync(join(workDir, 'broken.yaml'), 'openapi: [3.2.0\n')
    writeFileSync(join(workDir, 'bad-provenance.json'), JSON.stringify({ '#/paths/~1x': 'path:public/x/x' }))
    const cases: Array<{ args: string[]; stderr: RegExp }> = [
      { args: [], stderr: /--spec 옵션이 필요합니다/ },
      { args: ['--spec', 'absent.yaml'], stderr: /spec 파일을 읽을 수 없습니다/ },
      { args: ['--spec', 'broken.yaml'], stderr: /spec 파일을 파싱할 수 없습니다/ },
      { args: ['--spec', 'api.yaml', '--provenance', 'absent.json'], stderr: /provenance 파일을 읽을 수 없습니다/ },
      { args: ['--spec', 'api.yaml', '--provenance', 'bad-provenance.json'], stderr: /Invalid provenance entry/ },
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
