#!/usr/bin/env node
/**
 * Local OpenAPI Schema Drift Inspector
 * Inspects drift between managed canonical spec and local runtime (live URL or local artifact).
 *
 * Usage:
 *   pnpm check:local-drift
 *   pnpm check:local-drift --url http://localhost:4010/openapi.json
 *   pnpm check:local-drift --runtime packages/schemas/dist/openapi.json
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import {
  diffOpenApiDocuments,
  formatOpenApiDiff,
} from '../packages/codegen/src/cli/lib/openapi-normalized-diff.js'

async function fetchWithTimeout(url: string, timeoutMs = 3000): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function main() {
  const args = process.argv.slice(2)
  const getArg = (flag: string): string | undefined => {
    const idx = args.indexOf(flag)
    return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined
  }

  const projectRoot = process.cwd()
  const managedFile = getArg('--managed') ?? resolve(projectRoot, 'packages/schemas/typespec/approved.openapi.yaml')
  const customRuntimeFile = getArg('--runtime')
  const customUrl = getArg('--url') ?? 'http://localhost:4010/openapi.json'
  const outputFile = getArg('--output')

  if (!existsSync(managedFile)) {
    console.error(`❌ Managed spec not found: ${managedFile}`)
    process.exit(1)
  }

  console.log(`🔍 Inspecting local OpenAPI drift...`)
  console.log(`   Managed: ${managedFile}`)

  const managedContent = readFileSync(managedFile, 'utf-8')
  const managedDoc = managedFile.endsWith('.json') ? JSON.parse(managedContent) : parseYaml(managedContent)

  let runtimeDoc: Record<string, unknown> | null = null
  let runtimeSourceDescription = ''

  if (customRuntimeFile) {
    const absPath = resolve(projectRoot, customRuntimeFile)
    if (!existsSync(absPath)) {
      console.error(`❌ Custom runtime file not found: ${absPath}`)
      process.exit(1)
    }
    const content = readFileSync(absPath, 'utf-8')
    runtimeDoc = absPath.endsWith('.json') ? JSON.parse(content) : parseYaml(content)
    runtimeSourceDescription = `File (${customRuntimeFile})`
  } else {
    // Try live URL first (e.g. local mock-server)
    console.log(`   Pinging live runtime at ${customUrl}...`)
    const liveBody = await fetchWithTimeout(customUrl)
    if (liveBody) {
      try {
        runtimeDoc = customUrl.endsWith('.yaml') || customUrl.endsWith('.yml')
          ? parseYaml(liveBody)
          : JSON.parse(liveBody)
        runtimeSourceDescription = `Live URL (${customUrl})`
        console.log(`   Connected to live runtime server!`)
      } catch (err) {
        console.warn(`   ⚠️ Live endpoint responded but parsing failed, falling back to local build.`)
      }
    }

    // Fallback to local build artifact if live URL is unavailable
    if (!runtimeDoc) {
      const fallbackFile = resolve(projectRoot, 'packages/schemas/src/.merged.yaml')
      if (existsSync(fallbackFile)) {
        const content = readFileSync(fallbackFile, 'utf-8')
        runtimeDoc = parseYaml(content)
        runtimeSourceDescription = `Local Materialized Spec (packages/schemas/src/.merged.yaml)`
        console.log(`   (Live server not running; comparing with ${runtimeSourceDescription})`)
      } else {
        console.error(`❌ Could not connect to live runtime at ${customUrl} and fallback spec not found.`)
        process.exit(1)
      }
    }
  }

  const diffEntries = diffOpenApiDocuments(managedDoc, runtimeDoc)
  const report = formatOpenApiDiff(diffEntries)

  console.log(`\nRuntime Source: ${runtimeSourceDescription}`)
  console.log('\n' + report + '\n')

  if (outputFile) {
    writeFileSync(resolve(projectRoot, outputFile), report, 'utf-8')
    console.log(`📝 Drift report saved to: ${outputFile}`)
  }

  if (diffEntries.length > 0) {
    console.warn(`⚠️ Drift detected between managed spec and runtime source (${diffEntries.length} items).`)
    if (args.includes('--fail-on-drift')) {
      console.error(`❌ Failed due to schema drift (--fail-on-drift enabled).`)
      process.exit(1)
    }
  } else {
    console.log(`✅ Zero drift detected! Managed specification and runtime are in 100% parity.`)
  }
}

main().catch((err) => {
  console.error('Fatal error during local drift check:', err)
  process.exit(1)
})
