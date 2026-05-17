import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import {
  buildNavItems,
  routeForPath,
  type NavItem,
  type RouteDefinition,
  type RouteId,
} from './navigation/index.js'
import { normalizeLocale, translate, type Locale, type TranslationKey } from './i18n/index.js'
import {
  ContextPage,
  DocsPage,
  IssuesPage,
  OverviewPage,
  SettingsPage,
} from './pages/index.js'

const routeActions: Record<RouteId, TranslationKey> = {
  overview: 'action.overview',
  issues: 'action.issues',
  context: 'action.context',
  docs: 'action.docs',
  settings: 'action.settings',
}

const routeTitleKeys: Record<RouteId, TranslationKey> = {
  overview: 'route.overview.title',
  issues: 'route.issues.title',
  context: 'route.context.title',
  docs: 'route.docs.title',
  settings: 'route.settings.title',
}

const routeDescriptionKeys: Record<RouteId, TranslationKey> = {
  overview: 'route.overview.description',
  issues: 'route.issues.description',
  context: 'route.context.description',
  docs: 'route.docs.description',
  settings: 'route.settings.description',
}

function currentPathname(): string {
  return window.location.pathname
}

function initialLocale(): Locale {
  const stored = window.localStorage.getItem('orchestrator-gitlab-ui.locale')
  if (stored !== null) return normalizeLocale(stored)
  return normalizeLocale(window.navigator.language)
}

function routeTitle(locale: Locale, id: RouteId): string {
  return translate(locale, routeTitleKeys[id])
}

function routeDescription(locale: Locale, id: RouteId): string {
  return translate(locale, routeDescriptionKeys[id])
}

function renderPage(routeId: RouteId, locale: Locale, pathname: string, navigate: (path: string) => void) {
  if (routeId === 'issues') return <IssuesPage locale={locale} pathname={pathname} onNavigate={navigate} />
  if (routeId === 'context') return <ContextPage locale={locale} />
  if (routeId === 'docs') return <DocsPage locale={locale} pathname={pathname} onNavigate={navigate} />
  if (routeId === 'settings') return <SettingsPage locale={locale} />
  return <OverviewPage locale={locale} />
}

function NavLink({
  item,
  locale,
  onNavigate,
}: {
  item: NavItem
  locale: Locale
  onNavigate: (path: string) => void
}) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault()
    onNavigate(item.path)
  }

  return (
    <a
      aria-current={item.active ? 'page' : undefined}
      className={item.active ? 'app-nav-link app-nav-link-active' : 'app-nav-link'}
      href={item.path}
      onClick={handleClick}
    >
      <span className="app-nav-title">{routeTitle(locale, item.id)}</span>
      <span className="app-nav-description">{routeDescription(locale, item.id)}</span>
    </a>
  )
}

export function App() {
  const [pathname, setPathname] = useState(currentPathname)
  const [locale, setLocale] = useState(initialLocale)
  const activeRoute: RouteDefinition = useMemo(() => routeForPath(pathname), [pathname])
  const navItems = useMemo(() => buildNavItems(pathname), [pathname])

  useEffect(() => {
    function handlePopState() {
      setPathname(currentPathname())
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  function navigate(path: string) {
    if (path === pathname) return
    window.history.pushState(null, '', path)
    setPathname(path)
  }

  function changeLocale(nextLocale: Locale) {
    window.localStorage.setItem('orchestrator-gitlab-ui.locale', nextLocale)
    setLocale(nextLocale)
  }

  return (
    <main className="app-shell">
      <aside className="app-sidebar" aria-label="Primary navigation">
        <div className="app-brand">
          <p className="eyebrow">orchestrator-gitlab</p>
          <strong>{translate(locale, 'app.brand')}</strong>
        </div>
        <nav className="app-nav">
          {navItems.map(item => (
            <NavLink item={item} key={item.id} locale={locale} onNavigate={navigate} />
          ))}
        </nav>
        <div className="language-switcher" aria-label="Language">
          <button
            className={locale === 'ko' ? 'language-button language-button-active' : 'language-button'}
            type="button"
            onClick={() => changeLocale('ko')}
          >
            {translate(locale, 'app.language.ko')}
          </button>
          <button
            className={locale === 'en' ? 'language-button language-button-active' : 'language-button'}
            type="button"
            onClick={() => changeLocale('en')}
          >
            {translate(locale, 'app.language.en')}
          </button>
        </div>
      </aside>

      <section className="dashboard app-content">
        <header className="topbar">
          <div>
            <p className="eyebrow">{translate(locale, 'app.context')}</p>
            <h1>{routeTitle(locale, activeRoute.id)}</h1>
            <p className="route-description">{routeDescription(locale, activeRoute.id)}</p>
          </div>
          <button className="button" type="button">
            {translate(locale, routeActions[activeRoute.id])}
          </button>
        </header>

        {renderPage(activeRoute.id, locale, pathname, navigate)}
      </section>
    </main>
  )
}
