import { describe, it, expect, vi } from 'vitest'
import {
  commands,
  generateGuardsCommand,
  generateDrizzleCommand,
  driftLive,
  generateTanstackCommand,
  generateZod,
} from '../../cli/commands.js'
import { driftCheck } from '../../cli/commands/check-artifact.js'
import { generate } from '../../cli/commands/generate.js'
import { generateHelp } from '../../cli/lib/help.js'
import * as path from 'node:path'
import * as os from 'node:os'
import * as fs from 'node:fs'

describe('CLI Unification: Subcommands, Aliases, and Help Categorization', () => {
  describe('Command declarations and registration', () => {
    it('registers generate:guards command with appropriate options', () => {
      expect(generateGuardsCommand.name).toBe('generate:guards')
      expect(generateGuardsCommand.options?.input).toBeDefined()
      expect(generateGuardsCommand.options?.input?.required).toBe(true)
      expect(generateGuardsCommand.options?.['out-dir']).toBeDefined()
      expect(generateGuardsCommand.options?.split).toBeDefined()
      expect(commands).toContain(generateGuardsCommand)
    })

    it('registers generate:drizzle command with appropriate options', () => {
      expect(generateDrizzleCommand.name).toBe('generate:drizzle')
      expect(generateDrizzleCommand.options?.['drizzle-schema']).toBeDefined()
      expect(generateDrizzleCommand.options?.['drizzle-schema']?.required).toBe(true)
      expect(generateDrizzleCommand.options?.output).toBeDefined()
      expect(commands).toContain(generateDrizzleCommand)
    })

    it('registers drift:live command with appropriate options', () => {
      expect(driftLive.name).toBe('drift:live')
      expect(driftLive.options?.['managed-openapi']).toBeDefined()
      expect(driftLive.options?.['runtime-openapi-url']).toBeDefined()
      expect(commands).toContain(driftLive)
    })

    it('includes primary subcommands in commands array', () => {
      const names = commands.map(c => c.name)
      expect(names).toContain('generate:guards')
      expect(names).toContain('generate:drizzle')
      expect(names).toContain('generate:tanstack')
      expect(names).toContain('generate:zod')
      expect(names).toContain('drift:check')
      expect(names).toContain('drift:live')
      expect(names).toContain('check-artifact')
      expect(names).toContain('drift')
    })
  })

  describe('Help text categorization', () => {
    it('generates 5 logical category sections in help output', () => {
      const help = generateHelp(commands)

      expect(help).toContain('Core Code Generation:')
      expect(help).toContain('Validation & Audit:')
      expect(help).toContain('Diff & Freshness:')
      expect(help).toContain('Spec Pipeline:')
      expect(help).toContain('Advanced & Governance:')

      // Check command presence in their respective categories
      expect(help).toMatch(/Core Code Generation:[\s\S]*oa-gen generate:guards/)
      expect(help).toMatch(/Core Code Generation:[\s\S]*oa-gen generate:drizzle/)
      expect(help).toMatch(/Core Code Generation:[\s\S]*oa-gen generate:tanstack/)
      expect(help).toMatch(/Diff & Freshness:[\s\S]*oa-gen drift:live/)
      expect(help).toMatch(/Diff & Freshness:[\s\S]*oa-gen drift:check/)
    })
  })

  describe('Backward compatibility and deprecation notices', () => {
    it('outputs deprecation notice when "oa-gen generate --tanstack" is invoked', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-gen-deprecate-test-'))
      const specPath = path.join(tmpDir, 'test-spec.yaml')
      fs.writeFileSync(
        specPath,
        `openapi: 3.2.0
info:
  title: Test API
  version: 1.0.0
paths: {}
`,
      )

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      try {
        await generate.run(
          { tanstack: true, spec: specPath, output: path.join(tmpDir, 'out.ts') },
          { projectRoot: tmpDir, cwd: tmpDir },
        )

        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining('[oa-gen] Note: "oa-gen generate --tanstack" is deprecated. Please use "oa-gen generate:tanstack" directly.'),
        )
      } finally {
        consoleSpy.mockRestore()
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })
  })
})
