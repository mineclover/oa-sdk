import { useState } from 'react'
import { Timeline } from './views/Timeline.js'
import { DiffView } from './views/DiffView.js'
import { PathProvenance } from './views/PathProvenance.js'
import { FragmentGraph } from './views/FragmentGraph.js'

type View = 'timeline' | 'diff' | 'paths' | 'graph'

const NAV_ITEMS: Array<{ id: Exclude<View, 'diff'>; label: string; icon: string }> = [
  { id: 'timeline', label: 'Timeline',  icon: '⏱' },
  { id: 'paths',    label: 'Paths',     icon: '⚡' },
  { id: 'graph',    label: 'Graph',     icon: '◎' },
]

export function App() {
  const [view, setView] = useState<View>('timeline')
  const [diffIds, setDiffIds] = useState<{ base: string; head: string } | null>(null)

  function openDiff(baseId: string, headId: string) {
    setDiffIds({ base: baseId, head: headId })
    setView('diff')
  }

  function goBack() {
    setView('timeline')
    setDiffIds(null)
  }

  const activeNav = view === 'diff' ? 'timeline' : view

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
            <NavItem
              key={item.id}
              icon={item.icon}
              label={item.label}
              active={activeNav === item.id}
              onClick={() => setView(item.id)}
            />
          ))}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '12px 16px',
            borderTop: '1px solid var(--border)',
            fontSize: 11,
            color: 'var(--text-muted)',
          }}
        >
          @oa-sdk/spec-lens
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

function NavItem({
  icon,
  label,
  active,
  onClick,
}: {
  icon: string
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        padding: '7px 10px',
        borderRadius: 'var(--radius-md)',
        background: active ? 'var(--bg-hover)' : 'none',
        border: 'none',
        color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
        cursor: 'pointer',
        fontSize: 13,
        fontWeight: active ? 600 : 400,
        textAlign: 'left',
        transition: 'background 0.1s, color 0.1s',
      }}
      onMouseEnter={e => {
        if (!active) (e.currentTarget as HTMLElement).style.background = 'var(--bg-elevated)'
      }}
      onMouseLeave={e => {
        if (!active) (e.currentTarget as HTMLElement).style.background = ''
      }}
    >
      <span style={{ fontSize: 15 }}>{icon}</span>
      {label}
    </button>
  )
}
