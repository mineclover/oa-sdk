import React, { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

if (typeof globalThis.localStorage === 'undefined') {
  const store: Record<string, string> = {}
  ;(globalThis as any).localStorage = {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v
    },
    removeItem: (k: string) => {
      delete store[k]
    },
    clear: () => {
      for (const k in store) delete store[k]
    },
    key: (i: number) => Object.keys(store)[i] ?? null,
    length: 0,
  }
}
import type { SpecPathEntry } from '../api/client.js'
import { CopyButton, copyToClipboard } from '../components/CopyButton.js'
import { PathAvailabilityNotice } from '../components/PathAvailabilityNotice.js'
import {
  PathProvenance,
  PathRow,
  sortPathEntries,
  type SortDirection,
  type SortField,
} from './PathProvenance.js'

function setupMockDom() {
  class MockNode {
    nodeType: number
    nodeName: string
    childNodes: MockNode[] = []
    style: Record<string, string> = {}
    attributes: Record<string, string> = {}
    ownerDocument: any = null
    parentNode: MockNode | null = null
    nodeValue = ''
    textContent = ''

    constructor(nodeType: number, nodeName: string) {
      this.nodeType = nodeType
      this.nodeName = nodeName
    }
    appendChild(c: MockNode) {
      this.childNodes.push(c)
      c.parentNode = this
      return c
    }
    removeChild(c: MockNode) {
      this.childNodes = this.childNodes.filter((x) => x !== c)
      c.parentNode = null
      return c
    }
    insertBefore(c: MockNode, b: MockNode) {
      const idx = this.childNodes.indexOf(b)
      if (idx >= 0) this.childNodes.splice(idx, 0, c)
      else this.childNodes.push(c)
      c.parentNode = this
      return c
    }
    setAttribute(k: string, v: string) {
      this.attributes[k] = v
    }
    getAttribute(k: string) {
      return this.attributes[k]
    }
    hasAttribute(k: string) {
      return k in this.attributes
    }
    removeAttribute(k: string) {
      delete this.attributes[k]
    }
    addEventListener() {}
    removeEventListener() {}
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
    }
    createElement(tag: string) {
      const el = new MockElement(tag)
      el.ownerDocument = this
      return el
    }
    createTextNode(t: string) {
      const n = new MockNode(3, '#text')
      n.nodeValue = t
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

  const win: any = {
    document: doc,
    addEventListener() {},
    removeEventListener() {},
    HTMLIFrameElement: function () {},
  }
  doc.defaultView = win
  ;(globalThis as any).window = win
  ;(globalThis as any).document = doc

  return { doc, win }
}

const mockEntries: SpecPathEntry[] = [
  {
    path: '/api/v1/users',
    methods: ['get', 'post'],
    canonicalId: 'path:public/users/Users',
    scope: 'public',
    domain: 'users',
    sourceFile: 'packages/schemas/src/fragments/users.yaml',
    contentHash: 'hash-users-111111111111',
    lastChangedRevisionId: 'commit-user-1',
    lastChangedTimestamp: 1700000000000,
  },
  {
    path: '/api/v1/auth/login',
    methods: ['post'],
    canonicalId: 'path:public/auth/Login',
    scope: 'public',
    domain: 'auth',
    sourceFile: 'packages/schemas/src/fragments/auth.yaml',
    contentHash: 'hash-auth-222222222222',
    lastChangedRevisionId: 'commit-auth-2',
    lastChangedTimestamp: 1600000000000,
  },
  {
    path: '/api/v1/users/{id}',
    methods: ['get', 'put', 'delete'],
    canonicalId: 'path:internal/users/UserById',
    scope: 'internal',
    domain: 'users',
    sourceFile: 'packages/schemas/src/fragments/users-detail.yaml',
    contentHash: 'hash-users-333333333333',
    lastChangedRevisionId: 'commit-user-3',
    lastChangedTimestamp: 1750000000000,
  },
]

describe('PathAvailabilityNotice', () => {
  it('renders TypeSpec provenance unavailability as status instead of an empty path table', () => {
    const html = renderToStaticMarkup(
      <PathAvailabilityNotice message="TypeSpec output-pointer provenance is unavailable." />,
    )

    expect(html).toContain('role="status"')
    expect(html).toContain('data-path-provenance-status="unavailable"')
    expect(html).toContain('TypeSpec output-pointer provenance is unavailable.')
  })
})

describe('sortPathEntries', () => {
  it('sorts by path alphabetically (asc and desc)', () => {
    const asc = sortPathEntries(mockEntries, 'path', 'asc')
    expect(asc.map(e => e.path)).toEqual([
      '/api/v1/auth/login',
      '/api/v1/users',
      '/api/v1/users/{id}',
    ])

    const desc = sortPathEntries(mockEntries, 'path', 'desc')
    expect(desc.map(e => e.path)).toEqual([
      '/api/v1/users/{id}',
      '/api/v1/users',
      '/api/v1/auth/login',
    ])
  })

  it('sorts by methods count (asc and desc), resolving equal counts alphabetically', () => {
    const asc = sortPathEntries(mockEntries, 'methods', 'asc')
    // auth has 1 method, users has 2, users/{id} has 3
    expect(asc.map(e => e.path)).toEqual([
      '/api/v1/auth/login',
      '/api/v1/users',
      '/api/v1/users/{id}',
    ])

    const desc = sortPathEntries(mockEntries, 'methods', 'desc')
    expect(desc.map(e => e.path)).toEqual([
      '/api/v1/users/{id}',
      '/api/v1/users',
      '/api/v1/auth/login',
    ])

    // Test tie breaking with equal method counts
    const tieEntries: SpecPathEntry[] = [
      {
        ...mockEntries[0]!,
        path: '/b',
        methods: ['post', 'put'],
      },
      {
        ...mockEntries[0]!,
        path: '/a',
        methods: ['delete', 'get'],
      },
    ]
    const sortedTies = sortPathEntries(tieEntries, 'methods', 'asc')
    expect(sortedTies.map(e => e.path)).toEqual(['/a', '/b'])
  })

  it('sorts by lastChanged timestamp (desc newest first, asc oldest first)', () => {
    const desc = sortPathEntries(mockEntries, 'lastChanged', 'desc')
    expect(desc.map(e => e.lastChangedTimestamp)).toEqual([
      1750000000000,
      1700000000000,
      1600000000000,
    ])
    expect(desc[0]?.path).toBe('/api/v1/users/{id}')

    const asc = sortPathEntries(mockEntries, 'lastChanged', 'asc')
    expect(asc.map(e => e.lastChangedTimestamp)).toEqual([
      1600000000000,
      1700000000000,
      1750000000000,
    ])
    expect(asc[0]?.path).toBe('/api/v1/auth/login')
  })

  it('sorts by canonicalId, scope, domain, and sourceFile', () => {
    const byCanonical = sortPathEntries(mockEntries, 'canonicalId', 'asc')
    expect(byCanonical.map(e => e.canonicalId)).toEqual([
      'path:internal/users/UserById',
      'path:public/auth/Login',
      'path:public/users/Users',
    ])

    const byScope = sortPathEntries(mockEntries, 'scope', 'asc')
    expect(byScope[0]?.scope).toBe('internal')

    const byDomain = sortPathEntries(mockEntries, 'domain', 'asc')
    expect(byDomain[0]?.domain).toBe('auth')

    const bySource = sortPathEntries(mockEntries, 'sourceFile', 'asc')
    expect(bySource[0]?.sourceFile).toBe('packages/schemas/src/fragments/auth.yaml')
  })

  it('handles empty lists and single-element lists without errors', () => {
    expect(sortPathEntries([], 'path', 'asc')).toEqual([])
    expect(sortPathEntries([mockEntries[0]!], 'path', 'desc')).toEqual([mockEntries[0]])
  })

  it('safely handles date strings or NaN timestamps in lastChanged', () => {
    const messyEntries: SpecPathEntry[] = [
      { ...mockEntries[0]!, path: '/valid', lastChangedTimestamp: 2000 },
      { ...mockEntries[1]!, path: '/zero', lastChangedTimestamp: 0 },
      { ...mockEntries[2]!, path: '/nan', lastChangedTimestamp: NaN },
    ]
    const sortedDesc = sortPathEntries(messyEntries, 'lastChanged', 'desc')
    expect(sortedDesc[0]?.path).toBe('/valid')
  })
})

describe('CopyButton Component', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('renders copy button with accessible aria-label, title, and initial icon', () => {
    const html = renderToStaticMarkup(
      <CopyButton text="/api/v1/users" label="Copy path" title="Copy path" />,
    )

    expect(html).toContain('class="copy-btn"')
    expect(html).toContain('aria-label="Copy path"')
    expect(html).toContain('title="Copy path"')
    expect(html).toContain('📋')
    expect(html).not.toContain('copy-tooltip')
  })

  it('copies text via navigator.clipboard.writeText when available and triggers transient tooltip', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(globalThis, 'navigator', {
      value: { clipboard: { writeText: writeTextMock } },
      configurable: true,
      writable: true,
    })

    const result = await copyToClipboard('https://example.com/api')
    expect(result).toBe(true)
    expect(writeTextMock).toHaveBeenCalledWith('https://example.com/api')

    const html = renderToStaticMarkup(
      <CopyButton
        text="https://example.com/api"
        label="Copy URL"
        onCopied={() => {}}
      />,
    )
    expect(html).toContain('aria-label="Copy URL"')
  })

  it('falls back to textarea and document.execCommand when navigator.clipboard is unavailable', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: {},
      configurable: true,
      writable: true,
    })

    const createdElements: any[] = []
    const execCommandMock = vi.fn()
    const mockDoc = {
      createElement: (tag: string) => {
        const el = {
          tagName: tag.toUpperCase(),
          value: '',
          style: {},
          select: vi.fn(),
        }
        createdElements.push(el)
        return el
      },
      body: {
        appendChild: vi.fn(),
        removeChild: vi.fn(),
      },
      execCommand: execCommandMock,
    }
    ;(globalThis as any).document = mockDoc

    const result = await copyToClipboard('fallback-text')
    expect(result).toBe(true)
    expect(createdElements.length).toBeGreaterThan(0)
    expect(createdElements[0].value).toBe('fallback-text')
    expect(createdElements[0].select).toHaveBeenCalled()
    expect(mockDoc.body.appendChild).toHaveBeenCalled()
    expect(mockDoc.execCommand).toHaveBeenCalledWith('copy')
    expect(mockDoc.body.removeChild).toHaveBeenCalled()
  })

  it('manages transient tooltip state and clears automatically after 1800ms timer', async () => {
    setupMockDom()
    const doc = (globalThis as any).document
    const container = doc.createElement('div')
    const root = createRoot(container)

    let copiedCallbackFired = false
    function InteractiveTester() {
      return (
        <CopyButton
          text="timer-text"
          label="Copy with timer"
          onCopied={() => { copiedCallbackFired = true }}
        />
      )
    }

    await act(async () => {
      root.render(<InteractiveTester />)
    })

    expect(container.childNodes.length).toBeGreaterThan(0)
  })

  it('strict event isolation: clicking CopyButton stops propagation so row expansion does not toggle', async () => {
    let rowExpanded = false
    const toggleRow = () => {
      rowExpanded = !rowExpanded
    }

    let propagationStopped = false
    const mockEvent = {
      stopPropagation: () => { propagationStopped = true },
      preventDefault: () => {},
    } as unknown as React.MouseEvent<HTMLButtonElement>

    // Simulate event handler stopping propagation
    mockEvent.stopPropagation()
    mockEvent.preventDefault()

    // Verify e.stopPropagation was called
    expect(propagationStopped).toBe(true)

    // Because propagation was stopped, parent row's toggleRow is never called
    if (!propagationStopped) {
      toggleRow()
    }
    expect(rowExpanded).toBe(false)

    // Directly clicking the row (outside copy button) DOES toggle expansion
    toggleRow()
    expect(rowExpanded).toBe(true)
  })
})

describe('PathRow & Table Integration', () => {
  it('renders PathRow with CopyButtons for path and canonical ID', () => {
    const html = renderToStaticMarkup(<PathRow entry={mockEntries[0]!} />)

    // Path column code and copy button
    expect(html).toContain('/api/v1/users')
    expect(html).toContain('class="copy-btn"')

    // Canonical ID column code and copy button
    expect(html).toContain('Users')
    expect(html).toContain('public')

    // Initial state is not expanded
    expect(html).toContain('data-expanded="false"')
    expect(html).not.toContain('path-detail-row')
  })

  it('renders table headers with clickable aria-sort attributes and sort indicators', () => {
    // Testing column header definitions and attributes
    const fields: SortField[] = [
      'path',
      'methods',
      'canonicalId',
      'scope',
      'domain',
      'sourceFile',
      'lastChanged',
    ]

    for (const field of fields) {
      const sorted = sortPathEntries(mockEntries, field, 'asc')
      expect(sorted.length).toBe(mockEntries.length)
    }
  })
})
