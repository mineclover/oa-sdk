import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { CliConfigDocumentSchema, CliConfigSchema } from '../cli-config.js'
import { resolveSpecProjectConfig } from '../domain/project.js'

const TYPESPEC_PROJECT_YAML = [
  'project:',
  '  kind: typespec-bundle',
  '  sourceRoot: packages/schemas/typespec',
  '  manifestPath: packages/schemas/typespec/oa-sdk.typespec-bundle.json',
]
const TYPESPEC_PROJECT = {
  kind: 'typespec-bundle',
  sourceRoot: 'packages/schemas/typespec',
  manifestPath: 'packages/schemas/typespec/oa-sdk.typespec-bundle.json',
}

describe('CliConfigSchema', () => {
  it('reads the documented local-git, github, and gitlab configurations', () => {
    expect(CliConfigSchema.parse(parseYaml([
      'source: local-git',
      'project:',
      '  kind: typespec-bundle',
      '  sourceRoot: packages/schemas/typespec',
      'localGit:',
      '  repoPath: ../repo',
      'port: 4891',
      'dbPath: .spec-lens.db',
    ].join('\n')))).toEqual({
      source: 'local-git',
      project: { kind: 'typespec-bundle', sourceRoot: 'packages/schemas/typespec' },
      localGit: { repoPath: '../repo' },
      port: 4891,
      dbPath: '.spec-lens.db',
    })

    expect(CliConfigSchema.parse({ source: 'github', github: { owner: 'o', repo: 'r', branch: 'main' }, branch: 'main' })).toEqual({
      source: 'github',
      github: { owner: 'o', repo: 'r', branch: 'main' },
      branch: 'main',
    })
    expect(CliConfigSchema.parse(JSON.parse('{"source":"gitlab","gitlab":{"projectId":42,"host":"https://gitlab.example"}}'))).toEqual({
      source: 'gitlab',
      gitlab: { projectId: 42, host: 'https://gitlab.example' },
    })
  })

  it('reads the local git repository when the config names no source', () => {
    expect(CliConfigSchema.parse(parseYaml([
      'project:',
      '  kind: typespec-bundle',
      '  sourceRoot: packages/schemas/typespec',
      '  manifestPath: packages/schemas/typespec/oa-sdk.typespec-bundle.json',
    ].join('\n')))).toEqual({
      source: 'local-git',
      project: {
        kind: 'typespec-bundle',
        sourceRoot: 'packages/schemas/typespec',
        manifestPath: 'packages/schemas/typespec/oa-sdk.typespec-bundle.json',
      },
    })
  })

  it('treats an empty config document as no configuration', () => {
    expect(CliConfigDocumentSchema.parse(parseYaml(''))).toBeNull()
    expect(CliConfigDocumentSchema.parse(parseYaml('# nothing yet\n'))).toBeNull()
    expect(CliConfigDocumentSchema.parse(JSON.parse('null'))).toBeNull()
    expect(CliConfigDocumentSchema.parse(parseYaml('port: 4891\n'))).toEqual({ source: 'local-git', port: 4891 })
    expect(() => CliConfigDocumentSchema.parse(parseYaml('- local-git\n'))).toThrow('config must be a mapping')
  })

  it('treats keys left empty as not set', () => {
    // The README's local-git example with its optional repoPath line commented out.
    expect(CliConfigSchema.parse(parseYaml([
      'source: local-git',
      'branch:',
      'localGit:',
      '  # repoPath: .',
      ...TYPESPEC_PROJECT_YAML,
      'port:',
      'dbPath:',
    ].join('\n')))).toEqual({ source: 'local-git', project: TYPESPEC_PROJECT })

    expect(CliConfigSchema.parse(parseYaml(['source:', ...TYPESPEC_PROJECT_YAML].join('\n')))).toEqual({
      source: 'local-git',
      project: TYPESPEC_PROJECT,
    })
    expect(CliConfigSchema.parse(parseYaml([
      'source: github',
      'github:',
      '  owner: acme',
      '  repo: api',
      '  branch:',
      '  # host: https://ghe.example.com',
      '  host:',
    ].join('\n')))).toEqual({ source: 'github', github: { owner: 'acme', repo: 'api' } })
    expect(CliConfigSchema.parse({ source: 'local-git', localGit: { repoPath: null } })).toEqual({ source: 'local-git', localGit: {} })
  })

  it('reads only the section of the selected source', () => {
    expect(CliConfigSchema.parse(parseYaml([
      'source: local-git',
      'github:',
      '  owner: acme',
      '  # repo: api',
      'gitlab:',
      ...TYPESPEC_PROJECT_YAML,
    ].join('\n')))).toEqual({ source: 'local-git', project: TYPESPEC_PROJECT })

    expect(CliConfigSchema.parse({
      source: 'github',
      github: { owner: 'acme', repo: 'api' },
      gitlab: { projectId: true },
      localGit: 'elsewhere',
    })).toEqual({ source: 'github', github: { owner: 'acme', repo: 'api' } })
  })

  it('leaves the project selection to resolveSpecProjectConfig', () => {
    const withProject = CliConfigSchema.parse(parseYaml([...TYPESPEC_PROJECT_YAML, 'fragmentsDir: 1', 'targetPath: 2'].join('\n')))
    expect(withProject).toMatchObject({ source: 'local-git', project: TYPESPEC_PROJECT, fragmentsDir: 1, targetPath: 2 })
    expect(resolveSpecProjectConfig(withProject)).toMatchObject({ kind: 'typespec-bundle', sourceRoot: 'packages/schemas/typespec' })

    const definitionBuilder = CliConfigSchema.parse({ fragmentsDir: 'packages/schemas/src/fragments', targetPath: 'packages/schemas/src/targets/admin-api.yaml' })
    expect(resolveSpecProjectConfig(definitionBuilder)).toEqual({
      kind: 'definition-builder',
      sourceRoot: 'packages/schemas/src/fragments',
      targetPath: 'packages/schemas/src/targets/admin-api.yaml',
    })
    expect(() => resolveSpecProjectConfig(CliConfigSchema.parse({ fragmentsDir: 'fragments', targetPath: 3 }))).toThrow('targetPath must be a non-empty string')
  })

  it('reads the port as a number or a numeric string, as the server listens on either', () => {
    expect(CliConfigSchema.parse(parseYaml('port: "4891"\n'))).toEqual({ source: 'local-git', port: 4891 })
    expect(CliConfigSchema.parse({ port: 0 })).toEqual({ source: 'local-git', port: 0 })
    expect(() => CliConfigSchema.parse({ port: 'http' })).toThrow('config.port must be an integer from 0 to 65535')
    expect(() => CliConfigSchema.parse({ port: '' })).toThrow('config.port must be an integer from 0 to 65535')
    expect(() => CliConfigSchema.parse({ port: 4891.5 })).toThrow('config.port must be an integer from 0 to 65535')
    expect(() => CliConfigSchema.parse({ port: 65_536 })).toThrow('config.port must be an integer from 0 to 65535')
  })

  it('rejects documents that break the configuration contract', () => {
    expect(() => CliConfigSchema.parse(['source', 'local-git'])).toThrow('config must be a mapping')
    expect(() => CliConfigSchema.parse({ source: 'svn' })).toThrow('config.source must be one of local-git, github, gitlab')
    expect(() => CliConfigSchema.parse({ source: 42 })).toThrow('config.source must be one of local-git, github, gitlab')
    expect(() => CliConfigSchema.parse({ source: 'github', github: { owner: 'o' } })).toThrow('config.github.repo must be a string')
    expect(() => CliConfigSchema.parse({ source: 'github' })).toThrow('config.github is required when source is github')
    expect(() => CliConfigSchema.parse(parseYaml('source: github\ngithub:\n'))).toThrow('config.github is required when source is github')
    expect(() => CliConfigSchema.parse({ source: 'github', github: { owner: 'o', repo: 'r', branch: 7 } })).toThrow('config.github.branch must be a string')
    expect(() => CliConfigSchema.parse({ source: 'gitlab', gitlab: { projectId: true } })).toThrow('config.gitlab.projectId must be a string or number')
    expect(() => CliConfigSchema.parse({ source: 'gitlab', gitlab: null })).toThrow('config.gitlab is required when source is gitlab')
    expect(() => CliConfigSchema.parse({ source: 'local-git', localGit: 'elsewhere' })).toThrow('config.localGit must be a mapping')
    expect(() => CliConfigSchema.parse({ localGit: { repoPath: 42 } })).toThrow('config.localGit.repoPath must be a string')
    expect(() => CliConfigSchema.parse({ dbPath: ['a.db'] })).toThrow('config.dbPath must be a string')
    expect(() => CliConfigSchema.parse({ branch: 1 })).toThrow('config.branch must be a string')
  })
})
