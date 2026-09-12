import * as readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import type { TargetFrameworkId } from './types.js'
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
