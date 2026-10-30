/**
 * @oa-sdk/tools — Stage 1 CLI-Anything Down-Projection Engine (`createCliAnythingProgram`)
 *
 * Projects the `mcp-use > CLI` pre-reserved `HydratedOpenApiBundle` into a deterministic
 * `CLI-Anything` 2-level `<group> <command>` CLI harness with:
 * - Positional arguments (`@positional`) & typed flags (`@cliFlag`)
 * - Global `--json`, `--table`, `--project <path>`, `--dry-run`, `--handoff-out <path>`
 * - Built-in `session status|undo|redo|history` and `handoff inspect|resume` reserved groups
 */
import fs from 'node:fs'
import path from 'node:path'
import { Command } from 'commander'
import { createToolContext } from './context.js'
import type { HydratedOpenApiBundle, HydratedToolDefinition } from './openapi-hydrator.js'
import {
  isTwoPhaseMutationHandler,
  type CommandOutcome,
  type SessionSnapshotEntry,
  type SessionStateRestorer,
} from './reserved-interfaces.js'

export interface CliAnythingProgramOptions {
  readonly binName?: string | undefined
  readonly description?: string | undefined
  readonly stdout?: (text: string) => void
  readonly stderr?: (text: string) => void
}

export interface CliAnythingExecutionResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
  readonly outcome?: CommandOutcome<any> | undefined
}

function renderAsciiTable(data: unknown): string {
  const rows: Array<Record<string, unknown>> = Array.isArray(data)
    ? data.filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
    : typeof data === 'object' && data !== null
      ? Array.isArray((data as Record<string, unknown>).items)
        ? ((data as Record<string, unknown>).items as Array<Record<string, unknown>>)
        : [data as Record<string, unknown>]
      : [{ value: String(data) }]

  if (rows.length === 0) return '(empty table)'
  const keys = Array.from(new Set(rows.flatMap(r => Object.keys(r)))).slice(0, 8)
  const widths = keys.map(k =>
    Math.max(
      k.length,
      ...rows.map(r => {
        const val = r[k]
        const str = typeof val === 'object' && val !== null ? JSON.stringify(val) : String(val ?? '')
        return Math.min(str.length, 40)
      }),
    ),
  )

  const header = keys.map((k, i) => k.padEnd(widths[i]!)).join(' | ')
  const divider = widths.map(w => '-'.repeat(w)).join('-+-')
  const body = rows
    .map(r =>
      keys
        .map((k, i) => {
          const val = r[k]
          const str = typeof val === 'object' && val !== null ? JSON.stringify(val) : String(val ?? '')
          return (str.length > 40 ? str.slice(0, 37) + '...' : str).padEnd(widths[i]!)
        })
        .join(' | '),
    )
    .join('\n')

  return `${header}\n${divider}\n${body}`
}

function coerceCliOptionValue(raw: unknown, type: string): unknown {
  if (raw === undefined) return undefined
  if (type === 'boolean') {
    if (typeof raw === 'boolean') return raw
    if (raw === 'true' || raw === '1') return true
    if (raw === 'false' || raw === '0') return false
    return Boolean(raw)
  }
  if (type === 'integer' || type === 'number') {
    if (typeof raw === 'number') return raw
    const num = Number(raw)
    return Number.isNaN(num) ? raw : num
  }
  if (type === 'array') {
    if (Array.isArray(raw)) return raw
    if (typeof raw === 'string') {
      const trimmed = raw.trim()
      if (trimmed.startsWith('[')) {
        try {
          const parsed = JSON.parse(trimmed)
          if (Array.isArray(parsed)) return parsed
        } catch {
          // fall through to CSV split
        }
      }
      return raw
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
    }
    return [raw]
  }
  if (type === 'object' && typeof raw === 'string') {
    try {
      return JSON.parse(raw)
    } catch {
      return raw
    }
  }
  return raw
}

function createCliSessionRestorer(
  bundle: HydratedOpenApiBundle,
  projectId: string,
): SessionStateRestorer {
  return async (snapshot: SessionSnapshotEntry, targetState: Record<string, unknown>) => {
    const tool = bundle.toolsByOperationId.get(snapshot.operationId)
    const handler = tool?.rawHandler
    if (!handler || !isTwoPhaseMutationHandler(handler) || typeof handler.restoreState !== 'function') {
      throw new Error(
        `Cannot restore session snapshot "${snapshot.snapshotId}": operation "${snapshot.operationId}" does not expose restoreState`,
      )
    }
    const ctx = createToolContext({
      meta: {
        surface: 'cli',
        projectId,
        operationId: snapshot.operationId,
        sessionAction: 'restore',
      },
    })
    await handler.restoreState(ctx, projectId, targetState)
  }
}

/**
 * Creates a Commander `Command` hierarchy adhering to `CLI-Anything` design principles
 * from a hydrated OpenAPI tool bundle.
 */
export function createCliAnythingProgram(
  bundle: HydratedOpenApiBundle,
  options?: CliAnythingProgramOptions,
): {
  program: Command
  getLastResult: () => { exitCode: number; outcome?: CommandOutcome<any> | undefined }
} {
  const writeOut = options?.stdout ?? ((text: string) => process.stdout.write(text + '\n'))
  const writeErr = options?.stderr ?? ((text: string) => process.stderr.write(text + '\n'))

  let lastExitCode = 0
  let lastOutcome: CommandOutcome<any> | undefined

  const program = new Command()
  program
    .name(options?.binName ?? 'cli-anything-tool')
    .description(options?.description ?? bundle.title)
    .version(bundle.version)
    .option('--json', 'Emit deterministic machine-readable JSON output')
    .option('--table', 'Emit human-readable ASCII table output')
    .option('--project <projectPath>', 'Target project identifier or directory path')
    .option('--dry-run', 'Execute Phase A plan/validation only without mutating disk')
    .option('--handoff-out <filePath>', 'Write cli-anything-handoff-envelope/v1 JSON to file')
    .exitOverride()

  const groupCommands = new Map<string, Command>()
  const getOrCreateGroup = (groupName: string): Command => {
    let grp = groupCommands.get(groupName)
    if (!grp) {
      grp = program.command(groupName).description(`${groupName} domain commands`)
      groupCommands.set(groupName, grp)
    }
    return grp
  }

  const emitOutcome = (
    outcome: CommandOutcome<any>,
    globalOpts: {
      json?: boolean
      table?: boolean
      handoffOut?: string
    },
  ) => {
    lastOutcome = outcome
    if (outcome.passed === false) {
      lastExitCode = 1
    }
    if (globalOpts.handoffOut && outcome.handoffEnvelope) {
      const targetPath = path.resolve(globalOpts.handoffOut)
      fs.mkdirSync(path.dirname(targetPath), { recursive: true })
      fs.writeFileSync(targetPath, JSON.stringify(outcome.handoffEnvelope, null, 2) + '\n', 'utf8')
    }
    if (globalOpts.json) {
      writeOut(JSON.stringify(outcome.data, null, 2))
    } else if (globalOpts.table) {
      writeOut(renderAsciiTable(outcome.data))
    } else {
      writeOut(outcome.summary ?? JSON.stringify(outcome.data, null, 2))
    }
  }

  for (const tool of bundle.tools) {
    registerHydratedToolOnGroup(tool, getOrCreateGroup(tool.pipelineMeta.cliGroup), program, emitOutcome, writeErr, code => {
      lastExitCode = code
    })
  }

  // Mount Reserved R1 `session` commands if not already defined in spec
  if (bundle.reservedInterfaces.includes('session')) {
    const sessionGroup = getOrCreateGroup('session')
    const existingSubcommands = new Set(sessionGroup.commands.map(c => c.name()))

    if (!existingSubcommands.has('status')) {
      sessionGroup
        .command('status [projectId]')
        .description('Inspect current project session lock and undo/redo stack depth')
        .action(async (projectIdArg?: string) => {
          const globals = program.opts<{ json?: boolean; table?: boolean; project?: string }>()
          const projectId = projectIdArg ?? globals.project ?? 'default'
          const record = bundle.sessionStore.readSession(projectId)
          emitOutcome(
            {
              data: {
                projectId: record.projectId,
                updatedAt: record.updatedAt,
                undoCount: record.undoStack.length,
                redoCount: record.redoStack.length,
                currentState: record.currentState,
              },
              summary: `Session "${record.projectId}" (undo: ${record.undoStack.length}, redo: ${record.redoStack.length})`,
            },
            globals,
          )
        })
    }

    if (!existingSubcommands.has('undo')) {
      sessionGroup
        .command('undo [projectId]')
        .description('Undo the most recent committed mutation snapshot on the project session')
        .action(async (projectIdArg?: string) => {
          const globals = program.opts<{ json?: boolean; table?: boolean; project?: string }>()
          const projectId = projectIdArg ?? globals.project ?? 'default'
          const res = await bundle.sessionStore.undo(projectId, createCliSessionRestorer(bundle, projectId))
          emitOutcome(
            {
              data: res,
              summary: res.undone
                ? `Undid snapshot ${res.restoredSnapshot?.snapshotId} (${res.restoredSnapshot?.operationId})`
                : `No undo snapshots available for project "${projectId}"`,
            },
            globals,
          )
        })
    }

    if (!existingSubcommands.has('redo')) {
      sessionGroup
        .command('redo [projectId]')
        .description('Redo the most recently undone mutation snapshot on the project session')
        .action(async (projectIdArg?: string) => {
          const globals = program.opts<{ json?: boolean; table?: boolean; project?: string }>()
          const projectId = projectIdArg ?? globals.project ?? 'default'
          const res = await bundle.sessionStore.redo(projectId, createCliSessionRestorer(bundle, projectId))
          emitOutcome(
            {
              data: res,
              summary: res.redone
                ? `Redid snapshot ${res.reappliedSnapshot?.snapshotId} (${res.reappliedSnapshot?.operationId})`
                : `No redo snapshots available for project "${projectId}"`,
            },
            globals,
          )
        })
    }

    if (!existingSubcommands.has('history')) {
      sessionGroup
        .command('history [projectId]')
        .description('List the undo/redo mutation snapshot history for a project session')
        .action(async (projectIdArg?: string) => {
          const globals = program.opts<{ json?: boolean; table?: boolean; project?: string }>()
          const projectId = projectIdArg ?? globals.project ?? 'default'
          const record = bundle.sessionStore.readSession(projectId)
          emitOutcome(
            {
              data: {
                projectId: record.projectId,
                undoStack: record.undoStack,
                redoStack: record.redoStack,
              },
              summary: `Session history for "${projectId}": ${record.undoStack.length} undo entries`,
            },
            globals,
          )
        })
    }
  }

  return {
    program,
    getLastResult: () => ({
      exitCode: lastExitCode,
      ...(lastOutcome ? { outcome: lastOutcome } : {}),
    }),
  }
}

function registerHydratedToolOnGroup(
  tool: HydratedToolDefinition,
  groupCmd: Command,
  rootProgram: Command,
  emitOutcome: (
    outcome: CommandOutcome<any>,
    globalOpts: { json?: boolean; table?: boolean; handoffOut?: string },
  ) => void,
  writeErr: (text: string) => void,
  setExitCode: (code: number) => void,
): void {
  const meta = tool.pipelineMeta
  const posSpec = meta.positionalArgs
    .map(p => (p.required ? `<${p.name}>` : `[${p.name}]`))
    .join(' ')
  const cmdSignature = posSpec ? `${meta.cliCommand} ${posSpec}` : meta.cliCommand

  const sub = groupCmd.command(cmdSignature).description(tool.description)
  if (meta.aliases.length > 0) {
    sub.aliases(meta.aliases)
  }

  const positionalNames = new Set(meta.positionalArgs.map(p => p.name))

  for (const flag of meta.cliFlags) {
    if (positionalNames.has(flag.propertyName)) continue
    const shortPrefix = flag.short ? `-${flag.short}, ` : ''
    if (flag.type === 'boolean') {
      sub.option(`${shortPrefix}--${flag.flagName}`, flag.description ?? '', flag.default as boolean | undefined)
      if (flag.negatable) {
        sub.option(`--no-${flag.flagName}`, `Disable ${flag.flagName}`)
      }
    } else {
      const valuePlaceholder = flag.placeholder ?? `<${flag.propertyName}>`
      sub.option(
        `${shortPrefix}--${flag.flagName} ${valuePlaceholder}`,
        flag.description ?? '',
        flag.default as string | undefined,
      )
    }
  }

  sub.action(async (...actionArgs: unknown[]) => {
    const commandInstance = actionArgs[actionArgs.length - 1] as Command
    const localOpts = commandInstance.opts<Record<string, unknown>>()
    const globalOpts = rootProgram.opts<{
      json?: boolean
      table?: boolean
      project?: string
      dryRun?: boolean
      handoffOut?: string
    }>()

    const payload: Record<string, unknown> = {}

    // 1. Positional arguments
    meta.positionalArgs.forEach((pos, idx) => {
      const val = actionArgs[idx]
      if (val !== undefined) {
        const flagDef = meta.cliFlags.find(f => f.propertyName === pos.name)
        payload[pos.name] = coerceCliOptionValue(val, flagDef?.type ?? 'string')
      }
    })

    // 2. Flag options + environment variable fallbacks
    for (const flag of meta.cliFlags) {
      if (positionalNames.has(flag.propertyName)) continue
      const camelKey = flag.flagName.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
      let rawVal = localOpts[camelKey] ?? localOpts[flag.propertyName]
      if (rawVal === undefined && flag.env && process.env[flag.env] !== undefined) {
        rawVal = process.env[flag.env]
      }
      if (rawVal === undefined && flag.default !== undefined) {
        rawVal = flag.default
      }
      if (rawVal !== undefined) {
        payload[flag.propertyName] = coerceCliOptionValue(rawVal, flag.type)
      }
    }

    // 3. Global `--project` injection into `projectPath` or `projectId` if not set
    if (globalOpts.project) {
      if (payload.projectPath === undefined && meta.cliFlags.some(f => f.propertyName === 'projectPath')) {
        payload.projectPath = globalOpts.project
      }
      if (payload.projectId === undefined && meta.cliFlags.some(f => f.propertyName === 'projectId')) {
        payload.projectId = globalOpts.project
      }
    }

    // 4. Global `--dry-run` injection
    if (globalOpts.dryRun) {
      payload.dryRun = true
    }

    // 5. Validate against StandardSchemaWithJson
    const validation = tool.standardInputSchema.safeParse(payload)
    if (!validation.success) {
      setExitCode(1)
      const errMsg = validation.error.message
      if (globalOpts.json) {
        writeErr(JSON.stringify({ error: errMsg, issues: validation.error.issues }))
      } else {
        writeErr(`Validation error in "${meta.cliGroup} ${meta.cliCommand}": ${errMsg}`)
      }
      return
    }

    try {
      const ctx = createToolContext({
        meta: {
          surface: 'cli',
          dryRun: Boolean(globalOpts.dryRun || payload.dryRun),
          ...(globalOpts.project ? { projectId: globalOpts.project } : {}),
        },
      })
      const outcome = await tool.execute(ctx, validation.data)
      emitOutcome(outcome, globalOpts)
    } catch (err) {
      setExitCode(1)
      const message = err instanceof Error ? err.message : String(err)
      if (globalOpts.json) {
        writeErr(JSON.stringify({ error: message }))
      } else {
        writeErr(`Error: ${message}`)
      }
    }
  })
}

/**
 * Convenience helper to execute a `CLI-Anything` command line (`argv`) in-memory
 * and capture `{ exitCode, stdout, stderr, outcome }`.
 */
export async function runCliAnythingArgv(
  bundle: HydratedOpenApiBundle,
  argv: string[],
  options?: Omit<CliAnythingProgramOptions, 'stdout' | 'stderr'>,
): Promise<CliAnythingExecutionResult> {
  const outLines: string[] = []
  const errLines: string[] = []
  const { program, getLastResult } = createCliAnythingProgram(bundle, {
    ...options,
    stdout: line => outLines.push(line),
    stderr: line => errLines.push(line),
  })

  try {
    await program.parseAsync(['node', options?.binName ?? 'cli-anything-tool', ...argv])
  } catch (err) {
    const code = (err as { exitCode?: number }).exitCode ?? 1
    const msg = err instanceof Error ? err.message : String(err)
    if (code !== 0 && !errLines.length) {
      errLines.push(msg)
    }
    return {
      exitCode: code,
      stdout: outLines.join('\n'),
      stderr: errLines.join('\n'),
    }
  }

  const res = getLastResult()
  return {
    exitCode: res.exitCode,
    stdout: outLines.join('\n'),
    stderr: errLines.join('\n'),
    ...(res.outcome ? { outcome: res.outcome } : {}),
  }
}
