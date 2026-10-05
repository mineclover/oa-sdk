import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { findPnpmWorkspace } from '../../cli/lib/init/common/pnpm-workspace.js'

/**
 * `findPnpmWorkspace` decides where `oa-gen init` may write `workspace:*`, so
 * it must agree with pnpm on which directories are workspace members.
 */
describe('findPnpmWorkspace', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'oa-pnpm-workspace-')))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  const write = async (relativePath: string, content: string) => {
    const file = path.join(tmpDir, relativePath)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, content)
  }
  const writePackage = (directory: string, name?: string) =>
    write(path.join(directory, 'package.json'), JSON.stringify(name === undefined ? {} : { name }))
  const workspace = (patterns?: string[]) =>
    write('pnpm-workspace.yaml', patterns === undefined
      ? 'onlyBuiltDependencies:\n  - esbuild\n'
      : `packages:\n${patterns.map(pattern => `  - "${pattern}"`).join('\n')}\n`)
  const memberNames = async (project: string) => {
    const found = await findPnpmWorkspace(path.join(tmpDir, project))
    return found === undefined ? undefined : [...found.packages.keys()].sort()
  }

  it('finds nothing for a project outside any pnpm workspace', async () => {
    await writePackage('app', 'app')
    expect(await findPnpmWorkspace(path.join(tmpDir, 'app'))).toBeUndefined()
  })

  it('lists the members the packages globs match, the root included', async () => {
    await workspace(['packages/*', 'apps/*'])
    await writePackage('.', 'root')
    await writePackage('packages/core', '@oa-sdk/core')
    await writePackage('apps/web', 'web')
    await writePackage('packages/core/fixtures/nested', 'too-deep')
    await writePackage('tools/script', 'not-matched')

    const found = await findPnpmWorkspace(path.join(tmpDir, 'apps/web'))
    expect(found?.root).toBe(tmpDir)
    expect([...found!.packages.keys()].sort()).toEqual(['@oa-sdk/core', 'root', 'web'])
    expect(found!.packages.get('@oa-sdk/core')).toBe(path.join(tmpDir, 'packages/core'))
  })

  it('finds nothing for a project the globs do not match, or one without a manifest', async () => {
    await workspace(['packages/*'])
    await writePackage('packages/core', '@oa-sdk/core')
    await writePackage('tools/script', 'script')
    await fs.mkdir(path.join(tmpDir, 'packages/empty'), { recursive: true })

    expect(await memberNames('tools/script')).toBeUndefined()
    expect(await memberNames('packages/empty')).toBeUndefined()
    expect(await memberNames('packages/core')).toEqual(['@oa-sdk/core'])
  })

  it('treats the workspace root as a member whatever the globs say', async () => {
    await workspace(['packages/*', '!.'])
    await writePackage('.', 'root')
    expect(await memberNames('.')).toEqual(['root'])
  })

  it('removes the members a negated glob matches', async () => {
    await workspace(['packages/**', '!**/test/**', '!packages/legacy'])
    await writePackage('packages/core', '@oa-sdk/core')
    await writePackage('packages/legacy', 'legacy')
    await writePackage('packages/core/test/fixture', 'fixture')

    expect(await memberNames('packages/core')).toEqual(['@oa-sdk/core'])
    expect(await memberNames('packages/legacy')).toBeUndefined()
    expect(await memberNames('packages/core/test/fixture')).toBeUndefined()
  })

  it('makes the root the only member when the workspace file lists no packages', async () => {
    await workspace()
    await writePackage('.', 'root')
    await writePackage('packages/core', '@oa-sdk/core')

    expect(await memberNames('.')).toEqual(['root'])
    expect(await memberNames('packages/core')).toBeUndefined()
  })

  it('never finds members in node_modules, bower_components, or dot directories through wildcards', async () => {
    await workspace(['**'])
    await writePackage('.', 'root')
    await writePackage('deep/inside/lib', 'deep-lib')
    await writePackage('node_modules/dependency', 'dependency')
    await writePackage('lib/bower_components/legacy', 'legacy')
    await writePackage('.cache/copy', 'cached-copy')

    expect(await memberNames('deep/inside/lib')).toEqual(['deep-lib', 'root'])
    expect(await memberNames('node_modules/dependency')).toBeUndefined()
    expect(await memberNames('.cache/copy')).toBeUndefined()
  })

  it('matches dot directories only through a glob that spells the dot out', async () => {
    await workspace(['.config/*'])
    await writePackage('.config/tooling', 'tooling')
    expect(await memberNames('.config/tooling')).toEqual(['tooling'])
  })

  it('supports brace alternatives, character classes, and single-character wildcards', async () => {
    await workspace(['{apps,services}/*', 'lib-[ab]', 'tool?'])
    await writePackage('apps/web', 'web')
    await writePackage('services/api', 'api')
    await writePackage('lib-a', 'lib-a')
    await writePackage('lib-c', 'lib-c')
    await writePackage('tool1', 'tool1')
    await writePackage('tool12', 'tool12')

    expect(await memberNames('apps/web')).toEqual(['api', 'lib-a', 'tool1', 'web'])
  })

  it('uses the nearest workspace file above the project', async () => {
    await workspace(['*'])
    await writePackage('outer', 'outer')
    await write('outer/pnpm-workspace.yaml', 'packages:\n  - "inner/*"\n')
    await writePackage('outer/inner/app', 'inner-app')

    const found = await findPnpmWorkspace(path.join(tmpDir, 'outer/inner/app'))
    expect(found?.root).toBe(path.join(tmpDir, 'outer'))
    expect([...found!.packages.keys()].sort()).toEqual(['inner-app', 'outer'])
  })

  it('reads member names from package.yaml, and counts a package.json5 member without reading its name', async () => {
    await workspace(['packages/*'])
    await write('packages/yaml/package.yaml', 'name: yaml-package\n')
    await write('packages/json5/package.json5', "{ name: 'json5-package' }\n")

    expect(await memberNames('packages/yaml')).toEqual(['yaml-package'])
    expect(await memberNames('packages/json5')).toEqual(['yaml-package'])
  })

  it('finds nothing rather than guessing when the workspace file is unusable', async () => {
    await writePackage('packages/app', 'app')

    await write('pnpm-workspace.yaml', 'packages: [unclosed\n')
    expect(await memberNames('packages/app')).toBeUndefined()

    await write('pnpm-workspace.yaml', 'packages: packages/*\n')
    expect(await memberNames('packages/app')).toBeUndefined()

    await workspace(['packages/!(legacy)'])
    expect(await memberNames('packages/app')).toBeUndefined()
  })

  it('finds the oa-sdk repository workspace from one of its packages', async () => {
    const found = await findPnpmWorkspace(path.resolve(__dirname, '../../..'))
    expect(found?.root).toBe(await fs.realpath(path.resolve(__dirname, '../../../../..')))
    expect([...found!.packages.keys()]).toEqual(expect.arrayContaining([
      '@oa-sdk/codegen',
      '@oa-sdk/core',
      '@oa-sdk/personas',
      '@oa-sdk/playground',
    ]))
  })
})
