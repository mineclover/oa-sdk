import { createContext, useContext, useState, type ReactNode } from 'react'
import type { Locale, Translations } from './translations.js'
import { translations } from './translations.js'

type LocaleContextValue = {
  locale: Locale
  setLocale: (l: Locale) => void
  t: Translations
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: 'ko',
  setLocale: () => {},
  t: translations.ko,
})

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(
    () => (localStorage.getItem('spec-lens-locale') as Locale | null) ?? 'ko',
  )

  function setLocale(l: Locale) {
    localStorage.setItem('spec-lens-locale', l)
    setLocaleState(l)
  }

  return (
    <LocaleContext.Provider value={{ locale, setLocale, t: translations[locale] }}>
      {children}
    </LocaleContext.Provider>
  )
}

export function useLocale(): LocaleContextValue {
  return useContext(LocaleContext)
}
