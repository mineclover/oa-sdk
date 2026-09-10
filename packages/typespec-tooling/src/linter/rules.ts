import {
  createRule,
  defineLinter,
  getDoc,
  getSourceLocation,
  getSummary,
  paramMessage,
  type Model,
  type Operation,
} from '@typespec/compiler'
import { getExtensions } from '@typespec/openapi'
import { getOperationId } from '@typespec/openapi'

const OPERATION_COMPONENT_REFS_EXTENSION = 'x-oa-sdk-operation-component-refs'

export const requireOperationIdRule = createRule({
  name: 'require-operation-id',
  severity: 'warning',
  description: 'oa-sdk code generation 및 라우팅을 위해 Operation에 @operationId 선언을 권장합니다.',
  messages: {
    default: paramMessage`Operation "${'name'}"에 @operationId 데코레이터가 누락되었습니다.`,
  },
  create(context) {
    return {
      operation(op: Operation) {
        const node = op.node
        if (!node) return
        const operationId = getOperationId(context.program, op)
        if (!operationId) {
          const loc = getSourceLocation(node)
          context.reportDiagnostic({
            format: { name: op.name },
            target: op,
            codefixes: [
              {
                id: 'add-operation-id',
                label: `Add @operationId("${op.name}")`,
                fix: fixContext => {
                  return fixContext.prependText(loc, `@operationId("${op.name}")\n`)
                },
              },
            ],
          })
        }
      },
    }
  },
})

export const requireDocumentationRule = createRule({
  name: 'require-documentation',
  severity: 'warning',
  description: 'API 명세 및 클라이언트 SDK 문서화를 위해 Model 및 Operation에 @doc 또는 @summary 작성을 권장합니다.',
  messages: {
    missingDoc: paramMessage`${'kind'} "${'name'}"에 @doc 설명이 누락되었습니다.`,
  },
  create(context) {
    return {
      operation(op: Operation) {
        const node = op.node
        if (!node) return
        const doc = getDoc(context.program, op)
        const summary = getSummary(context.program, op)
        if (!doc && !summary) {
          const loc = getSourceLocation(node)
          context.reportDiagnostic({
            messageId: 'missingDoc',
            format: { kind: 'Operation', name: op.name },
            target: op,
            codefixes: [
              {
                id: 'add-operation-doc',
                label: `Add @doc("${op.name} 설명")`,
                fix: fixContext => {
                  return fixContext.prependText(loc, `@doc("${op.name} 설명")\n`)
                },
              },
            ],
          })
        }
      },
      model(model: Model) {
        const node = model.node
        if (!model.name || model.name === '' || !node) return
        const doc = getDoc(context.program, model)
        const summary = getSummary(context.program, model)
        if (!doc && !summary) {
          const loc = getSourceLocation(node)
          context.reportDiagnostic({
            messageId: 'missingDoc',
            format: { kind: 'Model', name: model.name },
            target: model,
            codefixes: [
              {
                id: 'add-model-doc',
                label: `Add @doc("${model.name} 설명")`,
                fix: fixContext => {
                  return fixContext.prependText(loc, `@doc("${model.name} 설명")\n`)
                },
              },
            ],
          })
        }
      },
    }
  },
})

export const suggestResponseComponentsRule = createRule({
  name: 'suggest-response-components',
  severity: 'warning',
  description: 'HTTP Operation에 표준 공통 응답(@oaUseResponseComponent) 바인딩을 제안합니다.',
  messages: {
    missing401: paramMessage`Operation "${'name'}"에 401 Unauthorized 공통 응답 바인딩이 누락되었습니다.`,
  },
  create(context) {
    return {
      operation(op: Operation) {
        const node = op.node
        if (!node) return
        const existing = getExtensions(context.program, op).get(OPERATION_COMPONENT_REFS_EXTENSION)
        const responses: Array<{ statusCode: string }> =
          existing && typeof existing === 'object' && 'responses' in existing && Array.isArray((existing as any).responses)
            ? (existing as any).responses
            : []

        const has401 = responses.some(r => r.statusCode === '401')
        if (!has401) {
          const loc = getSourceLocation(node)
          context.reportDiagnostic({
            messageId: 'missing401',
            format: { name: op.name },
            target: op,
            codefixes: [
              {
                id: 'add-401-response-component',
                label: 'Add @oaUseResponseComponent("401", "Unauthorized")',
                fix: fixContext => {
                  return fixContext.prependText(loc, '@oaUseResponseComponent("401", "Unauthorized")\n')
                },
              },
            ],
          })
        }
      },
    }
  },
})

export const oaSdkLinter = defineLinter({
  rules: [requireOperationIdRule, requireDocumentationRule, suggestResponseComponentsRule],
  ruleSets: {
    recommended: {
      enable: {
        '@oa-sdk/typespec-tooling/require-operation-id': true,
        '@oa-sdk/typespec-tooling/require-documentation': true,
        '@oa-sdk/typespec-tooling/suggest-response-components': true,
      },
    },
  },
})
