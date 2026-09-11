import {
  type Program,
  type Type,
  type Model,
  type Namespace,
  navigateProgram,
} from '@typespec/compiler'
import { getAllHttpServices } from '@typespec/http'
import { getOperationId } from '@typespec/openapi'

export type TypeSpecChangeSeverity = 'breaking' | 'non-breaking'

export type TypeSpecDiffCode =
  | 'operation-removed'
  | 'route-changed'
  | 'http-method-changed'
  | 'operation-id-changed'
  | 'status-code-removed'
  | 'model-removed'
  | 'property-removed'
  | 'property-required'
  | 'required-property-added'
  | 'property-type-changed'
  | 'parameter-removed'
  | 'parameter-required'
  | 'required-parameter-added'
  | 'parameter-type-changed'
  | 'operation-added'
  | 'model-added'
  | 'property-added'
  | 'property-optional'
  | 'status-code-added'
  | 'parameter-added'
  | 'parameter-optional'

export interface TypeSpecDiffChange {
  code: TypeSpecDiffCode
  target: string
  detail: string
  severity: TypeSpecChangeSeverity
}

export interface TypeSpecDiffResult {
  baseRef: string
  headRef: string
  breakingChanges: TypeSpecDiffChange[]
  nonBreakingChanges: TypeSpecDiffChange[]
  allChanges: TypeSpecDiffChange[]
  summary: {
    totalChanges: number
    breakingCount: number
    nonBreakingCount: number
  }
}

export interface TypeSpecParameterSummary {
  name: string
  paramType: string
  optional: boolean
  typeStr: string
}

export interface TypeSpecOperationSummary {
  signature: string
  verb: string
  path: string
  operationId?: string | undefined
  statusCodes: number[]
  parameters: TypeSpecParameterSummary[]
}

export interface TypeSpecPropertySummary {
  name: string
  optional: boolean
  typeStr: string
}

export interface TypeSpecModelSummary {
  name: string
  properties: Map<string, TypeSpecPropertySummary>
}

export interface TypeSpecSemantics {
  operations: Map<string, TypeSpecOperationSummary>
  models: Map<string, TypeSpecModelSummary>
}

const stdLibNamespaceCache = new WeakMap<Namespace, boolean>()

function isStdLibNamespace(ns: Namespace | undefined): boolean {
  if (!ns || typeof ns !== 'object') return false
  const cached = stdLibNamespaceCache.get(ns)
  if (cached !== undefined) return cached

  let curr: Namespace | undefined = ns
  let isStd = false
  while (curr) {
    if (curr.name === 'TypeSpec') {
      isStd = true
      break
    }
    curr = curr.namespace
  }
  stdLibNamespaceCache.set(ns, isStd)
  return isStd
}

const typeNameCache = new WeakMap<Type, string>()

function computeTypeName(type: Type): string {
  if (type.kind === 'Scalar') {
    return type.name || 'scalar'
  }

  if (type.kind === 'Model') {
    // 1. Array check: model name === 'Array' or integer indexer
    const isArray =
      type.name === 'Array' ||
      Boolean(type.indexer && (type.indexer.key as any)?.name === 'integer')
    if (isArray) {
      const elemType =
        type.indexer?.value ??
        (type as any).templateMapper?.args?.[0] ??
        (type as any).templateArguments?.[0]
      if (elemType) {
        return `${getTypeName(elemType)}[]`
      }
      return 'unknown[]'
    }

    // 2. Record check: model name === 'Record' or string indexer on anonymous model
    const isRecord =
      type.name === 'Record' ||
      Boolean(type.indexer && !type.name && (type.indexer.key as any)?.name === 'string')
    if (isRecord) {
      const valType =
        type.indexer?.value ??
        (type as any).templateMapper?.args?.[0] ??
        (type as any).templateArguments?.[0]
      if (valType) {
        return `Record<${getTypeName(valType)}>`
      }
      return 'Record'
    }

    // 3. Fallback for any other anonymous indexed model
    if (type.indexer && type.indexer.value && !type.name) {
      if ((type.indexer.key as any)?.name === 'string') {
        return `Record<${getTypeName(type.indexer.value)}>`
      }
      return `${getTypeName(type.indexer.value)}[]`
    }

    // 4. Generic/templated model instance (e.g. Page<User>, Pair<string, int32>)
    const templateArgs: any[] =
      (type as any).templateMapper?.args ?? (type as any).templateArguments
    if (templateArgs && templateArgs.length > 0) {
      const baseName = type.name || 'object'
      if (baseName.includes('<')) {
        return baseName
      }
      const argsStr = templateArgs.map(arg => getTypeName(arg as Type)).join(', ')
      return `${baseName}<${argsStr}>`
    }

    if (type.name) {
      return type.name
    }
    return 'object'
  }

  if (type.kind === 'Union') {
    const templateArgs: any[] =
      (type as any).templateMapper?.args ?? (type as any).templateArguments
    if (templateArgs && templateArgs.length > 0 && type.name) {
      const baseName = type.name
      if (!baseName.includes('<')) {
        const argsStr = templateArgs.map(arg => getTypeName(arg as Type)).join(', ')
        return `${baseName}<${argsStr}>`
      }
    }
    if (type.name) return type.name
    if (type.variants) {
      const variantNames = Array.from(type.variants.values())
        .map(v => getTypeName(v.type))
        .filter(Boolean)
      if (variantNames.length > 0) {
        return variantNames.join(' | ')
      }
    }
    return 'union'
  }

  if (type.kind === 'String' || type.kind === 'Number' || type.kind === 'Boolean') {
    return String((type as any).value)
  }

  if (type.kind === 'Enum') {
    return type.name || 'enum'
  }

  if (type.kind === 'Tuple') {
    return `[${type.values.map(getTypeName).join(', ')}]`
  }

  if (type.kind === 'Intrinsic') {
    return (type as any).name || 'intrinsic'
  }

  if ('name' in type && typeof type.name === 'string' && type.name) {
    return type.name
  }

  return type.kind || 'unknown'
}

export function getTypeName(type: Type | undefined): string {
  if (!type || typeof type !== 'object') return 'unknown'
  const cached = typeNameCache.get(type)
  if (cached !== undefined) return cached

  const name = computeTypeName(type)
  typeNameCache.set(type, name)
  return name
}

function extractStatusCodes(responses: readonly { statusCodes?: unknown }[]): number[] {
  const codes = new Set<number>()
  for (const r of responses) {
    const sc = r.statusCodes
    if (typeof sc === 'number') {
      codes.add(sc)
    } else if (Array.isArray(sc)) {
      for (const c of sc) {
        if (typeof c === 'number') codes.add(c)
        else if (typeof c === 'string' && !isNaN(Number(c))) codes.add(Number(c))
      }
    } else if (typeof sc === 'string' && !isNaN(Number(sc))) {
      codes.add(Number(sc))
    }
  }
  return Array.from(codes).sort((a, b) => a - b)
}

export function extractTypeSpecSemantics(program: Program): TypeSpecSemantics {
  const operations = new Map<string, TypeSpecOperationSummary>()
  const models = new Map<string, TypeSpecModelSummary>()
  const capturedOperationIds = new Set<string>()

  // 1. Extract HTTP operations
  const [services] = getAllHttpServices(program)
  for (const service of services ?? []) {
    for (const op of service.operations) {
      const verb = op.verb.toUpperCase()
      const path = op.path
      const signature = `${verb} ${path}`
      const opId = getOperationId(program, op.operation)
      if (opId) {
        capturedOperationIds.add(opId)
      }
      const statusCodes = extractStatusCodes(op.responses)
      const parameters: TypeSpecParameterSummary[] = op.parameters.parameters.map(p => ({
        name: p.name,
        paramType: p.type,
        optional: Boolean(p.param?.optional),
        typeStr: getTypeName(p.param?.type),
      }))

      operations.set(signature, {
        signature,
        verb,
        path,
        operationId: opId,
        statusCodes,
        parameters,
      })
    }
  }

  // 2. Extract non-HTTP user operations and domain models in a single AST traversal pass
  navigateProgram(program, {
    operation(rawOp) {
      if (isStdLibNamespace(rawOp.namespace)) return
      if (capturedOperationIds.has(rawOp.name)) return
      capturedOperationIds.add(rawOp.name)

      const sig = `OP ${rawOp.name}`
      if (!operations.has(sig)) {
        operations.set(sig, {
          signature: sig,
          verb: 'OP',
          path: rawOp.name,
          operationId: rawOp.name,
          statusCodes: [],
          parameters: [],
        })
      }
    },
    model(m: Model) {
      if (!m.name || m.name.startsWith('_') || m.name.includes('<') || isStdLibNamespace(m.namespace)) {
        return
      }
      const props = new Map<string, TypeSpecPropertySummary>()
      for (const [propName, prop] of m.properties) {
        props.set(propName, {
          name: propName,
          optional: Boolean(prop.optional),
          typeStr: getTypeName(prop.type),
        })
      }
      models.set(m.name, {
        name: m.name,
        properties: props,
      })
    },
  })

  return { operations, models }
}

export function diffTypeSpecSemantics(
  base: TypeSpecSemantics,
  head: TypeSpecSemantics,
  options: { baseRef: string; headRef: string },
): TypeSpecDiffResult {
  const breaking: TypeSpecDiffChange[] = []
  const nonBreaking: TypeSpecDiffChange[] = []

  // 1. Operations comparison
  if (base.operations !== head.operations) {
    let matchedBaseOperations = 0
    let headByOpId: Map<string, TypeSpecOperationSummary> | undefined
    let baseByOpId: Map<string, TypeSpecOperationSummary> | undefined

    const getHeadByOpId = (): Map<string, TypeSpecOperationSummary> => {
      if (!headByOpId) {
        headByOpId = new Map()
        for (const op of head.operations.values()) {
          if (op.operationId) headByOpId.set(op.operationId, op)
        }
      }
      return headByOpId
    }

    const getBaseByOpId = (): Map<string, TypeSpecOperationSummary> => {
      if (!baseByOpId) {
        baseByOpId = new Map()
        for (const op of base.operations.values()) {
          if (op.operationId) baseByOpId.set(op.operationId, op)
        }
      }
      return baseByOpId
    }

    for (const [sig, baseOp] of base.operations) {
      const headOp = head.operations.get(sig)
      if (headOp) {
        matchedBaseOperations++

        // Reference identity short-circuit
        if (baseOp === headOp) {
          continue
        }

        // Matched by signature: check operationId drift
        if (baseOp.operationId && headOp.operationId && baseOp.operationId !== headOp.operationId) {
          breaking.push({
            code: 'operation-id-changed',
            target: sig,
            detail: `Operation ${sig} operationId changed from "${baseOp.operationId}" to "${headOp.operationId}".`,
            severity: 'breaking',
          })
        } else if (baseOp.operationId && !headOp.operationId) {
          breaking.push({
            code: 'operation-id-changed',
            target: sig,
            detail: `Operation ${sig} operationId "${baseOp.operationId}" was removed.`,
            severity: 'breaking',
          })
        }

        // Check status code removals and additions
        if (baseOp.statusCodes !== headOp.statusCodes) {
          for (const sc of baseOp.statusCodes) {
            if (!headOp.statusCodes.includes(sc)) {
              breaking.push({
                code: 'status-code-removed',
                target: sig,
                detail: `Response status code ${sc} was removed from ${sig}.`,
                severity: 'breaking',
              })
            }
          }

          for (const sc of headOp.statusCodes) {
            if (!baseOp.statusCodes.includes(sc)) {
              nonBreaking.push({
                code: 'status-code-added',
                target: sig,
                detail: `Response status code ${sc} was added to ${sig}.`,
                severity: 'non-breaking',
              })
            }
          }
        }

        // Check parameter changes
        if (baseOp.parameters !== headOp.parameters) {
          if (baseOp.parameters.length === 0 && headOp.parameters.length === 0) {
            // Both empty, skip map allocation
          } else {
            const headParams = new Map<string, TypeSpecParameterSummary>()
            for (let i = 0; i < headOp.parameters.length; i++) {
              const p = headOp.parameters[i]!
              headParams.set(p.name, p)
            }
            const baseParams = new Map<string, TypeSpecParameterSummary>()
            for (let i = 0; i < baseOp.parameters.length; i++) {
              const p = baseOp.parameters[i]!
              baseParams.set(p.name, p)
            }

            let matchedBaseParams = 0
            for (const [pName, baseP] of baseParams) {
              const headP = headParams.get(pName)
              if (!headP) {
                breaking.push({
                  code: 'parameter-removed',
                  target: `${sig} [${pName}]`,
                  detail: `Parameter "${pName}" (${baseP.paramType}) was removed from ${sig}.`,
                  severity: 'breaking',
                })
              } else {
                matchedBaseParams++
                if (baseP === headP) continue

                if (baseP.optional && !headP.optional) {
                  breaking.push({
                    code: 'parameter-required',
                    target: `${sig} [${pName}]`,
                    detail: `Parameter "${pName}" on ${sig} became required.`,
                    severity: 'breaking',
                  })
                } else if (!baseP.optional && headP.optional) {
                  nonBreaking.push({
                    code: 'parameter-optional',
                    target: `${sig} [${pName}]`,
                    detail: `Parameter "${pName}" on ${sig} became optional.`,
                    severity: 'non-breaking',
                  })
                }

                if (baseP.typeStr !== headP.typeStr) {
                  breaking.push({
                    code: 'parameter-type-changed',
                    target: `${sig} [${pName}]`,
                    detail: `Parameter "${pName}" type on ${sig} changed from "${baseP.typeStr}" to "${headP.typeStr}".`,
                    severity: 'breaking',
                  })
                }
              }
            }

            // Cardinality invariant for added parameters
            if (headParams.size > matchedBaseParams) {
              for (const [pName, headP] of headParams) {
                if (!baseParams.has(pName)) {
                  if (!headP.optional) {
                    breaking.push({
                      code: 'required-parameter-added',
                      target: `${sig} [${pName}]`,
                      detail: `Required parameter "${pName}" (${headP.paramType}) was added to ${sig}.`,
                      severity: 'breaking',
                    })
                  } else {
                    nonBreaking.push({
                      code: 'parameter-added',
                      target: `${sig} [${pName}]`,
                      detail: `Optional parameter "${pName}" (${headP.paramType}) was added to ${sig}.`,
                      severity: 'non-breaking',
                    })
                  }
                }
              }
            }
          }
        }
      } else {
        // Not matched by signature: check if operationId matched an altered route/method via O(1) map
        const candidateHead = baseOp.operationId
          ? getHeadByOpId().get(baseOp.operationId)
          : undefined

        if (candidateHead) {
          if (candidateHead.path !== baseOp.path) {
            breaking.push({
              code: 'route-changed',
              target: baseOp.operationId ?? sig,
              detail: `Operation "${baseOp.operationId}" route changed from "${baseOp.path}" to "${candidateHead.path}".`,
              severity: 'breaking',
            })
          }
          if (candidateHead.verb !== baseOp.verb) {
            breaking.push({
              code: 'http-method-changed',
              target: baseOp.operationId ?? sig,
              detail: `Operation "${baseOp.operationId}" HTTP method changed from "${baseOp.verb}" to "${candidateHead.verb}".`,
              severity: 'breaking',
            })
          }
        } else {
          breaking.push({
            code: 'operation-removed',
            target: sig,
            detail: `Operation ${sig} was removed.`,
            severity: 'breaking',
          })
        }
      }
    }

    // Check added operations with cardinality invariant
    if (head.operations.size > matchedBaseOperations) {
      for (const [sig, headOp] of head.operations) {
        if (!base.operations.has(sig)) {
          const isAltered =
            Boolean(headOp.operationId) &&
            getBaseByOpId().has(headOp.operationId!)
          if (!isAltered) {
            nonBreaking.push({
              code: 'operation-added',
              target: sig,
              detail: `Operation ${sig} was added.`,
              severity: 'non-breaking',
            })
          }
        }
      }
    }
  }

  // 2. Models & Properties comparison
  if (base.models !== head.models) {
    let matchedBaseModels = 0

    for (const [modelName, baseModel] of base.models) {
      const headModel = head.models.get(modelName)
      if (!headModel) {
        breaking.push({
          code: 'model-removed',
          target: modelName,
          detail: `Model "${modelName}" was removed.`,
          severity: 'breaking',
        })
        continue
      }

      matchedBaseModels++

      // Reference identity short-circuit:
      // If the model object itself or its properties map is identical, skip property diffing.
      if (baseModel === headModel || baseModel.properties === headModel.properties) {
        continue
      }

      let matchedBaseProps = 0
      for (const [propName, baseProp] of baseModel.properties) {
        const headProp = headModel.properties.get(propName)
        if (!headProp) {
          breaking.push({
            code: 'property-removed',
            target: `${modelName}.${propName}`,
            detail: `Property "${propName}" was removed from model "${modelName}".`,
            severity: 'breaking',
          })
        } else {
          matchedBaseProps++
          if (baseProp === headProp) continue

          if (baseProp.optional && !headProp.optional) {
            breaking.push({
              code: 'property-required',
              target: `${modelName}.${propName}`,
              detail: `Property "${propName}" on model "${modelName}" became required.`,
              severity: 'breaking',
            })
          } else if (!baseProp.optional && headProp.optional) {
            nonBreaking.push({
              code: 'property-optional',
              target: `${modelName}.${propName}`,
              detail: `Property "${propName}" on model "${modelName}" became optional.`,
              severity: 'non-breaking',
            })
          }
          if (baseProp.typeStr !== headProp.typeStr) {
            breaking.push({
              code: 'property-type-changed',
              target: `${modelName}.${propName}`,
              detail: `Property "${propName}" type on model "${modelName}" changed from "${baseProp.typeStr}" to "${headProp.typeStr}".`,
              severity: 'breaking',
            })
          }
        }
      }

      // Cardinality invariant: only check added properties if head has more properties than were matched
      if (headModel.properties.size > matchedBaseProps) {
        for (const [propName, headProp] of headModel.properties) {
          if (!baseModel.properties.has(propName)) {
            if (!headProp.optional) {
              breaking.push({
                code: 'required-property-added',
                target: `${modelName}.${propName}`,
                detail: `Required property "${propName}" was added to model "${modelName}".`,
                severity: 'breaking',
              })
            } else {
              nonBreaking.push({
                code: 'property-added',
                target: `${modelName}.${propName}`,
                detail: `Optional property "${propName}" was added to model "${modelName}".`,
                severity: 'non-breaking',
              })
            }
          }
        }
      }
    }

    // Cardinality invariant: only check added models if head has more models than were matched
    if (head.models.size > matchedBaseModels) {
      for (const [modelName] of head.models) {
        if (!base.models.has(modelName)) {
          nonBreaking.push({
            code: 'model-added',
            target: modelName,
            detail: `Model "${modelName}" was added.`,
            severity: 'non-breaking',
          })
        }
      }
    }
  }

  const allChanges = [...breaking, ...nonBreaking]
  return {
    baseRef: options.baseRef,
    headRef: options.headRef,
    breakingChanges: breaking,
    nonBreakingChanges: nonBreaking,
    allChanges,
    summary: {
      totalChanges: allChanges.length,
      breakingCount: breaking.length,
      nonBreakingCount: nonBreaking.length,
    },
  }
}

export function diffTypeSpecPrograms(
  baseProgram: Program,
  headProgram: Program,
  options: { baseRef: string; headRef: string },
): TypeSpecDiffResult {
  const baseSemantics = extractTypeSpecSemantics(baseProgram)
  const headSemantics = extractTypeSpecSemantics(headProgram)
  return diffTypeSpecSemantics(baseSemantics, headSemantics, options)
}

export function hasBreakingChanges(result: TypeSpecDiffResult): boolean {
  return result.summary.breakingCount > 0
}

export function formatTypeSpecDiffMarkdown(result: TypeSpecDiffResult): string {
  const lines: string[] = [
    '### TypeSpec Semantic Diff\n',
    `**Base**: \`${result.baseRef}\``,
    `**Head**: \`${result.headRef}\`\n`,
  ]

  if (result.allChanges.length === 0) {
    lines.push('No semantic changes detected.')
    return lines.join('\n')
  }

  const { summary } = result
  const summaryParts: string[] = []
  if (summary.breakingCount > 0) {
    summaryParts.push(`**!${summary.breakingCount}** breaking`)
  }
  if (summary.nonBreakingCount > 0) {
    summaryParts.push(`**+${summary.nonBreakingCount}** non-breaking`)
  }
  summaryParts.push(`**${summary.totalChanges}** total changes`)
  lines.push(`Summary: ${summaryParts.join(' / ')}\n`)

  if (result.breakingChanges.length > 0) {
    lines.push('#### Breaking Changes')
    for (const change of result.breakingChanges) {
      lines.push(`- \`${change.code}\` \`${change.target}\` — ${change.detail}`)
    }
    lines.push('')
  }

  if (result.nonBreakingChanges.length > 0) {
    lines.push('#### Non-Breaking Changes')
    for (const change of result.nonBreakingChanges) {
      lines.push(`- \`${change.code}\` \`${change.target}\` — ${change.detail}`)
    }
    lines.push('')
  }

  return lines.join('\n').trim()
}

export function formatTypeSpecDiffJson(result: TypeSpecDiffResult): string {
  return JSON.stringify(result, null, 2)
}
