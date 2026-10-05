import { fileURLToPath } from 'node:url'
import { defineConfig } from 'tsup'
import { workspaceVersionsDefine } from './scripts/workspace-versions.mjs'

// Entries, formats and externals stay on the command line of the `build` script;
// this file only adds what a command line cannot compute.
export default defineConfig({
  define: workspaceVersionsDefine(fileURLToPath(new URL('.', import.meta.url))),
})
