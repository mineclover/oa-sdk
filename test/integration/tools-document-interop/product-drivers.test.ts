import { describe, expect, it } from 'vitest'
import {
  assertExternalInteropDriversAvailable,
  detectExternalInteropDrivers,
} from './product-drivers.js'

function options(overrides: {
  env?: NodeJS.ProcessEnv
  commands?: Record<string, string | undefined>
  modules?: string[]
} = {}) {
  const commands = overrides.commands ?? { soffice: '/opt/soffice' }
  const modules = new Set(overrides.modules ?? ['googleapis', '@notionhq/client', 'playwright-core'])
  return {
    cwd: '/tmp/tools-document-interop',
    env: overrides.env ?? {
      GOOGLE_OAUTH_ACCESS_TOKEN: 'secret-google-token',
      NOTION_TOKEN: 'secret-notion-token',
      NOTION_DATABASE_ID: 'database-id',
    },
    locateExecutable: (command: string) => commands[command],
    resolveModule: (specifier: string) => modules.has(specifier) ? `/tmp/node_modules/${specifier}/index.js` : undefined,
  }
}

describe('external document interop product drivers', () => {
  it('detects local prerequisites and credential markers without contacting products', () => {
    const manifest = detectExternalInteropDrivers(options())
    expect(manifest.schemaVersion).toBe('tools-document-interop/drivers/v1')
    expect(manifest.defaultCiSafe).toBe(true)
    expect(manifest.drivers.every(driver => driver.lane === 'external-e2e')).toBe(true)
    expect(manifest.drivers.find(driver => driver.id === 'soffice')).toMatchObject({ available: true })
    expect(manifest.drivers.find(driver => driver.id === 'google-sheets')).toMatchObject({ available: true })
    expect(manifest.drivers.find(driver => driver.id === 'notion')).toMatchObject({ available: true })
    expect(manifest.drivers.find(driver => driver.id === 'playwright')).toMatchObject({ available: true })
    expect(JSON.stringify(manifest)).not.toContain('secret-google-token')
    expect(JSON.stringify(manifest)).not.toContain('secret-notion-token')
  })

  it('reports missing binaries, modules, and credential markers without throwing', () => {
    const manifest = detectExternalInteropDrivers(options({
      env: {},
      commands: {},
      modules: [],
    }))
    for (const driver of manifest.drivers) expect(driver.available).toBe(false)
    expect(manifest.drivers.find(driver => driver.id === 'soffice')?.reason).toMatch(/soffice|libreoffice/i)
    expect(manifest.drivers.find(driver => driver.id === 'google-sheets')?.reason).toMatch(/googleapis/i)
    expect(manifest.drivers.find(driver => driver.id === 'notion')?.reason).toMatch(/notion/i)
  })

  it('fails a required external lane with actionable prerequisite details', () => {
    const manifest = detectExternalInteropDrivers(options({ env: {}, commands: {}, modules: [] }))
    expect(() => assertExternalInteropDriversAvailable(manifest, ['soffice', 'google-sheets']))
      .toThrow(/soffice|google-sheets/)
  })
})
