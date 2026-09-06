import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { Dialog, type DialogProps } from './Dialog.js'
import { ToastContainer, type ToastMessage } from './Toast.js'
import { FeedbackProvider, useFeedback } from './FeedbackContext.js'

let capturedDialogProps: DialogProps[] = []

vi.mock('./Dialog.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./Dialog.js')>()
  return {
    ...actual,
    Dialog: (props: DialogProps) => {
      capturedDialogProps.push(props)
      return actual.Dialog(props)
    },
  }
})

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

describe('Dialog Component', () => {
  it('renders nothing when open is false', () => {
    const html = renderToStaticMarkup(
      <Dialog
        open={false}
        title="Test Title"
        message="Test Message"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(html).toBe('')
  })

  it('renders accessible alertdialog with title, message, and default buttons', () => {
    const html = renderToStaticMarkup(
      <Dialog
        open={true}
        title="Confirm Deletion"
        message="Are you sure you want to delete this item?"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(html).toContain('role="alertdialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('aria-labelledby="dialog-title"')
    expect(html).toContain('aria-describedby="dialog-desc"')
    expect(html).toContain('Confirm Deletion')
    expect(html).toContain('Are you sure you want to delete this item?')
    expect(html).toContain('Confirm')
    expect(html).toContain('Cancel')
  })

  it('renders custom button labels and danger styling when danger is true', () => {
    const html = renderToStaticMarkup(
      <Dialog
        open={true}
        title="Clear Cache"
        message="This action cannot be undone."
        confirmText="Yes, Clear"
        cancelText="No, Keep"
        danger={true}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(html).toContain('Yes, Clear')
    expect(html).toContain('No, Keep')
    expect(html).toContain('var(--red)')
    expect(html).toContain('⚠')
  })

  it('renders primary button styling for default non-danger variant', () => {
    const html = renderToStaticMarkup(
      <Dialog
        open={true}
        title="Information"
        message="Normal confirmation dialog"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(html).toContain('var(--blue)')
    expect(html).not.toContain('⚠')
  })
})

describe('Toast Component', () => {
  it('renders nothing when toast list is empty', () => {
    const html = renderToStaticMarkup(
      <ToastContainer toasts={[]} onDismiss={vi.fn()} />,
    )
    expect(html).toBe('')
  })

  it('renders region and status items for multiple toast types', () => {
    const testToasts: ToastMessage[] = [
      { id: '1', type: 'success', text: 'Cache cleared successfully' },
      { id: '2', type: 'error', text: 'Network connection failed' },
      { id: '3', type: 'warning', text: 'Unsaved changes pending' },
      { id: '4', type: 'info', text: 'New commit detected' },
    ]

    const html = renderToStaticMarkup(
      <ToastContainer toasts={testToasts} onDismiss={vi.fn()} />,
    )

    expect(html).toContain('role="region"')
    expect(html).toContain('aria-label="Notifications"')

    // Status roles for each item
    const statusMatches = html.match(/role="status"/g)
    expect(statusMatches?.length).toBe(4)

    // Icons and messages
    expect(html).toContain('✓')
    expect(html).toContain('Cache cleared successfully')

    expect(html).toContain('✕')
    expect(html).toContain('Network connection failed')

    expect(html).toContain('⚠')
    expect(html).toContain('Unsaved changes pending')

    expect(html).toContain('ℹ')
    expect(html).toContain('New commit detected')

    // Dismiss buttons
    expect(html).toContain('aria-label="Dismiss notification"')
  })
})

describe('FeedbackContext & Provider', () => {
  it('throws descriptive error when useFeedback is called outside provider', () => {
    function InvalidConsumer() {
      useFeedback()
      return null
    }

    expect(() => {
      renderToStaticMarkup(<InvalidConsumer />)
    }).toThrow('useFeedback must be used within a FeedbackProvider')
  })

  it('provides feedback context and renders child subtree cleanly', () => {
    function ValidConsumer() {
      const { confirm, toast, toastSuccess, toastError } = useFeedback()
      expect(typeof confirm).toBe('function')
      expect(typeof toast).toBe('function')
      expect(typeof toastSuccess).toBe('function')
      expect(typeof toastError).toBe('function')
      return <div data-testid="child-content">Feedback System Active</div>
    }

    const html = renderToStaticMarkup(
      <FeedbackProvider>
        <ValidConsumer />
      </FeedbackProvider>,
    )

    expect(html).toContain('Feedback System Active')
  })

  it('exposes toast convenience methods and supports string messages', () => {
    let feedbackApi: ReturnType<typeof useFeedback> | null = null
    function Consumer() {
      feedbackApi = useFeedback()
      return <div>Test</div>
    }

    renderToStaticMarkup(
      <FeedbackProvider>
        <Consumer />
      </FeedbackProvider>,
    )

    expect(feedbackApi).not.toBeNull()
    expect(() => {
      feedbackApi!.toast('Simple info string')
      feedbackApi!.toastSuccess('Success message')
      feedbackApi!.toastError('Error message')
      feedbackApi!.toastWarning('Warning message')
      feedbackApi!.toastInfo('Info message')
    }).not.toThrow()
  })

  it('confirm returns a promise that can be created', () => {
    let feedbackApi: ReturnType<typeof useFeedback> | null = null
    function Consumer() {
      feedbackApi = useFeedback()
      return <div>Test</div>
    }

    renderToStaticMarkup(
      <FeedbackProvider>
        <Consumer />
      </FeedbackProvider>,
    )

    const promise = feedbackApi!.confirm({
      title: 'Confirm',
      message: 'Are you sure?',
    })
    expect(promise).toBeInstanceOf(Promise)
  })

  it('queues concurrent confirm calls, displays sequentially, and resolves both without hanging', async () => {
    setupMockDom()
    capturedDialogProps = []

    let api: ReturnType<typeof useFeedback> | null = null
    function Consumer() {
      api = useFeedback()
      return <div>Feedback Consumer</div>
    }

    const doc = (globalThis as any).document
    const container = doc.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <FeedbackProvider>
          <Consumer />
        </FeedbackProvider>,
      )
    })

    expect(api).not.toBeNull()

    // Concurrently trigger confirm twice in the same JavaScript tick
    let p1: Promise<boolean> | null = null
    let p2: Promise<boolean> | null = null
    await act(async () => {
      p1 = api!.confirm({
        title: 'Concurrent Dialog 1',
        message: 'Message for dialog 1',
      })
      p2 = api!.confirm({
        title: 'Concurrent Dialog 2',
        message: 'Message for dialog 2',
      })
    })

    // Dialog 1 should be currently displayed
    expect(capturedDialogProps.length).toBeGreaterThan(0)
    const active1 = capturedDialogProps[capturedDialogProps.length - 1]!
    expect(active1.title).toBe('Concurrent Dialog 1')
    expect(active1.open).toBe(true)

    // Confirm Dialog 1
    await act(async () => {
      active1.onConfirm()
    })

    const res1 = await p1
    expect(res1).toBe(true)

    // Dialog 2 should now be displayed
    const active2 = capturedDialogProps[capturedDialogProps.length - 1]!
    expect(active2.title).toBe('Concurrent Dialog 2')
    expect(active2.open).toBe(true)

    // Confirm Dialog 2
    await act(async () => {
      active2.onConfirm()
    })

    const res2 = await p2
    expect(res2).toBe(true)
  })

  it('queues concurrent confirm calls with cancellation, resolving in order without hanging', async () => {
    setupMockDom()
    capturedDialogProps = []

    let api: ReturnType<typeof useFeedback> | null = null
    function Consumer() {
      api = useFeedback()
      return <div>Feedback Consumer</div>
    }

    const doc = (globalThis as any).document
    const container = doc.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <FeedbackProvider>
          <Consumer />
        </FeedbackProvider>,
      )
    })

    let p1: Promise<boolean> | null = null
    let p2: Promise<boolean> | null = null
    await act(async () => {
      p1 = api!.confirm({
        title: 'Delete Item A',
        message: 'Are you sure you want to delete item A?',
      })
      p2 = api!.confirm({
        title: 'Delete Item B',
        message: 'Are you sure you want to delete item B?',
      })
    })

    // Dialog 1 is displayed
    const active1 = capturedDialogProps[capturedDialogProps.length - 1]!
    expect(active1.title).toBe('Delete Item A')

    // Cancel Dialog 1
    await act(async () => {
      active1.onCancel()
    })

    const res1 = await p1
    expect(res1).toBe(false)

    // Dialog 2 is now displayed
    const active2 = capturedDialogProps[capturedDialogProps.length - 1]!
    expect(active2.title).toBe('Delete Item B')

    // Cancel Dialog 2
    await act(async () => {
      active2.onCancel()
    })

    const res2 = await p2
    expect(res2).toBe(false)
  })

  it('maintains strict FIFO order across three rapid concurrent confirm calls', async () => {
    setupMockDom()
    capturedDialogProps = []

    let api: ReturnType<typeof useFeedback> | null = null
    function Consumer() {
      api = useFeedback()
      return <div>Feedback Consumer</div>
    }

    const doc = (globalThis as any).document
    const container = doc.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <FeedbackProvider>
          <Consumer />
        </FeedbackProvider>,
      )
    })

    const resolutions: { id: string; value: boolean }[] = []
    let p1: Promise<boolean> | null = null
    let p2: Promise<boolean> | null = null
    let p3: Promise<boolean> | null = null

    await act(async () => {
      p1 = api!.confirm({ title: 'D1', message: 'First' }).then((v) => {
        resolutions.push({ id: 'D1', value: v })
        return v
      })
      p2 = api!.confirm({ title: 'D2', message: 'Second' }).then((v) => {
        resolutions.push({ id: 'D2', value: v })
        return v
      })
      p3 = api!.confirm({ title: 'D3', message: 'Third' }).then((v) => {
        resolutions.push({ id: 'D3', value: v })
        return v
      })
    })

    // D1 is active
    expect(capturedDialogProps[capturedDialogProps.length - 1]!.title).toBe('D1')
    await act(async () => {
      capturedDialogProps[capturedDialogProps.length - 1]!.onConfirm()
    })
    await p1

    // D2 is active
    expect(capturedDialogProps[capturedDialogProps.length - 1]!.title).toBe('D2')
    await act(async () => {
      capturedDialogProps[capturedDialogProps.length - 1]!.onCancel()
    })
    await p2

    // D3 is active
    expect(capturedDialogProps[capturedDialogProps.length - 1]!.title).toBe('D3')
    await act(async () => {
      capturedDialogProps[capturedDialogProps.length - 1]!.onConfirm()
    })
    await p3

    expect(resolutions).toEqual([
      { id: 'D1', value: true },
      { id: 'D2', value: false },
      { id: 'D3', value: true },
    ])
  })
})
