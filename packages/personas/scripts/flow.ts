/**
 * CLI: pnpm flow
 *
 * Reads persona matrices and emits the dependency graph as markdown
 * (with mermaid flowchart for depends_on chains).
 *
 *   --out=<path>   write to file
 *   (default)      stdout
 */

import { writeFileSync } from 'node:fs'
import { renderFlowMarkdown } from '../src/flow.js'
import { loadAllDomains } from '../src/load.js'

function arg(prefix: string): string | undefined {
  return process.argv.find(a => a.startsWith(prefix))?.slice(prefix.length)
}

function main(): void {
  const outPath = arg('--out=')
  const domains = loadAllDomains()
  const md = renderFlowMarkdown(domains)

  if (outPath) {
    writeFileSync(outPath, md)
    console.error(`📝 wrote ${outPath}`)
  } else {
    process.stdout.write(md)
    if (!md.endsWith('\n')) process.stdout.write('\n')
  }
}

main()
