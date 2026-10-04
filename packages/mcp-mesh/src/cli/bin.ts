#!/usr/bin/env node
/**
 * @oa-sdk/mcp-mesh — Standalone CLI Binary
 *
 * Invoked as `oa-mesh` or `oa-tools`.
 */
import { createMeshCli } from './index.js'

const cli = createMeshCli()
cli.parseAsync(process.argv).catch((err) => {
  console.error(err)
  process.exit(1)
})
