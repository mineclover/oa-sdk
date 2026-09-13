import * as readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import type { TargetFrameworkId, OutputRoutingPreset } from './types.js'
import type { LifecycleArchetypeId } from './archetypes/types.js'

/**
 * Checks if the current execution environment is an interactive TTY terminal.
 */
export function isInteractiveSession(): boolean {
  if (process.env.CI || process.env.NODE_ENV === 'test') {
    return false
  }
  return Boolean(process.stdin.isTTY && process.stdout.isTTY)
}

/**
 * Prompts user to select or confirm the target web framework.
 */
export async function promptTargetSelection(
  detectedTarget: TargetFrameworkId,
  confidence: number,
): Promise<TargetFrameworkId> {
  const rl = readline.createInterface({ input, output })
  try {
    console.log(`\n🔍 Detected framework: ${detectedTarget} (confidence: ${(confidence * 100).toFixed(0)}%)`)
    console.log('Available targets: [1] fastify  [2] elysia  [3] hono  [4] express  [5] nestjs  [6] generic')
    const answer = await rl.question(`Select framework [1-6] (default: ${detectedTarget}): `)
    const trimmed = answer.trim().toLowerCase()
    const map: Record<string, TargetFrameworkId> = {
      '1': 'fastify',
      'fastify': 'fastify',
      '2': 'elysia',
      'elysia': 'elysia',
      '3': 'hono',
      'hono': 'hono',
      '4': 'express',
      'express': 'express',
      '5': 'nestjs',
      'nestjs': 'nestjs',
      '6': 'generic',
      'generic': 'generic',
    }
    return map[trimmed] ?? detectedTarget
  } catch {
    return detectedTarget
  } finally {
    rl.close()
  }
}

/**
 * Prompts user to select the product lifecycle archetype preset.
 */
export async function promptArchetypeSelection(
  suggestedArchetype: LifecycleArchetypeId = 'mvp',
): Promise<LifecycleArchetypeId> {
  const rl = readline.createInterface({ input, output })
  try {
    console.log('\n🎯 Select Lifecycle Archetype Preset:')
    console.log('  [1] MVP          — Rapid iteration, live mock-first (mock --watch), client SDK')
    console.log('  [2] Microservice — High throughput, strict wire typing (JsonPrimitive<T>), contract tests')
    console.log('  [3] Enterprise   — CI drift defense (oa-gen diff --fail-on-breaking), personas, strict linting')
    const answer = await rl.question(`Select archetype [1-3] (default: ${suggestedArchetype}): `)
    const trimmed = answer.trim().toLowerCase()
    const map: Record<string, LifecycleArchetypeId> = {
      '1': 'mvp',
      'mvp': 'mvp',
      '2': 'microservice',
      'microservice': 'microservice',
      '3': 'enterprise',
      'enterprise': 'enterprise',
    }
    return map[trimmed] ?? suggestedArchetype
  } catch {
    return suggestedArchetype
  } finally {
    rl.close()
  }
}

/**
 * Prompts user to select the output path routing preset.
 */
export async function promptRoutingSelection(
  suggestedRouting: OutputRoutingPreset = 'default',
): Promise<OutputRoutingPreset> {
  const rl = readline.createInterface({ input, output })
  try {
    console.log('\n🗂️ Select Output Path Routing Preset:')
    console.log('  [1] Default  — Flat convention: src/api/{tag}/{tag}.{kind}.ts')
    console.log('  [2] FSD      — Feature-Sliced Design: src/features/{tag}/api/ & src/shared/api/')
    console.log('  [3] Monorepo — Full-stack monorepo: packages/contracts/, client-sdk/, apps/web/')
    console.log('  [4] By-Kind  — Group by kind: src/contracts/, src/client/, src/queries/')
    const answer = await rl.question(`Select routing preset [1-4] (default: ${suggestedRouting}): `)
    const trimmed = answer.trim().toLowerCase()
    const map: Record<string, OutputRoutingPreset> = {
      '1': 'default',
      'default': 'default',
      '2': 'fsd',
      'fsd': 'fsd',
      '3': 'monorepo',
      'monorepo': 'monorepo',
      '4': 'by-kind',
      'by-kind': 'by-kind',
      'bykind': 'by-kind',
    }
    return map[trimmed] ?? suggestedRouting
  } catch {
    return suggestedRouting
  } finally {
    rl.close()
  }
}

