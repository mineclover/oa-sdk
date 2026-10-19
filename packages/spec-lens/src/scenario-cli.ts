import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  DEFAULT_SCENARIOS,
  ScenarioFlowEnumerator,
  ScenarioRegistry,
  type FlowEnumerationResult,
  type ScenarioTopicDefinition,
  type ScenarioTopicId,
} from '@oa-sdk/spec-lens-contract'

const BOLD = '\x1b[1m'
const RESET = '\x1b[0m'
const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const CYAN = '\x1b[36m'
const YELLOW = '\x1b[33m'
const DIM = '\x1b[2m'

export interface ScenarioCliOptions {
  registry?: ScenarioRegistry
  stdout?: (msg: string) => void
  stderr?: (msg: string) => void
  exit?: (code: number) => void
}

export async function runScenarioCli(
  args: string[],
  options: ScenarioCliOptions = {},
): Promise<boolean> {
  const registry = options.registry ?? new ScenarioRegistry()
  const log = options.stdout ?? console.log
  const logError = options.stderr ?? console.error
  const exit = options.exit ?? process.exit

  const command = args[0] ?? 'list'

  if (command === 'list' || command === 'ls') {
    printScenarioList(registry, log)
    return true
  }

  if (command === 'inspect') {
    const id = args[1]
    if (!id) {
      logError(`${RED}Error:${RESET} Scenario ID required. Usage: spec-lens scenario inspect <id>`)
      exit(1)
      return true
    }
    const scenario = registry.get(id as ScenarioTopicId)
    if (!scenario) {
      logError(`${RED}Error:${RESET} Scenario "${id}" not found in registry.`)
      exit(1)
      return true
    }
    printScenarioInspection(scenario, log)
    return true
  }

  if (command === 'verify' || command === 'check') {
    const success = verifyAllScenarios(registry, log, logError)
    if (!success) {
      exit(1)
    }
    return true
  }

  if (command === 'preview') {
    const id = args[1]
    if (!id) {
      logError(`${RED}Error:${RESET} Scenario ID required. Usage: spec-lens scenario preview <id>`)
      exit(1)
      return true
    }
    const scenario = registry.get(id as ScenarioTopicId)
    if (!scenario) {
      logError(`${RED}Error:${RESET} Scenario "${id}" not found in registry.`)
      exit(1)
      return true
    }
    printAsciiPreview(scenario, log)
    return true
  }

  if (command === 'export') {
    handleExport(args.slice(1), registry, log, logError, exit)
    return true
  }

  if (command === 'help' || command === '--help' || command === '-h') {
    printHelp(log)
    return true
  }

  logError(`${RED}Unknown scenario command:${RESET} ${command}`)
  printHelp(log)
  exit(1)
  return true
}

function printHelp(log: (msg: string) => void) {
  log(`
${BOLD}spec-lens scenario CLI${RESET} — Manage, verify, preview, and export user scenario FSM flows

${BOLD}USAGE:${RESET}
  spec-lens scenario <command> [options]

${BOLD}COMMANDS:${RESET}
  ${CYAN}list${RESET}                     List all registered scenario topics and reachability stats
  ${CYAN}inspect <id>${RESET}             Inspect a scenario's transition matrix, guards, and paths
  ${CYAN}verify${RESET}                   Run static verification on all scenarios (dead-ends, reachability, bounds, guards)
  ${CYAN}preview <id>${RESET}             Display terminal ASCII/ANSI flowchart preview
  ${CYAN}export [options]${RESET}         Export flowcharts to Mermaid, DOT, JSON, or Markdown
    ${DIM}--format <fmt>${RESET}       mermaid | dot | json | markdown (default: markdown)
    ${DIM}--id <id>${RESET}            Specific scenario ID (default: all scenarios)
    ${DIM}--out <file>${RESET}          Output file path (default: stdout)

${BOLD}EXAMPLES:${RESET}
  spec-lens scenario list
  spec-lens scenario inspect spec-drift-triage
  spec-lens scenario preview endpoint-exploration
  spec-lens scenario export --format mermaid --id breaking-impact-analysis
  spec-lens scenario verify
`)
}

function printScenarioList(registry: ScenarioRegistry, log: (msg: string) => void) {
  const scenarios = registry.getAll()
  log(`\n${BOLD}Registered User Scenarios (${scenarios.length}):${RESET}\n`)

  for (const s of scenarios) {
    const analysis = ScenarioFlowEnumerator.enumerate(s)
    const deadEndStatus = analysis.deadEnds.length === 0 ? `${GREEN}0 Dead-Ends${RESET}` : `${RED}${analysis.deadEnds.length} Dead-Ends${RESET}`
    log(`  ${BOLD}${CYAN}${s.id}${RESET} — ${s.title}`)
    log(`    ${DIM}Persona:${RESET} ${s.persona} | ${DIM}Initial:${RESET} ${s.initialView} | ${DIM}Views:${RESET} [${s.boundedViews.join(', ')}]`)
    log(`    ${DIM}Terminal Goals:${RESET} ${s.terminalGoals.map(g => g.id).join(', ')}`)
    log(`    ${DIM}Reachability:${RESET} ${analysis.reachableViews.length} views reachable | ${analysis.terminalPaths.length} goal paths | ${deadEndStatus}\n`)
  }
}

function printScenarioInspection(scenario: ScenarioTopicDefinition, log: (msg: string) => void) {
  const analysis = ScenarioFlowEnumerator.enumerate(scenario)
  log(`\n${BOLD}Scenario Inspection:${RESET} ${scenario.title} (${CYAN}${scenario.id}${RESET})`)
  log(`${DIM}${scenario.description}${RESET}\n`)
  log(`  ${BOLD}Persona:${RESET}      ${scenario.persona}`)
  log(`  ${BOLD}Initial View:${RESET} ${scenario.initialView}`)
  log(`  ${BOLD}Bounded Views:${RESET}[${scenario.boundedViews.join(', ')}]`)
  log(`  ${BOLD}Reachable:${RESET}    [${analysis.reachableViews.join(', ')}]`)
  log(`  ${BOLD}Dead Ends:${RESET}    ${analysis.deadEnds.length === 0 ? `${GREEN}None (100% Safe)${RESET}` : `${RED}${analysis.deadEnds.join(', ')}${RESET}`}`)
  log(`  ${BOLD}Terminal Paths:${RESET}${GREEN}${analysis.terminalPaths.length} paths to goal${RESET}\n`)

  log(`${BOLD}Transition Matrix (${analysis.matrix.length} rules):${RESET}`)
  log(`┌───────────────┬───────────────────────────────┬───────────────┬──────────────────────┬───────────┐`)
  log(`│ From View     │ Action (BEHAVIOR)             │ To View       │ Guard IDs            │ Status    │`)
  log(`├───────────────┼───────────────────────────────┼───────────────┼──────────────────────┼───────────┤`)

  for (const row of analysis.matrix) {
    const from = row.fromView.padEnd(13)
    const act = row.actionType.padEnd(29)
    const to = row.toView.padEnd(13)
    const guards = (row.guardIds.length > 0 ? row.guardIds.join(',') : 'None').padEnd(20)
    const status = row.isTerminal ? `${GREEN}Goal reached${RESET}` : `${DIM}Transition  ${RESET}`
    log(`│ ${from} │ ${act} │ ${to} │ ${guards} │ ${status} │`)
  }
  log(`└───────────────┴───────────────────────────────┴───────────────┴──────────────────────┴───────────┘\n`)
}

/**
 * Static checks every scenario must pass. Set-based, so views reached outside
 * `boundedViews` can never mask an unreachable bounded view, and every check
 * mirrors a way the runtime reducer would fail or strand the user.
 */
function collectScenarioErrors(
  s: ScenarioTopicDefinition,
  analysis: FlowEnumerationResult,
): string[] {
  const errors: string[] = []
  const bounded = new Set(s.boundedViews)
  const reachable = new Set(analysis.reachableViews)

  if (!bounded.has(s.initialView)) {
    errors.push(`Initial view "${s.initialView}" is not in boundedViews`)
  }
  if (analysis.deadEnds.length > 0) {
    errors.push(`Dead-end views detected: ${analysis.deadEnds.join(', ')}`)
  }
  if (analysis.terminalPaths.length === 0) {
    errors.push(`No reachable terminal path to any goal`)
  }
  const unreachable = s.boundedViews.filter(v => !reachable.has(v))
  if (unreachable.length > 0) {
    errors.push(`Unreachable declared bounded views: ${unreachable.join(', ')}`)
  }
  // Transition endpoints inside boundedViews also keep every reachable view bounded.
  const outOfBounds = [...new Set(s.transitions.flatMap(t => [t.fromView, t.toView]))].filter(v => !bounded.has(v))
  if (outOfBounds.length > 0) {
    errors.push(`Transitions reference views outside boundedViews: ${outOfBounds.join(', ')}`)
  }
  const badGoals = s.terminalGoals.filter(g => !bounded.has(g.targetView))
  if (badGoals.length > 0) {
    errors.push(`Terminal goals target views outside boundedViews: ${badGoals.map(g => `${g.id}->${g.targetView}`).join(', ')}`)
  }
  const declaredGuards = s.guards ?? {}
  const undeclared = [...new Set(s.transitions.flatMap(t => t.guardIds ?? []))].filter(
    id => !Object.hasOwn(declaredGuards, id),
  )
  if (undeclared.length > 0) {
    errors.push(`Transitions reference undeclared guards: ${undeclared.join(', ')}`)
  }
  return errors
}

export function verifyAllScenarios(
  registry: ScenarioRegistry,
  log: (msg: string) => void,
  logError: (msg: string) => void,
): boolean {
  const scenarios = registry.getAll()
  log(`\n${BOLD}Verifying ${scenarios.length} Scenario Topic FSMs...${RESET}\n`)

  let allValid = true

  for (const s of scenarios) {
    const analysis = ScenarioFlowEnumerator.enumerate(s)
    const errors = collectScenarioErrors(s, analysis)

    if (errors.length === 0) {
      log(`  ${GREEN}✓${RESET} ${s.id.padEnd(28)} [${analysis.reachableViews.length} views, ${analysis.terminalPaths.length} goal paths]`)
    } else {
      allValid = false
      logError(`  ${RED}✗${RESET} ${s.id.padEnd(28)} FAIL`)
      for (const err of errors) {
        logError(`    ${RED}• ${err}${RESET}`)
      }
    }
  }

  log('')
  if (allValid) {
    log(`${GREEN}${BOLD}Verification PASSED:${RESET} All scenarios are 100% reachable with zero dead-ends, bounded transitions and goals, and declared guards.\n`)
  } else {
    logError(`${RED}${BOLD}Verification FAILED:${RESET} Some scenarios have broken transitions or dead-ends.\n`)
  }

  return allValid
}

function printAsciiPreview(scenario: ScenarioTopicDefinition, log: (msg: string) => void) {
  const analysis = ScenarioFlowEnumerator.enumerate(scenario)
  log(`\n${BOLD}================================================================${RESET}`)
  log(`${BOLD}Terminal Flow Preview:${RESET} ${scenario.title} (${CYAN}${scenario.id}${RESET})`)
  log(`${DIM}Persona:${RESET} ${scenario.persona} | ${DIM}Start:${RESET} [${scenario.initialView}]`)
  log(`${BOLD}================================================================${RESET}\n`)

  log(`  ┌─────────────────────────────┐`)
  log(`  │  ● START                    │`)
  log(`  └──────────────┬──────────────┘`)
  log(`                 │`)
  log(`                 ▼`)
  log(`  ┌─────────────────────────────┐`)
  log(`  │  View: ${CYAN}${scenario.initialView.padEnd(20)}${RESET} │`)
  log(`  └──────────────┬──────────────┘`)

  for (const step of analysis.terminalPaths[0]?.steps ?? []) {
    const guardNote = step.guardIds && step.guardIds.length > 0 ? ` [${step.guardIds.join(',')}]` : ''
    log(`                 │ ${YELLOW}${step.action}${guardNote}${RESET}`)
    log(`                 ▼`)
    log(`  ┌─────────────────────────────┐`)
    log(`  │  View: ${CYAN}${step.to.padEnd(20)}${RESET} │`)
    log(`  └──────────────┬──────────────┘`)
  }

  log(`                 │ ${GREEN}COMPLETE_GOAL${RESET}`)
  log(`                 ▼`)
  log(`  ╔═════════════════════════════╗`)
  log(`  ║  ★ GOAL REACHED             ║`)
  log(`  ╚═════════════════════════════╝\n`)
}

function handleExport(
  args: string[],
  registry: ScenarioRegistry,
  log: (msg: string) => void,
  logError: (msg: string) => void,
  exit: (code: number) => void,
) {
  let format = 'markdown'
  let targetId: string | null = null
  let outFile: string | null = null

  for (let i = 0; i < args.length; i++) {
    const nextVal = args[i + 1]
    if (args[i] === '--format' && nextVal) {
      format = nextVal
      i++
    } else if (args[i] === '--id' && nextVal) {
      targetId = nextVal
      i++
    } else if (args[i] === '--out' && nextVal) {
      outFile = nextVal
      i++
    }
  }

  const scenarios = targetId
    ? [registry.get(targetId as ScenarioTopicId)].filter((s): s is ScenarioTopicDefinition => Boolean(s))
    : registry.getAll()

  if (scenarios.length === 0) {
    logError(`${RED}Error:${RESET} No scenarios found for export (id="${targetId}")`)
    exit(1)
    return
  }

  let outputContent = ''

  if (format === 'mermaid') {
    outputContent = scenarios
      .map((s) => `%% --- Scenario: ${s.title} (${s.id}) ---\n${ScenarioFlowEnumerator.toMermaidStateDiagram(s)}\n`)
      .join('\n')
  } else if (format === 'dot') {
    outputContent = scenarios
      .map((s) => ScenarioFlowEnumerator.toDotGraph(s))
      .join('\n\n')
  } else if (format === 'json') {
    const data = scenarios.map((s) => ScenarioFlowEnumerator.enumerate(s))
    outputContent = JSON.stringify(data, null, 2)
  } else {
    // Markdown
    outputContent = scenarios
      .map((s) => ScenarioFlowEnumerator.toMarkdownReport(s))
      .join('\n\n---\n\n')
  }

  if (outFile) {
    mkdirSync(dirname(outFile), { recursive: true })
    writeFileSync(outFile, outputContent, 'utf-8')
    log(`${GREEN}Exported ${scenarios.length} scenario(s) to ${outFile} (${format})${RESET}`)
  } else {
    log(outputContent)
  }
}
