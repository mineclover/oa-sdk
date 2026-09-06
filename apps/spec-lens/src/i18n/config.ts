import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.js'
import ko from './locales/ko.js'

const savedLocale = typeof localStorage !== 'undefined' ? localStorage.getItem('spec-lens-locale') ?? 'ko' : 'ko'

i18n
  .use(initReactI18next)
  .init({
    lng: savedLocale,
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false, // React already escapes
    },
    resources: {
      en: { translation: en },
      ko: { translation: ko },
    },
  })

export { i18n }
