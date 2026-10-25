/**
 * RPC Contract Plugin for TypeSpec SSOT
 *
 * Projects the compiled TypeSpec contract onto RPC procedures (`buildRpcContract` of
 * `@oa-sdk/surface-ir`) and emits one module with:
 * - `<Name>Procedures`: input/output types per dotted procedure name
 * - `<name>Contract`: the contract data for `createRpcClient` / `createRpcServer` of `@oa-sdk/rpc`
 *
 * @oa-sdk/codegen
 */

import { buildRpcContract, type BuildRpcContractOptions } from '@oa-sdk/surface-ir'
import type { TspPlugin, TspPluginContext } from '../types.js'
import { generateRpcModule, type RpcModuleOptions } from '../../rpc/generate-rpc-module.js'

export interface PluginRpcOptions extends RpcModuleOptions {
  /** Output path of the RPC module. Default: 'rpc.ts' */
  output?: string | undefined
  /** Procedure naming, body placement, and operation filtering. */
  contract?: BuildRpcContractOptions | undefined
}

export function pluginRpc(options: PluginRpcOptions = {}): TspPlugin<PluginRpcOptions> {
  return {
    name: 'rpc',
    purposes: ['api', 'interface'],

    generate(context: TspPluginContext, opts?: PluginRpcOptions): void {
      const mergedOpts: PluginRpcOptions = { ...options, ...opts }
      const contract = buildRpcContract(context.parsed, mergedOpts.contract)

      for (const diagnostic of contract.diagnostics) {
        context.reportDiagnostic({
          plugin: 'rpc',
          code: diagnostic.code,
          message: diagnostic.message,
          severity: diagnostic.severity,
        })
      }

      const name = mergedOpts.name ?? 'Api'
      const content = generateRpcModule(contract, {
        name,
        ...(mergedOpts.runtimeImport === undefined ? {} : { runtimeImport: mergedOpts.runtimeImport }),
        ...(mergedOpts.banner === undefined ? {} : { banner: mergedOpts.banner }),
      })
      context.addFile({
        path: mergedOpts.output ?? 'rpc.ts',
        content,
        sourcePlugin: 'rpc',
        kind: 'rpc',
        exports: [...content.matchAll(/^export (?:type|const) ([A-Za-z0-9_$]+)/gm)].map(match => match[1]!),
        metadata: { versionHash: contract.versionHash, procedures: Object.keys(contract.procedures) },
      })
    },
  }
}
