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
    'invalid-persona-trait': {
      severity: 'error',
      messages: {
        default: paramMessage`Unknown persona capability trait "${'trait'}". Expected one of the 24 standard capability traits from packages/personas/src/traits/skill.yaml.`,
      },
    },
    'invalid-pseudonymize-rule': {
      severity: 'error',
      messages: {
        default: paramMessage`${'message'}`,
      },
    },
    'invalid-crdt-rule': {
      severity: 'error',
      messages: {
        default: paramMessage`${'message'}`,
      },
    },
    'invalid-crdt-entity-rule': {
      severity: 'error',
      messages: {
        default: paramMessage`${'message'}`,
      },
    },
  },
})

export const { reportDiagnostic } = $lib
