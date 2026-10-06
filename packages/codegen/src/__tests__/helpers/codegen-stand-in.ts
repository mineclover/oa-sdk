import * as fs from 'node:fs'
import * as path from 'node:path'

/**
 * Installs a stand-in for the published `@oa-sdk/codegen` in the project at `projectDir`, so that the
 * oa.config.ts `oa-gen init` scaffolds, which imports `defineConfig` from it, loads there as it does
 * once the project installed its devDependencies. The stand-in's `defineConfig` returns the
 * configuration unchanged, as the published one does.
 */
export function installCodegenStandIn(projectDir: string): void {
  const codegenDir = path.join(projectDir, 'node_modules', '@oa-sdk', 'codegen')
  fs.mkdirSync(codegenDir, { recursive: true })
  fs.writeFileSync(path.join(codegenDir, 'package.json'), JSON.stringify({
    name: '@oa-sdk/codegen', type: 'module', exports: { '.': './index.js' },
  }))
  fs.writeFileSync(path.join(codegenDir, 'index.js'), 'export const defineConfig = (config) => config\n')
}
