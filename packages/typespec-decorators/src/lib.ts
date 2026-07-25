import { createTypeSpecLibrary, paramMessage } from '@typespec/compiler'

export const $lib = createTypeSpecLibrary({
  name: '@oa-sdk/typespec-decorators',
  diagnostics: {
    'invalid-response-component-reference': {
      severity: 'error',
      messages: {
        default: paramMessage`Response component reference requires a three-digit status code or "default" and a simple component name; received status "${'statusCode'}" and component "${'componentName'}".`,
      },
    },
  },
})

export const { reportDiagnostic } = $lib
