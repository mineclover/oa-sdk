import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  COMMAND_COMPANIONS,
  COMPANION_PACKAGES,
  commandCompanion,
  type CompanionPackageName,
} from '../../cli/lib/companion-packages.js'
import {
  ARCHETYPE_PROFILES,
  TARGET_PROFILES,
  composeInitCompanionPackages,
  composeInitCoreConfig,
  composeInitScripts,
} from '../../cli/lib/init/index.js'

/**
 * Installing `@oa-sdk/codegen` does not install the companion packages some
 * `oa-gen` commands load, and those commands exit with status 1 without them
 * (see companion-packages.ts). A guide that tells the reader to install codegen
 * and then shows such a command must therefore also install the companion, or
 * link to the section of the CLI setup guide that says what needs which
 * companion and how to install it.
 *
 * Which command needs which companion comes from the code: the commands of
 * `COMMAND_COMPANIONS`, and `oa-gen init`, whose scaffold needs what
 * `composeInitCompanionPackages` lists for it. `oa-gen generate` is not
 * checked, because what it needs depends on the reader's configuration.
 */

const REPO_ROOT = resolve(__dirname, '../../../../..')
const CLI_SETUP_GUIDE = join(REPO_ROOT, 'docs/guides/cli-setup.md')
/** Anchor of the CLI setup guide section that lists what needs which companion. */
const COMPANION_SECTION_ANCHOR = '동반-패키지-companion-packages'

/** Guides for consumers of the published `oa-gen`. */
const GUIDES = [
  ...markdownFiles(join(REPO_ROOT, 'docs/guides')),
  join(REPO_ROOT, 'packages/codegen/README.md'),
]

function markdownFiles(directory: string): string[] {
  return readdirSync(directory, { recursive: true, encoding: 'utf8' })
    .filter(entry => entry.endsWith('.md'))
    .map(entry => join(directory, entry))
    .sort()
}

// Package-manager commands that add packages, up to the end of the shell command.
const INSTALL_COMMAND = /\b(?:npm\s+(?:install|i|add)|pnpm\s+(?:add|install|i)|yarn\s+add|bun\s+add)\b([^`&|;#\n]*)/g
// One-off runners that fetch packages for a single command (`npx -p <package> ...`).
const RUNNER_COMMAND = /\b(?:npx|bunx|pnpm\s+dlx|yarn\s+dlx)((?:\s+(?:-p|--package)(?:\s+|=)[^\s`&|;#]+)+)/g
const RUNNER_PACKAGE = /(?:-p|--package)(?:\s+|=)([^\s`&|;#]+)/g
// `oa-gen <command>`, but not `my-oa-gen <command>` or `oa-gen-server`.
const OA_GEN_COMMAND = /(?:^|[^\w@/.-])oa-gen\s+([a-z][a-z0-9:-]*)/gm

/** Package name of an install argument such as `"@oa-sdk/router@^0.2.1"`. */
function packageName(argument: string): string | undefined {
  return argument.replace(/^["']|["']$/g, '').match(/^(@[^/@\s]+\/[^@\s]+|[^@\s]+)/)?.[1]
}

/** Packages that `content` tells the reader to install. */
function installedPackages(content: string): Set<string> {
  const packages = new Set<string>()
  const add = (argument: string) => {
    const name = packageName(argument)
    if (name) packages.add(name)
  }
  for (const [, args] of content.matchAll(INSTALL_COMMAND)) {
    for (const argument of args!.trim().split(/\s+/)) {
      if (argument && !argument.startsWith('-')) add(argument)
    }
  }
  for (const [, options] of content.matchAll(RUNNER_COMMAND)) {
    for (const [, argument] of options!.matchAll(RUNNER_PACKAGE)) add(argument!)
  }
  return packages
}

/** `oa-gen` commands that `content` shows, in code or prose. */
function oaGenCommands(content: string): Set<string> {
  return new Set([...content.matchAll(OA_GEN_COMMAND)].map(([, command]) => command!))
}

/** Companions the scaffold of `oa-gen init` needs, for any target and archetype it may pick. */
function initScaffoldCompanions(): Set<CompanionPackageName> {
  const packages = new Set<CompanionPackageName>()
  for (const target of Object.values(TARGET_PROFILES)) {
    for (const archetype of ARCHETYPE_PROFILES) {
      const options = { cwd: '/workspace/app', frameworkId: target.id, runtime: target.defaultRuntime }
      const scripts = composeInitScripts(target, archetype, options)
      for (const name of composeInitCompanionPackages(composeInitCoreConfig(archetype), scripts)) packages.add(name)
    }
  }
  return packages
}

const INIT_SCAFFOLD_COMPANIONS = initScaffoldCompanions()

/** Companions that the `oa-gen` commands shown in `content` cannot run without. */
function companionsNeeded(content: string): Set<CompanionPackageName> {
  const packages = new Set<CompanionPackageName>()
  for (const command of oaGenCommands(content)) {
    const companion = commandCompanion(command)
    if (companion !== undefined) packages.add(companion)
    if (command === 'init') for (const name of INIT_SCAFFOLD_COMPANIONS) packages.add(name)
  }
  return packages
}

/** True when `content`, the text of `file`, links to the companion section of the CLI setup guide. */
function linksToCompanionSection(file: string, content: string): boolean {
  for (const [, link] of content.matchAll(/\]\((<[^>]+>|[^)\s]+)(?:\s+[^)]*)?\)/g)) {
    const [path = '', anchor] = link!.replace(/^<|>$/g, '').split('#', 2)
    if (anchor === undefined || decodeURIComponent(anchor) !== COMPANION_SECTION_ANCHOR) continue
    if ((path === '' ? file : resolve(dirname(file), path)) === CLI_SETUP_GUIDE) return true
  }
  return false
}

/**
 * Companions a guide leaves the reader without: needed by a command it shows,
 * neither installed by it nor covered by a link to the companion section.
 * Empty for a guide that does not install `@oa-sdk/codegen`.
 */
function companionsLeftOut(file: string, content: string): CompanionPackageName[] {
  const installed = installedPackages(content)
  if (!installed.has('@oa-sdk/codegen')) return []
  if (linksToCompanionSection(file, content)) return []
  return [...companionsNeeded(content)].filter(name => !installed.has(name))
}

/** GitHub's anchor for a Markdown heading. */
function headingAnchor(heading: string): string {
  return heading.trim().toLowerCase().replace(/[^\p{L}\p{M}\p{N}\s_-]/gu, '').replace(/\s/g, '-')
}

/**
 * The section of `content` whose heading has `anchor`, up to the next heading
 * of the same or a higher level. Lines inside fenced code blocks, such as shell
 * comments, are not headings.
 */
function markdownSection(content: string, anchor: string): string | undefined {
  const lines = content.split('\n')
  let inFence = false
  let start = -1
  let level = 0
  for (const [index, line] of lines.entries()) {
    if (/^\s*(?:```|~~~)/.test(line)) inFence = !inFence
    if (inFence) continue
    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (!heading) continue
    if (start >= 0 && heading[1]!.length <= level) return lines.slice(start, index).join('\n')
    if (start < 0 && headingAnchor(heading[2]!) === anchor) {
      start = index
      level = heading[1]!.length
    }
  }
  return start >= 0 ? lines.slice(start).join('\n') : undefined
}

describe('guide checks', () => {
  const guide = join(REPO_ROOT, 'docs/guides/example.md')

  it('reads package names from install commands and one-off runners', () => {
    expect([...installedPackages([
      'npm install --save-dev @oa-sdk/codegen "@oa-sdk/router@^0.2.1" # and nothing else',
      'Run `bun add -d @oa-sdk/client && bunx oa-gen init --yes` first.',
      'npx -p @oa-sdk/codegen --package=@oa-sdk/mock-server oa-gen mock',
      'pnpm install --frozen-lockfile',
    ].join('\n'))].sort()).toEqual(['@oa-sdk/client', '@oa-sdk/codegen', '@oa-sdk/mock-server', '@oa-sdk/router'])
  })

  it('reads the oa-gen commands of code and prose, and nothing that merely contains oa-gen', () => {
    expect([...oaGenCommands([
      '"codegen:client": "oa-gen generate:client -s ./spec.json"',
      'Start it with `npx oa-gen mock --watch`.',
      'node scripts/my-oa-gen init; tsx src/oa-gen-server.ts',
    ].join('\n'))]).toEqual(['generate:client', 'mock'])
  })

  it('requires the companions of the commands a guide shows once it installs codegen', () => {
    const content = 'npm install --save-dev @oa-sdk/codegen\n\nnpx oa-gen mock --spec openapi.yaml\n'
    expect(companionsLeftOut(guide, content)).toEqual([COMMAND_COMPANIONS.mock])
    expect(companionsLeftOut(guide, content.replace('@oa-sdk/codegen', `@oa-sdk/codegen ${COMMAND_COMPANIONS.mock}`)))
      .toEqual([])
  })

  it('requires what the init scaffold needs from a guide that runs oa-gen init', () => {
    const content = 'npm install --save-dev @oa-sdk/codegen && npx oa-gen init --yes\n'
    expect(INIT_SCAFFOLD_COMPANIONS.size).toBeGreaterThan(0)
    expect(companionsLeftOut(guide, content).sort()).toEqual([...INIT_SCAFFOLD_COMPANIONS].sort())
  })

  it('accepts a link to the companion section of the CLI setup guide instead', () => {
    const content = 'pnpm add -D @oa-sdk/codegen\n\noa-gen generate:client -s spec.json\n'
    expect(companionsLeftOut(guide, content)).toEqual([COMMAND_COMPANIONS['generate:client']])
    expect(companionsLeftOut(guide, `${content}\n[setup](./cli-setup.md#${COMPANION_SECTION_ANCHOR})\n`)).toEqual([])
    expect(companionsLeftOut(guide, `${content}\n[setup](./cli-setup.md#other-section)\n`))
      .toEqual([COMMAND_COMPANIONS['generate:client']])
    expect(companionsLeftOut(guide, `${content}\n[setup](./elsewhere.md#${COMPANION_SECTION_ANCHOR})\n`))
      .toEqual([COMMAND_COMPANIONS['generate:client']])
  })

  it('asks nothing of a guide that does not install codegen', () => {
    expect(companionsLeftOut(guide, 'oa-gen mock --spec openapi.yaml\n')).toEqual([])
  })

  it('reads a section up to the next heading of its level, past shell comments in code blocks', () => {
    const section = ['## 동반 패키지 (Companion Packages)', 'intro', '```bash', '# a shell comment', '```', '### Detail', 'more']
    const content = ['# Guide', ...section, '## Next', 'after'].join('\n')
    expect(markdownSection(content, COMPANION_SECTION_ANCHOR)).toBe(section.join('\n'))
    expect(markdownSection(content, 'missing')).toBeUndefined()
  })
})

describe('the companion section of the CLI setup guide', () => {
  const section = markdownSection(readFileSync(CLI_SETUP_GUIDE, 'utf8'), COMPANION_SECTION_ANCHOR)

  it('exists under the anchor the guides link to', () => {
    expect(section).toBeDefined()
  })

  it('names every companion package', () => {
    for (const name of COMPANION_PACKAGES) expect(section, name).toContain(name)
  })
})

describe('guides that install @oa-sdk/codegen cover the companions their oa-gen commands need', () => {
  const guides = GUIDES.map(file => ({ file, content: readFileSync(file, 'utf8') }))

  it('include guides whose commands need a companion', () => {
    expect(guides.some(({ content }) =>
      installedPackages(content).has('@oa-sdk/codegen') && companionsNeeded(content).size > 0)).toBe(true)
  })

  it('install them, or link to the companion section of the CLI setup guide', () => {
    const leftOut = Object.fromEntries(guides
      .map(({ file, content }) => [relative(REPO_ROOT, file), companionsLeftOut(file, content)] as const)
      .filter(([, packages]) => packages.length > 0))
    expect(leftOut).toEqual({})
  })
})
