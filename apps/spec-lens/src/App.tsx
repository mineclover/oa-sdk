import { useState } from 'react'
import { Timeline } from './views/Timeline.js'
import { DiffView } from './views/DiffView.js'
import { PathProvenance } from './views/PathProvenance.js'
import { FragmentGraph } from './views/FragmentGraph.js'
import { useLocale } from './i18n/index.js'
import type { Locale } from './i18n/index.js'

type View = 'timeline' | 'diff' | 'paths' | 'graph'

export function App() {
  const { t, locale, setLocale } = useLocale()
  const [view, setView] = useState<View>('timeline')
  const [diffIds, setDiffIds] = useState<{ base: string; head: string } | null>(null)

  const NAV_ITEMS: Array<{ id: Exclude<View, 'diff'>; label: string; icon: string }> = [
    { id: 'timeline', label: t.navTimeline, icon: '⏱' },
    { id: 'paths',    label: t.navPaths,    icon: '⚡' },
    { id: 'graph',    label: t.navGraph,    icon: '◎' },
  ]

  function openDiff(baseId: string, headId: string) {
    setDiffIds({ base: baseId, head: headId })
    setView('diff')
  }

  function goBack() {
    setView('timeline')
    setDiffIds(null)
  }

  const activeNav = view === 'diff' ? 'timeline' : view
  const nextLocale: Locale = locale === 'ko' ? 'en' : 'ko'

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* Sidebar */}
      <nav
        style={{
          width: 'var(--sidebar-w)',
          background: 'var(--bg-surface)',
          borderRight: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
        }}
      >
        {/* Logo */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span style={{ fontSize: 18 }}>🔭</span>
          <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: '-0.3px' }}>spec-lens</span>
        </div>

        {/* Nav items */}
        <div style={{ padding: 8, flex: 1 }}>
          {NAV_ITEMS.map(item => (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              className={`nav-item${activeNav === item.id ? ' active' : ''}`}
              aria-current={activeNav === item.id ? 'page' : undefined}
            >
              <span style={{ fontSize: 'var(--text-lg)' }}>{item.icon}</span>
              {item.label}
            </button>
          ))}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '10px 16px',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span className="label">{t.appFooter}</span>
          <button
            className="lang-btn"
            onClick={() => setLocale(nextLocale)}
            title={t.langToggle}
          >
            {t.langToggle}
          </button>
        </div>
      </nav>

      {/* Main content */}
      <main style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {view === 'timeline' && <Timeline onSelectDiff={openDiff} />}
        {view === 'diff' && diffIds && (
          <DiffView baseId={diffIds.base} headId={diffIds.head} onBack={goBack} />
        )}
        {view === 'paths' && <PathProvenance />}
        {view === 'graph' && <FragmentGraph />}
      </main>
    </div>
  )
}
