import { describe, it, expect } from 'vitest'
import {
  patchPackageJson,
  detectIndentation,
} from '../../cli/lib/init/common/package-patcher.js'

describe('Package Patcher Engine', () => {
  const pkg2Spaces = `{
  "name": "my-app",
  "version": "1.0.0",
  "scripts": {
    "test": "vitest"
  },
  "dependencies": {
    "fastify": "^4.20.0"
  }
}
`

  const pkg4Spaces = `{
    "name": "my-app",
    "version": "1.0.0",
    "scripts": {
        "test": "vitest"
    }
}
`

  const pkgTabs = `{\t"name": "my-app",\n\t"version": "1.0.0"\n}\n`
  const pkgCrlf = '{\r\n  "name": "my-app",\r\n  "version": "1.0.0"\r\n}\r\n'

  it('detects indentation styles accurately', () => {
    expect(detectIndentation(pkg2Spaces)).toBe('  ')
    expect(detectIndentation(pkg4Spaces)).toBe('    ')
    expect(detectIndentation(pkgTabs)).toBe('\t')
  })

  it('preserves 2-space indentation', () => {
    const res = patchPackageJson(pkg2Spaces, {
      scripts: { 'generate': 'oa-gen generate' },
    })
    expect(res.indentation).toBe('  ')
    expect(res.patchedContent).toContain('  "scripts": {')
    expect(res.patchedContent).toContain('    "generate": "oa-gen generate"')
  })

  it('preserves 4-space indentation', () => {
    const res = patchPackageJson(pkg4Spaces, {
      scripts: { 'generate': 'oa-gen generate' },
    })
    expect(res.indentation).toBe('    ')
    expect(res.patchedContent).toContain('    "scripts": {')
    expect(res.patchedContent).toContain('        "generate": "oa-gen generate"')
  })

  it('preserves tab indentation', () => {
    const res = patchPackageJson(pkgTabs, {
      scripts: { 'generate': 'oa-gen generate' },
    })
    expect(res.indentation).toBe('\t')
    expect(res.patchedContent).toContain('\t"scripts": {')
  })

  it('preserves CRLF line endings', () => {
    const res = patchPackageJson(pkgCrlf, {
      scripts: { 'generate': 'oa-gen generate' },
    })
    expect(res.lineEnding).toBe('\r\n')
    expect(res.patchedContent).toContain('\r\n')
  })

  it('preserves trailing newline', () => {
    const res = patchPackageJson(pkg2Spaces, {
      scripts: { 'generate': 'oa-gen generate' },
    })
    expect(res.patchedContent.endsWith('\n')).toBe(true)
  })

  it('skips existing scripts without --force (collision defense)', () => {
    const res = patchPackageJson(pkg2Spaces, {
      scripts: { 'test': 'jest' },
      force: false,
    })
    expect(res.modified).toBe(false)
    const testAction = res.scripts.find(s => s.key === 'test')
    expect(testAction?.action).toBe('skipped')
    expect(testAction?.reason).toContain('exists without --force')
    // Original script retained
    expect(res.patchedContent).toContain('"test": "vitest"')
    expect(res.patchedContent).not.toContain('"test": "jest"')
  })

  it('overwrites existing scripts when force is true', () => {
    const res = patchPackageJson(pkg2Spaces, {
      scripts: { 'test': 'jest' },
      force: true,
    })
    expect(res.modified).toBe(true)
    const testAction = res.scripts.find(s => s.key === 'test')
    expect(testAction?.action).toBe('updated')
    expect(res.patchedContent).toContain('"test": "jest"')
  })

  it('safely merges dependencies and devDependencies without clobbering existing versions', () => {
    const res = patchPackageJson(pkg2Spaces, {
      dependencies: {
        'fastify': '^5.0.0', // already exists as ^4.20.0
        'pino': '^9.0.0', // new
      },
      devDependencies: {
        'tsx': '^4.7.0',
      },
    })
    expect(res.modified).toBe(true)
    // fastify retained as ^4.20.0
    expect(res.patchedContent).toContain('"fastify": "^4.20.0"')
    // pino added
    expect(res.patchedContent).toContain('"pino": "^9.0.0"')
    // tsx added to devDependencies
    expect(res.patchedContent).toContain('"tsx": "^4.7.0"')

    const fastifyAction = res.dependencies.find(d => d.key === 'fastify')
    expect(fastifyAction?.action).toBe('skipped')

    const pinoAction = res.dependencies.find(d => d.key === 'pino')
    expect(pinoAction?.action).toBe('added')
  })

  it('throws error on malformed package.json', () => {
    expect(() => patchPackageJson('{ invalid json', {})).toThrow('Invalid package.json syntax')
  })
})
