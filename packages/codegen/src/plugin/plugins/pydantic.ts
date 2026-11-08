import {
  buildPydanticModels,
  type PydanticBuildOptions,
} from '../../pydantic/index.js'
import type { TspPlugin, TspPluginContext } from '../types.js'

export type PluginPydanticOptions = PydanticBuildOptions

export function pydantic(options: PluginPydanticOptions = {}): TspPlugin<PluginPydanticOptions> {
  return {
    name: 'pydantic',
    purposes: ['api', 'data', 'interface'],
    dependencies: [],
    generate: (context: TspPluginContext, hookOptions?: PluginPydanticOptions) => {
      const merged = { ...options, ...hookOptions }
      const result = buildPydanticModels(context.document, {
        ...merged,
        emitOperations: context.config.purpose === 'api' && (merged.emitOperations ?? true),
      })
      for (const file of result.files) context.addFile(file)
      for (const diagnostic of result.diagnostics) {
        context.reportDiagnostic({
          plugin: 'pydantic',
          code: diagnostic.code,
          message: diagnostic.message,
          severity: diagnostic.severity,
          file: diagnostic.pointer,
        })
      }
    },
  }
}

export default pydantic
