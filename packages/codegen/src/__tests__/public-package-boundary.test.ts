import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { commands } from '../cli/commands.js'
import { COMPANION_PACKAGES } from '../cli/lib/companion-packages.js'

type Manifest = Record<string, unknown> & {
  private?: boolean
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

const packageDirectory = resolve(__dirname, '../..')
const packageJson = JSON.parse(readFileSync(resolve(packageDirectory, 'package.json'), 'utf8')) as Manifest

const RUNTIME_SECTIONS = ['dependencies', 'optionalDependencies', 'peerDependencies'] as const

/** Manifest of a workspace package, read through the link pnpm creates for every declared dependency. */
const workspaceManifest = (name: string): Manifest =>
  JSON.parse(readFileSync(resolve(packageDirectory, 'node_modules', name, 'package.json'), 'utf8')) as Manifest

describe('public @oa-sdk/codegen boundary', () => {
  it('does not advertise private downstream commands', () => {
    const names = commands.map(command => command.name)
    expect(names).not.toEqual(expect.arrayContaining(['router', 'client', 'dev']))
  })

  it('declares only public workspace packages in its runtime package graph', () => {
    const declared = RUNTIME_SECTIONS.flatMap(section =>
      Object.keys(packageJson[section] ?? {})
        .filter(name => name.startsWith('@oa-sdk/'))
        .map(name => ({ section, name })))
    expect(declared.length).toBeGreaterThan(0)
    for (const { section, name } of declared) {
      expect(workspaceManifest(name).private, `${section}.${name} is a private workspace package`).not.toBe(true)
    }
  })

  // The release policy lets a Core Platform package reference Downstream packages only through
  // devDependencies; oa-gen loads them lazily and reports a missing one with its install command.
  it('references the companion packages oa-gen loads lazily only through devDependencies', () => {
    expect(COMPANION_PACKAGES).toEqual(
      expect.arrayContaining(['@oa-sdk/client', '@oa-sdk/router', '@oa-sdk/mock-server']),
    )
    for (const name of COMPANION_PACKAGES) {
      for (const section of RUNTIME_SECTIONS) {
        expect(packageJson[section] ?? {}, `${section} contains ${name}`).not.toHaveProperty(name)
      }
      expect(packageJson.devDependencies?.[name], `devDependencies.${name}`).toMatch(/^workspace:/)
    }
  })
})
