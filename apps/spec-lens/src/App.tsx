import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Timeline } from './views/Timeline.js'
import { DiffView } from './views/DiffView.js'
import { PathProvenance } from './views/PathProvenance.js'
import { FragmentGraph } from './views/FragmentGraph.js'
import { api } from './api/client.js'
import { useUrlState, type DashboardUrlState } from './hooks/useUrlState.js'
import { FeedbackProvider } from './components/FeedbackContext.js'
import {
  ScenarioProvider,
  ScenarioProgressHUD,
  ScenarioFlowModal,
  ScenarioSelector,
} from './scenario/index.js'

export function App() {
  return (
    <FeedbackProvider>
      <ScenarioProvider>
        <AppShell />
      </ScenarioProvider>
    </FeedbackProvider>
  )
}

function AppShell() {
  const { t, i18n } = useTranslation()
  const { state: urlState, setView, setDiff } = useUrlState()
  const view = urlState.view

  const { data: serverConfig } = useQuery({
    queryKey: ['config'],
    queryFn: api.config,
    staleTime: Infinity,
  })

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    try {
      return localStorage.getItem('spec-lens-sidebar-collapsed') === 'true'
    } catch {
      return false
    }
  })

  function toggleSidebar() {
    setCollapsed((prev) => {
      const next = !prev
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem('spec-lens-sidebar-collapsed', String(next))
        } catch {
          // ignore
        }
        window.setTimeout(() => {
          window.dispatchEvent(new Event('resize'))
        }, 180)
      }
      return next
    })
  }

  const diffIds =
    view === 'diff' && urlState.baseId && urlState.headId
      ? { base: urlState.baseId, head: urlState.headId }
      : null

  const NAV_ITEMS: Array<{ id: Exclude<DashboardUrlState['view'], 'diff'>; label: string; icon: string }> = [
    { id: 'timeline', label: t('navTimeline'), icon: '⏱' },
    { id: 'paths',    label: t('navPaths'),    icon: '⚡' },
    { id: 'graph',    label: t('navGraph'),    icon: '◎' },
  ]

  function openDiff(baseId: string, headId: string) {
    setDiff(baseId, headId, true)
  }

  function goBack() {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      window.history.back()
    } else {
      setView('timeline', true)
    }
  }

  function toggleLang() {
    const next = i18n.language === 'ko' ? 'en' : 'ko'
    try {
      localStorage.setItem('spec-lens-locale', next)
    } catch {
      // ignore
    }
    void i18n.changeLanguage(next)
  }

  const activeNav = view === 'diff' ? 'timeline' : view

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* Sidebar */}
      <nav
        className={`sidebar${collapsed ? ' collapsed' : ''}`}
        aria-label="Main Navigation"
        style={{
          width: collapsed ? 'var(--sidebar-compact-w)' : 'var(--sidebar-w)',
          background: 'var(--bg-surface)',
          borderRight: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
          transition: 'width 0.15s cubic-bezier(0.4, 0, 0.2, 1)',
          overflow: 'hidden',
        }}
      >
        {/* Logo & Toggle Header */}
        {collapsed ? (
          <div
            style={{
              padding: '12px 8px',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span style={{ fontSize: 20 }} title="spec-lens">
              🔭
            </span>
            <button
              type="button"
              className="sidebar-toggle-btn"
              onClick={toggleSidebar}
              title={t('sidebarExpand')}
              aria-label={t('sidebarExpand')}
              aria-expanded={false}
            >
              ⇥
            </button>
          </div>
        ) : (
          <div
            style={{
              padding: '16px 14px 16px 20px',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <span style={{ fontSize: 18 }}>🔭</span>
              <span
                style={{
                  fontWeight: 700,
                  fontSize: 15,
                  letterSpacing: '-0.3px',
                  whiteSpace: 'nowrap',
                }}
              >
                spec-lens
              </span>
            </div>
            <button
              type="button"
              className="sidebar-toggle-btn"
              onClick={toggleSidebar}
              title={t('sidebarCollapse')}
              aria-label={t('sidebarCollapse')}
              aria-expanded={true}
            >
              ⇤
            </button>
          </div>
        )}

        {/* Target info (expanded only) */}
        {!collapsed && serverConfig !== undefined && (
          <div
            style={{
              padding: '10px 16px',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
          >
            <TargetInfoRow label={t('configTarget')}>
              <span
                title={
                  serverConfig.projectKind === 'definition-builder'
                    ? serverConfig.targetPath
                    : serverConfig.manifestPath
                }
                style={{
                  fontWeight: 600,
                  fontSize: 'var(--text-sm)',
                  color: 'var(--text-primary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {serverConfig.projectKind === 'definition-builder'
                  ? serverConfig.targetName
                  : shortPath(serverConfig.manifestPath)}
              </span>
            </TargetInfoRow>
            <TargetInfoRow label={t('configFragments')}>
              <span
                title={
                  serverConfig.projectKind === 'definition-builder'
                    ? serverConfig.fragmentsDir
                    : serverConfig.projectSourceRoot
                }
                style={{
                  fontFamily: 'monospace',
                  fontSize: 'var(--text-xs)',
                  color: 'var(--text-muted)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {shortPath(
                  serverConfig.projectKind === 'definition-builder'
                    ? serverConfig.fragmentsDir
                    : serverConfig.projectSourceRoot,
                )}
              </span>
            </TargetInfoRow>
            <TargetInfoRow label={t('configSource')}>
              <span className="label">
                {serverConfig.sourceKind}
                {serverConfig.branch ? ` · ${serverConfig.branch}` : ''}
              </span>
            </TargetInfoRow>
          </div>
        )}

        {/* Scenario Selection */}
        {!collapsed && (
          <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
            <ScenarioSelector />
          </div>
        )}

        {/* Nav items */}
        <div style={{ padding: 8, flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setView(item.id)}
              className={`nav-item${collapsed ? ' collapsed' : ''}${activeNav === item.id ? ' active' : ''}`}
              aria-current={activeNav === item.id ? 'page' : undefined}
              title={collapsed ? item.label : undefined}
              aria-label={item.label}
              style={collapsed ? { justifyContent: 'center', padding: '10px 0' } : undefined}
            >
              <span style={{ fontSize: 'var(--text-lg)', flexShrink: 0 }}>{item.icon}</span>
              {!collapsed && <span>{item.label}</span>}
            </button>
          ))}
        </div>

        {/* Footer */}
        {collapsed ? (
          <div
            style={{
              padding: '10px 8px',
              borderTop: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <button
              type="button"
              className="lang-btn"
              onClick={toggleLang}
              title={t('langToggle')}
              style={{ fontSize: 11, padding: '2px 5px' }}
            >
              {i18n.language === 'ko' ? 'EN' : '한'}
            </button>
          </div>
        ) : (
          <div
            style={{
              padding: '10px 16px',
              borderTop: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span className="label">{t('appFooter')}</span>
            <button type="button" className="lang-btn" onClick={toggleLang}>
              {t('langToggle')}
            </button>
          </div>
        )}
      </nav>

      {/* Main content */}
      <main style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <ScenarioProgressHUD />
        <ScenarioFlowModal />
        {view === 'timeline' && <Timeline onSelectDiff={openDiff} />}
        {view === 'diff' && diffIds && (
          <DiffView baseId={diffIds.base} headId={diffIds.head} onBack={goBack} />
        )}
        {view === 'diff' && !diffIds && <Timeline onSelectDiff={openDiff} />}
        {view === 'paths' && <PathProvenance />}
        {view === 'graph' && <FragmentGraph />}
      </main>
    </div>
  )
}

function TargetInfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', flexShrink: 0, width: 62 }}>
        {label}
      </span>
      <span style={{ minWidth: 0, flex: 1 }}>{children}</span>
    </div>
  )
}

function shortPath(full: string): string {
  const parts = full.replace(/\\/g, '/').split('/')
  return parts.slice(-3).join('/')
}
