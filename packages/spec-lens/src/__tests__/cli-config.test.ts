import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { CliConfigSchema } from '../cli-config.js'

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

  it('rejects documents that break the configuration contract', () => {
    expect(() => CliConfigSchema.parse(['source', 'local-git'])).toThrow('config must be a mapping')
    expect(() => CliConfigSchema.parse({ source: 'svn' })).toThrow('config.source must be one of local-git, github, gitlab')
    expect(() => CliConfigSchema.parse({ source: 'github', github: { owner: 'o' } })).toThrow('config.github.repo must be a string')
    expect(() => CliConfigSchema.parse({ source: 'gitlab', gitlab: { projectId: true } })).toThrow('config.gitlab.projectId must be a string or number')
    expect(() => CliConfigSchema.parse({ source: 'local-git', port: '4891' })).toThrow('config.port must be an integer')
    expect(() => CliConfigSchema.parse({ source: 'local-git', targetPath: 3 })).toThrow('config.targetPath must be a string')
  })
})
