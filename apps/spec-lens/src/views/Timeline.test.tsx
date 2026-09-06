import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { FeedbackProvider } from '../components/FeedbackContext.js'
import { DialogProps } from '../components/Dialog.js'
import { api, type ClearCacheResult, type SpecTimelineEntry } from '../api/client.js'
import { i18n } from '../i18n/config.js'
import { Timeline, TimelineRow } from './Timeline.js'

// Track Dialog props for FeedbackProvider confirmation interception
let capturedDialogProps: DialogProps[] = []

vi.mock('../components/Dialog.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../components/Dialog.js')>()
  return {
    ...actual,
    Dialog: (props: DialogProps) => {
      capturedDialogProps.push(props)
      return actual.Dialog(props)
    },
  }
})

// Setup lightweight DOM Mock for React 19 testing in Node
function setupMockDom() {
  class MockNode {
    nodeType: number
    nodeName: string
    childNodes: MockNode[] = []
    listeners: Record<string, Function[]> = {}
    attributes: Record<string, string> = {}
    style: Record<string, string> = {}
    options: MockNode[] = []
    ownerDocument: any = null
    parentNode: MockNode | null = null
    nodeValue = ''
    textContent = ''
    value = ''
    name = ''
    type = ''
    placeholder = ''
    checked = false
    disabled = false
    selected = false

    constructor(nodeType: number, nodeName: string) {
      this.nodeType = nodeType
      this.nodeName = nodeName
    }
    appendChild(c: MockNode) {
      this.childNodes.push(c)
      c.parentNode = this
      if (c.nodeName === 'OPTION') {
        this.options.push(c)
      }
      return c
    }
    removeChild(c: MockNode) {
      this.childNodes = this.childNodes.filter((x) => x !== c)
      this.options = this.options.filter((x) => x !== c)
      c.parentNode = null
      return c
    }
    insertBefore(c: MockNode, b: MockNode) {
      const idx = this.childNodes.indexOf(b)
      if (idx >= 0) this.childNodes.splice(idx, 0, c)
      else this.childNodes.push(c)
      if (c.nodeName === 'OPTION') {
        this.options.push(c)
      }
      c.parentNode = this
      return c
    }
    setAttribute(k: string, v: string) {
      this.attributes[k] = v
      ;(this as any)[k] = v
    }
    getAttribute(k: string) {
      return this.attributes[k] ?? (this as any)[k] ?? null
    }
    hasAttribute(k: string) {
      return k in this.attributes || (this as any)[k] !== undefined
    }
    removeAttribute(k: string) {
      delete this.attributes[k]
      delete (this as any)[k]
    }
    addEventListener(t: string, fn: Function) {
      if (!this.listeners[t]) this.listeners[t] = []
      this.listeners[t].push(fn)
    }
    removeEventListener(t: string, fn: Function) {
      if (this.listeners[t]) {
        this.listeners[t] = this.listeners[t].filter((f) => f !== fn)
      }
    }
    dispatchEvent(ev: any) {
      ev.target = this
      let curr: MockNode | null = this
      while (curr) {
        const list = curr.listeners[ev.type]
        if (list) {
          for (const fn of list) fn.call(curr, ev)
        }
        if (ev.cancelBubble) break
        curr = curr.parentNode
      }
      return true
    }
    focus() {}
    blur() {}
  }

  class MockElement extends MockNode {
    tagName: string
    constructor(tag: string) {
      super(1, tag.toUpperCase())
      this.tagName = tag.toUpperCase()
    }
  }

  class MockDocument extends MockNode {
    documentElement: MockElement
    head: MockElement
    body: MockElement
    activeElement: MockElement
    defaultView: any

    constructor() {
      super(9, '#document')
      this.documentElement = new MockElement('html')
      this.head = new MockElement('head')
      this.body = new MockElement('body')
      this.activeElement = this.body
      this.defaultView = {
        document: this,
        addEventListener() {},
        removeEventListener() {},
        HTMLIFrameElement: function () {},
      }
    }
    createElement(tag: string) {
      const el = new MockElement(tag)
      el.ownerDocument = this
      return el
    }
    createTextNode(t: string) {
      const n = new MockNode(3, '#text')
      n.nodeValue = t
      n.textContent = t
      n.ownerDocument = this
      return n
    }
    createElementNS(_ns: string, tag: string) {
      return this.createElement(tag)
    }
  }

  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  const doc = new MockDocument()
  doc.ownerDocument = doc
  doc.documentElement.ownerDocument = doc
  doc.head.ownerDocument = doc
  doc.body.ownerDocument = doc

  ;(globalThis as any).document = doc
  ;(globalThis as any).window = doc.defaultView

  return { doc }
}

function getReactProps(node: any): any {
  if (!node) return null
  const key = Object.keys(node).find((k) => k.startsWith('__reactProps'))
  return key ? node[key] : null
}

function getNodeText(node: any): string {
  if (!node) return ''
  const props = getReactProps(node)
  if (!props) return node.textContent || node.nodeValue || ''
  const ch = props.children
  if (Array.isArray(ch)) {
    return ch
      .filter(Boolean)
      .map((c) => (typeof c === 'object' && c !== null ? getNodeText(c) : String(c)))
      .join('')
  }
  if (typeof ch === 'object' && ch !== null) {
    return getNodeText(ch)
  }
  return String(ch ?? '')
}

function findNodes(root: any, predicate: (node: any) => boolean): any[] {
  const results: any[] = []
  function walk(n: any) {
    if (predicate(n)) results.push(n)
    if (n.childNodes) {
      for (const child of n.childNodes) walk(child)
    }
  }
  walk(root)
  return results
}

function findNode(root: any, predicate: (node: any) => boolean): any | null {
  const all = findNodes(root, predicate)
  return all.length > 0 ? all[0] : null
}

function findButtonWithText(root: any, text: string): any | null {
  return findNode(root, (n) => {
    if (n.tagName !== 'BUTTON') return false
    const str = getNodeText(n)
    return str.includes(text)
  })
}

function findBaseRadios(root: any): any[] {
  return findNodes(root, (n) => {
    if (n.tagName !== 'INPUT') return false
    const p = getReactProps(n)
    return p?.name === 'diff-base-selection' || n.name === 'diff-base-selection' || n.getAttribute('name') === 'diff-base-selection'
  })
}

function findHeadRadios(root: any): any[] {
  return findNodes(root, (n) => {
    if (n.tagName !== 'INPUT') return false
    const p = getReactProps(n)
    return p?.name === 'diff-head-selection' || n.name === 'diff-head-selection' || n.getAttribute('name') === 'diff-head-selection'
  })
}

function findSearchInput(root: any): any | null {
  return findNode(root, (n) => {
    if (n.tagName !== 'INPUT') return false
    const p = getReactProps(n)
    return (
      p?.placeholder?.includes('Search') ||
      n.placeholder?.includes('Search') ||
      n.getAttribute('placeholder')?.includes('Search')
    )
  })
}

// Mock Timeline Entries
const mockEntries: SpecTimelineEntry[] = [
  {
    revision: {
      id: 'rev0000000000000000000000000000000000000',
      shortId: 'rev0000',
      message: 'feat: add user profile endpoints',
      author: 'Alice Engineer <alice@example.com>',
      timestamp: 1725600000000,
      source: 'github',
      sourceRef: 'main',
    },
    snapshotCached: true,
    affectedFiles: ['schemas/user.yaml', 'api/openapi.yaml'],
    diffStats: {
      pathsAdded: 2,
      pathsRemoved: 0,
      pathsChanged: 1,
      breakingChanges: 0,
    },
  },
  {
    revision: {
      id: 'rev1111111111111111111111111111111111111',
      shortId: 'rev1111',
      message: 'feat!: breaking change to auth flow',
      author: 'Bob Developer <bob@example.com>',
      timestamp: 1725590000000,
      source: 'local-git',
    },
    snapshotCached: true,
    affectedFiles: ['schemas/auth.yaml'],
    diffStats: {
      pathsAdded: 0,
      pathsRemoved: 1,
      pathsChanged: 2,
      breakingChanges: 3, // Breaking changes!
    },
  },
  {
    revision: {
      id: 'rev2222222222222222222222222222222222222',
      shortId: 'rev2222',
      message: 'fix: resolve parameter validation issue',
      author: 'Charlie QA <charlie@example.com>',
      timestamp: 1725580000000,
      source: 'gitlab',
    },
    snapshotCached: false, // Build failed
    affectedFiles: ['schemas/params.yaml'],
    diffStats: {
      pathsAdded: 0,
      pathsRemoved: 0,
      pathsChanged: 0,
      breakingChanges: 0,
    },
  },
  {
    revision: {
      id: 'rev3333333333333333333333333333333333333',
      shortId: 'rev3333',
      message: 'chore: initial commit',
      author: 'Alice Engineer <alice@example.com>',
      timestamp: 1725570000000,
      source: 'local-git',
    },
    snapshotCached: true,
    affectedFiles: ['README.md'],
    diffStats: {
      pathsAdded: 1,
      pathsRemoved: 0,
      pathsChanged: 0,
      breakingChanges: 0,
    },
  },
]

describe('Timeline View — Static Markup & Bilingual Rendering', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('renders loading spinner when query is in isLoading state', () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })

    const html = renderToStaticMarkup(
      <QueryClientProvider client={qc}>
        <FeedbackProvider>
          <Timeline onSelectDiff={vi.fn()} />
        </FeedbackProvider>
      </QueryClientProvider>,
    )

    expect(html).toContain('animation:spin')
    expect(html).toContain('border-top-color:var(--blue)')
  })

  it('renders error container when timeline query fails', async () => {
    vi.spyOn(api, 'timeline').mockRejectedValue(new Error('Failed to reach server'))
    const { doc } = setupMockDom()
    const container = doc.createElement('div')
    const root = createRoot(container as any)
    const errQc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })

    await act(async () => {
      root.render(
        <QueryClientProvider client={errQc}>
          <FeedbackProvider>
            <Timeline onSelectDiff={vi.fn()} />
          </FeedbackProvider>
        </QueryClientProvider>,
      )
    })

    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })

    const errorEl = findNode(container, (n) => {
      const text = getNodeText(n)
      return text.includes('Failed to load diff')
    })
    expect(errorEl).not.toBeNull()
    expect(getNodeText(errorEl)).toContain('Failed to reach server')
  })

  it('renders empty placeholder when timeline has 0 revisions', () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    qc.setQueryData(['timeline', 100], [])

    const html = renderToStaticMarkup(
      <QueryClientProvider client={qc}>
        <FeedbackProvider>
          <Timeline onSelectDiff={vi.fn()} />
        </FeedbackProvider>
      </QueryClientProvider>,
    )

    expect(html).toContain('No revisions yet. Click Refresh to fetch from the source.')
  })

  it('renders revisions list, commit metadata, badges, and controls in English', () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    qc.setQueryData(['timeline', 100], mockEntries)

    const html = renderToStaticMarkup(
      <QueryClientProvider client={qc}>
        <FeedbackProvider>
          <Timeline onSelectDiff={vi.fn()} />
        </FeedbackProvider>
      </QueryClientProvider>,
    )

    // Header & counters
    expect(html).toContain('Timeline')
    expect(html).toContain('4 revisions')
    expect(html).toContain('Clear cache')
    expect(html).toContain('↻ Refresh')

    // Search input & Breaking filter chip
    expect(html).toContain('Search commits (message, SHA, author)…')
    expect(html).toContain('⚡ Breaking (1)')
    expect(html).toContain('Select to Compare')

    // Entries
    expect(html).toContain('rev0000')
    expect(html).toContain('feat: add user profile endpoints')
    expect(html).toContain('Alice Engineer')

    expect(html).toContain('rev1111')
    expect(html).toContain('feat!: breaking change to auth flow')
    expect(html).toContain('⚡3')

    expect(html).toContain('rev2222')
    expect(html).toContain('build failed')

    expect(html).toContain('rev3333')
    expect(html).toContain('chore: initial commit')

    // Dual Base/Head radio inputs
    expect(html).toContain('name="diff-base-selection"')
    expect(html).toContain('name="diff-head-selection"')
  })

  it('renders bilingual translations accurately in Korean', async () => {
    await i18n.changeLanguage('ko')
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    qc.setQueryData(['timeline', 100], mockEntries)

    const html = renderToStaticMarkup(
      <QueryClientProvider client={qc}>
        <FeedbackProvider>
          <Timeline onSelectDiff={vi.fn()} />
        </FeedbackProvider>
      </QueryClientProvider>,
    )

    expect(html).toContain('타임라인')
    expect(html).toContain('revision 4개')
    expect(html).toContain('캐시 초기화')
    expect(html).toContain('선택 비교 모드')
    expect(html).toContain('커밋 검색 (메시지, SHA, 작성자)…')
    expect(html).toContain('빌드 실패')
  })
})

describe('Timeline Component Interactive Tests', () => {
  let doc: any
  let container: any
  let qc: QueryClient
  let onSelectDiff: any

  let currentRoot: any = null

  beforeEach(async () => {
    await i18n.changeLanguage('en')
    capturedDialogProps = []
    const env = setupMockDom()
    doc = env.doc
    container = doc.createElement('div')
    qc = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity, refetchInterval: false },
        mutations: { retry: false },
      },
    })
    qc.setQueryData(['timeline', 100], mockEntries)
    vi.spyOn(api, 'timeline').mockResolvedValue(mockEntries)
    onSelectDiff = vi.fn()
  })

  afterEach(async () => {
    if (currentRoot) {
      await act(async () => {
        currentRoot.unmount()
      })
      currentRoot = null
    }
    vi.restoreAllMocks()
  })

  async function renderTimeline() {
    const root = createRoot(container as any)
    currentRoot = root
    await act(async () => {
      root.render(
        <QueryClientProvider client={qc}>
          <FeedbackProvider>
            <Timeline onSelectDiff={onSelectDiff} />
          </FeedbackProvider>
        </QueryClientProvider>,
      )
    })
    return { root, container }
  }

  it('toggles compare mode and auto-populates head=index[0] and base=index[1]', async () => {
    await renderTimeline()

    // Find "Select to Compare" button
    const compareModeBtn = findButtonWithText(container, 'Select to Compare')
    expect(compareModeBtn).not.toBeNull()

    // Click "Select to Compare"
    await act(async () => {
      getReactProps(compareModeBtn).onClick()
    })

    // Compare bar should now be visible with Compare Action Button
    const compareActionBtn = findButtonWithText(container, 'Compare (rev1111 … rev0000)')
    expect(compareActionBtn).not.toBeNull()
    expect(getReactProps(compareActionBtn).disabled).toBe(false)

    // Click Compare button -> invokes onSelectDiff(baseId, headId)
    await act(async () => {
      getReactProps(compareActionBtn).onClick()
    })
    expect(onSelectDiff).toHaveBeenCalledWith(
      'rev1111111111111111111111111111111111111',
      'rev0000000000000000000000000000000000000',
    )
  })

  it('supports arbitrary 2-commit selection via dual Base and Head radio buttons', async () => {
    await renderTimeline()

    // Find all Base and Head radios
    const baseRadios = findBaseRadios(container)
    const headRadios = findHeadRadios(container)

    expect(baseRadios.length).toBe(4)
    expect(headRadios.length).toBe(4)

    // Select commit 3 (chore: initial commit) as Base
    await act(async () => {
      getReactProps(baseRadios[3]).onChange()
    })

    // Select commit 0 (feat: add user profile endpoints) as Head
    await act(async () => {
      getReactProps(headRadios[0]).onChange()
    })

    // Verify Compare button is enabled with arbitrary commits: (rev3333 … rev0000)
    const compareActionBtn = findButtonWithText(container, 'Compare (rev3333 … rev0000)')
    expect(compareActionBtn).not.toBeNull()
    expect(getReactProps(compareActionBtn).disabled).toBe(false)

    // Click compare
    await act(async () => {
      getReactProps(compareActionBtn).onClick()
    })
    expect(onSelectDiff).toHaveBeenCalledWith(
      'rev3333333333333333333333333333333333333',
      'rev0000000000000000000000000000000000000',
    )
  })

  it('swaps Base and Head commits when Swap button is clicked', async () => {
    await renderTimeline()

    const baseRadios = findBaseRadios(container)
    const headRadios = findHeadRadios(container)

    // Set Base = rev3333, Head = rev0000
    await act(async () => {
      getReactProps(baseRadios[3]).onChange()
    })
    await act(async () => {
      getReactProps(headRadios[0]).onChange()
    })

    // Find Swap button ⇄
    const swapBtn = findButtonWithText(container, '⇄')
    expect(swapBtn).not.toBeNull()
    expect(getReactProps(swapBtn).title).toBe('Swap Base ⇄ Head')

    // Click Swap button
    await act(async () => {
      getReactProps(swapBtn).onClick()
    })

    // Now Base should be rev0000, Head should be rev3333
    const swappedCompareBtn = findButtonWithText(container, 'Compare (rev0000 … rev3333)')
    expect(swappedCompareBtn).not.toBeNull()

    // Trigger compare to verify swapped IDs
    await act(async () => {
      getReactProps(swappedCompareBtn).onClick()
    })
    expect(onSelectDiff).toHaveBeenCalledWith(
      'rev0000000000000000000000000000000000000',
      'rev3333333333333333333333333333333333333',
    )
  })

  it('validates distinct commits: disables Compare button and shows error alert when Base === Head', async () => {
    await renderTimeline()

    const baseRadios = findBaseRadios(container)
    const headRadios = findHeadRadios(container)

    // Select rev1111 for both Base and Head
    await act(async () => {
      getReactProps(baseRadios[1]).onChange()
    })
    await act(async () => {
      getReactProps(headRadios[1]).onChange()
    })

    // Find alert element
    const alertEl = findNode(container, (n) => n.getAttribute('role') === 'alert')
    expect(alertEl).not.toBeNull()
    expect(getNodeText(alertEl)).toContain('Base and Head must be distinct revisions')

    // Compare button must be disabled
    const compareBtn = findButtonWithText(container, 'Compare')
    expect(compareBtn).not.toBeNull()
    expect(getReactProps(compareBtn).disabled).toBe(true)

    // Attempting to click disabled compare button does not invoke onSelectDiff
    await act(async () => {
      getReactProps(compareBtn).onClick()
    })
    expect(onSelectDiff).not.toHaveBeenCalled()
  })

  it('cancels selection and resets state when Cancel Selection is clicked', async () => {
    await renderTimeline()

    // Turn on compare mode
    const compareModeBtn = findButtonWithText(container, 'Select to Compare')
    await act(async () => {
      getReactProps(compareModeBtn).onClick()
    })

    // Action bar exists
    expect(findNode(container, (n) => n.getAttribute('role') === 'region')).not.toBeNull()

    // Find "Cancel Selection" button in action bar
    const cancelBtn = findButtonWithText(container, 'Cancel Selection')
    expect(cancelBtn).not.toBeNull()

    // Click cancel
    await act(async () => {
      getReactProps(cancelBtn).onClick()
    })

    // Action bar disappears
    expect(findNode(container, (n) => n.getAttribute('role') === 'region')).toBeNull()
  })

  it('filters commits by Breaking changes toggle chip (⚡)', async () => {
    await renderTimeline()

    // Initial count: 4 rows
    expect(findBaseRadios(container).length).toBe(4)

    // Find Breaking chip button
    const breakingChip = findButtonWithText(container, '⚡ Breaking (1)')
    expect(breakingChip).not.toBeNull()

    // Click Breaking chip to activate filter
    await act(async () => {
      getReactProps(breakingChip).onClick()
    })

    // Only 1 commit (rev1111) has breakingChanges > 0
    const filteredRadios = findBaseRadios(container)
    expect(filteredRadios.length).toBe(1)
    expect(getReactProps(filteredRadios[0]).value).toBe(
      'rev1111111111111111111111111111111111111',
    )

    // Match indicator shows 1 revision matches
    const matchIndicator = findNode(container, (n) => {
      const text = getNodeText(n)
      return text.includes('1 revision match')
    })
    expect(matchIndicator).not.toBeNull()

    // Click again to deactivate filter
    await act(async () => {
      getReactProps(breakingChip).onClick()
    })
    expect(findBaseRadios(container).length).toBe(4)
  })

  it('filters commits in real time by search query across SHA, message, and author', async () => {
    await renderTimeline()

    // Find search input
    const searchInput = findSearchInput(container)
    expect(searchInput).not.toBeNull()

    // Filter by author "Charlie"
    await act(async () => {
      getReactProps(searchInput).onChange({ target: { value: 'charlie' } })
    })

    let matched = findBaseRadios(container)
    expect(matched.length).toBe(1)
    expect(getReactProps(matched[0]).value).toBe('rev2222222222222222222222222222222222222')

    // Filter by short SHA "rev3333"
    await act(async () => {
      getReactProps(searchInput).onChange({ target: { value: 'rev3333' } })
    })
    matched = findBaseRadios(container)
    expect(matched.length).toBe(1)
    expect(getReactProps(matched[0]).value).toBe('rev3333333333333333333333333333333333333')

    // Filter by message substring "profile"
    await act(async () => {
      getReactProps(searchInput).onChange({ target: { value: 'profile' } })
    })
    matched = findBaseRadios(container)
    expect(matched.length).toBe(1)
    expect(getReactProps(matched[0]).value).toBe('rev0000000000000000000000000000000000000')

    // Clear search button (×) appears when search query is active
    const clearInputBtn = findButtonWithText(container, '×')
    expect(clearInputBtn).not.toBeNull()

    await act(async () => {
      getReactProps(clearInputBtn).onClick()
    })
    expect(findBaseRadios(container).length).toBe(4)
  })

  it('renders "No revisions match the filter" and resets via "Clear filters" button', async () => {
    await renderTimeline()

    const searchInput = findSearchInput(container)

    // Search for non-existent keyword
    await act(async () => {
      getReactProps(searchInput).onChange({ target: { value: 'non_existent_commit_token' } })
    })

    // Rows should be 0
    expect(findBaseRadios(container).length).toBe(0)

    // Empty state message and Clear filters button
    const noMatchText = findNode(container, (n) => {
      return getNodeText(n).includes('No revisions match the filter.')
    })
    expect(noMatchText).not.toBeNull()

    const clearFiltersBtn = findButtonWithText(container, 'Clear filters')
    expect(clearFiltersBtn).not.toBeNull()

    // Click "Clear filters"
    await act(async () => {
      getReactProps(clearFiltersBtn).onClick()
    })

    // All 4 commits restored
    expect(findBaseRadios(container).length).toBe(4)
  })

  it('integrates cache clearing with in-app Dialog confirmation and Toast success feedback', async () => {
    const clearCacheSpy = vi.spyOn(api, 'clearCache').mockResolvedValue({
      deletedSnapshots: 5,
      deletedDiffs: 10,
    } as any)

    await renderTimeline()

    // Find "Clear cache" button
    const clearCacheBtn = findButtonWithText(container, 'Clear cache')
    expect(clearCacheBtn).not.toBeNull()

    // Click "Clear cache" -> triggers confirm dialog
    await act(async () => {
      getReactProps(clearCacheBtn).onClick()
    })

    // Confirm dialog is active
    expect(capturedDialogProps.length).toBeGreaterThan(0)
    const activeDialog = capturedDialogProps[capturedDialogProps.length - 1]!
    expect(activeDialog.open).toBe(true)
    expect(activeDialog.danger).toBe(true)
    expect(activeDialog.title).toBe('Clear cache')
    expect(activeDialog.message).toBe(
      'Clear all cached snapshots and diffs? This cannot be undone.',
    )

    // User confirms
    await act(async () => {
      activeDialog.onConfirm()
    })

    expect(clearCacheSpy).toHaveBeenCalledTimes(1)

    // Wait for mutation resolution and toast rendering
    await act(async () => {
      await Promise.resolve()
      await new Promise((r) => setTimeout(r, 20))
    })

    // Verify toast was created
    const toastMessage = findNode(container, (n) => {
      return getNodeText(n).includes('Cache cleared (5 snapshots, 10 diffs)')
    })
    expect(toastMessage).not.toBeNull()
  })

  it('aborts cache clearing when Dialog is cancelled by user', async () => {
    const clearCacheSpy = vi.spyOn(api, 'clearCache')

    await renderTimeline()

    const clearCacheBtn = findButtonWithText(container, 'Clear cache')

    await act(async () => {
      getReactProps(clearCacheBtn).onClick()
    })

    const activeDialog = capturedDialogProps[capturedDialogProps.length - 1]!
    expect(activeDialog.open).toBe(true)

    // User cancels dialog
    await act(async () => {
      activeDialog.onCancel()
    })

    expect(clearCacheSpy).not.toHaveBeenCalled()
  })

  it('triggers error toast feedback when api.clearCache rejects', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(api, 'clearCache').mockRejectedValue(new Error('Permission denied'))

    await renderTimeline()

    const clearCacheBtn = findButtonWithText(container, 'Clear cache')

    await act(async () => {
      getReactProps(clearCacheBtn).onClick()
    })

    const activeDialog = capturedDialogProps[capturedDialogProps.length - 1]!
    await act(async () => {
      activeDialog.onConfirm()
    })

    await act(async () => {
      await Promise.resolve()
      await new Promise((r) => setTimeout(r, 20))
    })

    // Error toast appears
    const errorToast = findNode(container, (n) => {
      return getNodeText(n).includes('Failed to clear cache.')
    })
    expect(errorToast).not.toBeNull()
  })
})

describe('TimelineRow Component Unit Tests', () => {
  const prevEntry = mockEntries[1]!
  const targetEntry = mockEntries[0]!

  it('renders default unselected state with hoverable class and view diff link', () => {
    const onSelectDiff = vi.fn()
    const html = renderToStaticMarkup(
      <TimelineRow
        entry={targetEntry}
        prev={prevEntry}
        isBase={false}
        isHead={false}
        compareMode={false}
        onSelectBase={vi.fn()}
        onSelectHead={vi.fn()}
        onSelectDiff={onSelectDiff}
      />,
    )

    expect(html).toContain('feat: add user profile endpoints')
    expect(html).toContain('view diff →')
    expect(html).toContain('class="hoverable"')
  })

  it('applies red accent styling when isBase is true', () => {
    const html = renderToStaticMarkup(
      <TimelineRow
        entry={targetEntry}
        prev={prevEntry}
        isBase={true}
        isHead={false}
        compareMode={true}
        onSelectBase={vi.fn()}
        onSelectHead={vi.fn()}
        onSelectDiff={vi.fn()}
      />,
    )

    expect(html).toContain('border-left:3px solid var(--red)')
    expect(html).toContain('background:rgba(248, 81, 73, 0.10)')
  })

  it('applies green accent styling when isHead is true', () => {
    const html = renderToStaticMarkup(
      <TimelineRow
        entry={targetEntry}
        prev={prevEntry}
        isBase={false}
        isHead={true}
        compareMode={true}
        onSelectBase={vi.fn()}
        onSelectHead={vi.fn()}
        onSelectDiff={vi.fn()}
      />,
    )

    expect(html).toContain('border-left:3px solid var(--green)')
    expect(html).toContain('background:rgba(63, 185, 80, 0.10)')
  })

  it('applies amber accent styling when both isBase and isHead are true (same commit)', () => {
    const html = renderToStaticMarkup(
      <TimelineRow
        entry={targetEntry}
        prev={prevEntry}
        isBase={true}
        isHead={true}
        compareMode={true}
        onSelectBase={vi.fn()}
        onSelectHead={vi.fn()}
        onSelectDiff={vi.fn()}
      />,
    )

    expect(html).toContain('border-left:3px solid var(--amber)')
    expect(html).toContain('background:rgba(227, 179, 65, 0.12)')
  })

  it('invokes onSelectDiff when row is clicked outside compare mode', () => {
    const onSelectDiff = vi.fn()
    const { doc } = setupMockDom()
    const container = doc.createElement('div')
    const root = createRoot(container as any)

    act(() => {
      root.render(
        <TimelineRow
          entry={targetEntry}
          prev={prevEntry}
          isBase={false}
          isHead={false}
          compareMode={false}
          onSelectBase={vi.fn()}
          onSelectHead={vi.fn()}
          onSelectDiff={onSelectDiff}
        />,
      )
    })

    const row = container.childNodes[0]
    act(() => {
      getReactProps(row).onClick()
    })

    expect(onSelectDiff).toHaveBeenCalledWith(prevEntry.revision.id, targetEntry.revision.id)
  })

  it('sets Head when unselected row is clicked during compare mode', () => {
    const onSelectHead = vi.fn()
    const onSelectDiff = vi.fn()
    const { doc } = setupMockDom()
    const container = doc.createElement('div')
    const root = createRoot(container as any)

    act(() => {
      root.render(
        <TimelineRow
          entry={targetEntry}
          prev={prevEntry}
          isBase={false}
          isHead={false}
          compareMode={true}
          onSelectBase={vi.fn()}
          onSelectHead={onSelectHead}
          onSelectDiff={onSelectDiff}
        />,
      )
    })

    const row = container.childNodes[0]
    act(() => {
      getReactProps(row).onClick()
    })

    expect(onSelectHead).toHaveBeenCalledWith(targetEntry.revision.id)
    expect(onSelectDiff).not.toHaveBeenCalled()
  })

  it('does not invoke onSelectDiff when initial commit (without prev) is clicked', () => {
    const onSelectDiff = vi.fn()
    const { doc } = setupMockDom()
    const container = doc.createElement('div')
    const root = createRoot(container as any)

    act(() => {
      root.render(
        <TimelineRow
          entry={mockEntries[3]!}
          prev={undefined}
          isBase={false}
          isHead={false}
          compareMode={false}
          onSelectBase={vi.fn()}
          onSelectHead={vi.fn()}
          onSelectDiff={onSelectDiff}
        />,
      )
    })

    const row = container.childNodes[0]
    act(() => {
      getReactProps(row).onClick()
    })

    expect(onSelectDiff).not.toHaveBeenCalled()
  })
})
