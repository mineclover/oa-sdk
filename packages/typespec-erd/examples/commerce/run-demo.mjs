#!/usr/bin/env node
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const exampleDir = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(exampleDir, '../..')
const workspaceRoot = resolve(packageRoot, '../..')
const directory = mkdtempSync(join(tmpdir(), 'oa-sdk-typespec-erd-commerce-example-'))

try {
  cpSync(join(exampleDir, 'main.tsp'), join(directory, 'main.tsp'))
  cpSync(join(exampleDir, 'tspconfig.yaml'), join(directory, 'tspconfig.yaml'))

  const nodeModules = join(directory, 'node_modules')
  mkdirSync(join(nodeModules, '@oa-sdk'), { recursive: true })
  symlinkSync(join(workspaceRoot, 'node_modules', '@typespec'), join(nodeModules, '@typespec'), 'dir')
  symlinkSync(join(workspaceRoot, 'packages', 'logical-erd-contract'), join(nodeModules, '@oa-sdk', 'logical-erd-contract'), 'dir')
  symlinkSync(packageRoot, join(nodeModules, '@oa-sdk', 'typespec-erd'), 'dir')

  const outputDir = join(directory, 'output')
  execFileSync(join(workspaceRoot, 'node_modules', '.bin', 'tsp'), ['compile', directory, '--output-dir', outputDir], {
    cwd: directory,
    stdio: 'inherit',
  })

  const artifactPath = join(outputDir, '@oa-sdk', 'typespec-erd', 'logical-erd.json')
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'))
  console.log(JSON.stringify({
    kind: artifact.kind,
    datasets: artifact.datasets.map(dataset => dataset.id),
    entities: artifact.entities.map(entity => entity.id),
    relationships: artifact.relationships.map(relationship => relationship.id),
    provenanceEntries: artifact.provenance.length,
  }, null, 2))
} finally {
  rmSync(directory, { recursive: true, force: true })
}
