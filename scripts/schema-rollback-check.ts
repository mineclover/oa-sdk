/**
 * Prove the staged TypeSpec migration can fall back to the current
 * OpenAPI/Definition Builder production path.
 */

import { spawn } from 'node:child_process'

const steps: Array<{ label: string; args: string[] }> = [
  {
    label: 'TypeSpec production candidate gate',
    args: ['schema:typespec-check'],
  },
  {
    label: 'OpenAPI/Definition Builder rollback gate',
    args: ['schema:validate:openapi'],
  },
]

for (const [index, step] of steps.entries()) {
  console.log('')
  console.log(`Schema rollback check ${index + 1}/${steps.length}: ${step.label}`)
  await run('pnpm', step.args)
}

console.log('')
console.log('Schema rollback check passed')

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: 'inherit',
    })
    child.on('error', rejectRun)
    child.on('close', code => {
      if (code === 0) {
        resolveRun()
        return
      }
      rejectRun(new Error(`Command failed with exit code ${code}: ${command} ${args.join(' ')}`))
    })
  })
}
