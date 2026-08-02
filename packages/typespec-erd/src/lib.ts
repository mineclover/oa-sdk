import { createTypeSpecLibrary, paramMessage } from '@typespec/compiler'

export const $lib = createTypeSpecLibrary({
  name: '@oa-sdk/typespec-erd',
  diagnostics: {
    'duplicate-id': {
      severity: 'error',
      messages: { default: paramMessage`Duplicate logical ERD ${'kind'} id "${'id'}".` },
    },
    'missing-field': {
      severity: 'error',
      messages: { default: paramMessage`Logical ERD ${'kind'} requires @field on ${'name'} before it can be referenced.` },
    },
    'invalid-cardinality': {
      severity: 'error',
      messages: { default: paramMessage`Unsupported logical ERD cardinality "${'cardinality'}".` },
    },
    'invalid-key': {
      severity: 'error',
      messages: { default: paramMessage`Invalid logical ERD key declaration: ${'message'}` },
    },
    'missing-dataset': {
      severity: 'error',
      messages: { default: paramMessage`Logical ERD entity "${'name'}" must be declared under a namespace with @dataset.` },
    },
    'invalid-artifact': {
      severity: 'error',
      messages: { default: paramMessage`Unable to emit logical ERD artifact: ${'message'}` },
    },
  },
})

export const { reportDiagnostic } = $lib
