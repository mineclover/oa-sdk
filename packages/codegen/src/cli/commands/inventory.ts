import type { Command } from '../lib/types.js'
import { loadSpecWithPath } from '../lib/load-spec.js'
import { optStr, str } from '../lib/args.js'
import {
  createOpenApiInventory,
  formatOpenApiInventoryMarkdown,
} from '../lib/openapi-inventory.js'
import { commandById, optionDescription } from '../spec/ecs.js'
import { oaGenGovernanceManifest } from '../spec/oa-gen-governance.js'

type InventoryOutputFormat = 'json' | 'markdown'

const inventorySpec = commandById(oaGenGovernanceManifest, 'inventory')

export const inventory: Command = {
  name: inventorySpec.name,
  description: inventorySpec.summary,
  options: {
    spec: {
      type: 'string',
      short: 's',
      required: true,
      description: optionDescription(inventorySpec, 'spec'),
    },
    format: {
      type: 'string',
      short: 'f',
      description: optionDescription(inventorySpec, 'format'),
    },
  },
  async run(args) {
    const loaded = loadSpecWithPath(str(args, 'spec'))
    const report = createOpenApiInventory(loaded.document, { documentPath: loaded.path })
    const format = readFormat(optStr(args, 'format'))

    if (format === 'json') {
      console.log(JSON.stringify(report, null, 2))
      return
    }

    console.log(formatOpenApiInventoryMarkdown(report))
  },
}

function readFormat(format: string | undefined): InventoryOutputFormat {
  if (format === undefined) return 'markdown'
  if (format === 'json' || format === 'markdown') return format
  throw new Error(`unsupported inventory format: ${format}`)
}
