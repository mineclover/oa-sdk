import type { TranslationKeys } from './locales/en.js'

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation'
    resources: { translation: { [K in keyof TranslationKeys]: string } }
  }
}
