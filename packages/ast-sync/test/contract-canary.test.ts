import { describe, expect, it } from 'vitest'
import {
  checkImplementationContract,
  validateDetachedEvidenceMarkdown,
} from '../src/index.js'

describe('Phase D/E Contract Canary & Scrap Trigger Detector (@oa-sdk/ast-sync · TODO-OA-04)', () => {
  it('passes clean implementation that satisfies contracted operations and models with 0 friction signals', () => {
    const report = checkImplementationContract({
      implementationSource: `
        export interface WriterLeaseContract {
          leaseId: string;
        }
        export function acquireWriterLease(request: WriterLeaseContract): string {
          return request.leaseId;
        }
      `,
      contractedOperations: ['acquireWriterLease'],
      contractedModels: ['WriterLeaseContract'],
    })

    expect(report.passed).toBe(true)
    expect(report.scrapRequired).toBe(false)
    expect(report.totalFrictionSignals).toBe(0)
    expect(report.recommendation).toBe('proceed')
  })

  it('triggers Phase E Scrap (scrapRequired = true) when >= 2 friction signals accumulate (IUD-06)', () => {
    const report = checkImplementationContract({
      implementationSource: `
        import threading
        # workaround for split lease state
        def acquire_writer_lease(request: Any) -> str:
          lock = threading.Lock()
          return "ok"
      `,
      contractedOperations: ['acquireWriterLease'],
      contractedModels: ['WriterLeaseContract'],
    })

    expect(report.passed).toBe(false)
    expect(report.scrapRequired).toBe(true)
    expect(report.escapeHatches).toHaveLength(1)
    expect(report.lockReflexes).toHaveLength(1)
    expect(report.workaroundMarkers).toHaveLength(1)
    expect(report.signatureDeviations).toHaveLength(1)
    expect(report.recommendation).toBe('scrap-and-redesign-tsp')
  })

  it('does not count an operation or model that is only mentioned in a comment, string or call site', () => {
    const contract = { contractedOperations: ['placeOrder'], contractedModels: ['Order'] }
    const cases: Array<{ name: string; source: string; language?: 'typescript' | 'python'; missing: string[] }> = [
      {
        name: 'operation named only in a // comment',
        source: 'export interface Order { id: string }\n// TODO: placeOrder(cartId) is not written yet\nexport class OrderService {}\n',
        missing: ['placeOrder'],
      },
      {
        name: 'operation only called on another object',
        source: 'export interface Order { id: string }\nexport function submit(): void { externalApi.placeOrder("x") }\n',
        missing: ['placeOrder'],
      },
      {
        name: 'operation named only inside a string',
        source: 'export interface Order { id: string }\nexport const message = "placeOrder() missing"\n',
        missing: ['placeOrder'],
      },
      {
        name: 'model named only in a comment',
        source: '// Order model goes here\nexport function placeOrder(cartId: string): string { return cartId }\n',
        missing: ['Order'],
      },
      {
        name: 'operation named only in a Python docstring',
        source: 'class Order:\n    pass\n\nclass OrderService:\n    """place_order(cart_id) is coming soon."""\n    pass\n',
        language: 'python',
        missing: ['placeOrder'],
      },
    ]

    for (const testCase of cases) {
      const report = checkImplementationContract({
        implementationSource: testCase.source,
        ...(testCase.language ? { language: testCase.language } : {}),
        ...contract,
      })
      expect(report.signatureDeviations.map(signal => signal.snippet), testCase.name).toEqual(testCase.missing)
      expect(report.passed, testCase.name).toBe(false)
    }
  })

  it('accepts every TypeScript and Python declaration form of an operation and a model', () => {
    const typescriptForms = [
      'export function placeOrder(cartId: string): Order { return { id: cartId } }',
      'export class Service { async placeOrder(cartId: string): Promise<Order> { return { id: cartId } } }',
      'export class Service { placeOrder = async (cartId: string): Promise<Order> => ({ id: cartId }) }',
      'export const placeOrder = (cartId: string): Order => ({ id: cartId })',
      'export const service = { placeOrder(cartId: string): Order { return { id: cartId } } }',
      'export interface Service { placeOrder(cartId: string): Order }',
    ]
    for (const form of typescriptForms) {
      const report = checkImplementationContract({
        implementationSource: `export type Order = { id: string }\n${form}\n`,
        language: 'typescript',
        contractedOperations: ['placeOrder'],
        contractedModels: ['Order'],
      })
      expect(report.signatureDeviations, form).toEqual([])
    }

    const report = checkImplementationContract({
      implementationSource: 'from dataclasses import dataclass\n\n@dataclass\nclass Order:\n    id: str\n\nasync def place_order(cart_id: str) -> Order:\n    return Order(id=cart_id)\n',
      contractedOperations: ['placeOrder'],
      contractedModels: ['Order'],
    })
    expect(report.signatureDeviations).toEqual([])
    expect(report.passed).toBe(true)
  })

  it('counts a model the implementation imports or re-exports, e.g. from the emitted sketch_stub', () => {
    const contract = { contractedOperations: ['placeOrder'], contractedModels: ['Order'] }
    const cases: Array<{ name: string; source: string; language?: 'typescript' | 'python' }> = [
      {
        name: 'TS import type from sketch_stub',
        source: "import type { Order } from './sketch_stub'\nexport class Impl {\n  placeOrder(cartId: string): Order { return { id: cartId } }\n}\n",
      },
      {
        name: 'TS implements an imported service interface',
        source: "import { Order, OrderService } from './sketch_stub'\nexport class Impl implements OrderService {\n  placeOrder(cartId: string): Order { return { id: cartId } }\n}\n",
      },
      {
        name: 'TS aliased named import',
        source: "import { type Order as StubOrder } from './sketch_stub'\nexport function placeOrder(cartId: string): StubOrder { return { id: cartId } }\n",
      },
      {
        name: 'TS default import',
        source: "import Order from './order'\nexport function placeOrder(cartId: string): Order { return new Order(cartId) }\n",
      },
      {
        name: 'TS namespace import used as Stub.Order',
        source: "import * as Stub from './sketch_stub'\nexport class Impl implements Stub.OrderService {\n  placeOrder(cartId: string): Stub.Order { return { id: cartId } }\n}\n",
      },
      {
        name: 'TS import-equals alias',
        source: "import Order = Models.Order\nexport function placeOrder(cartId: string): Order { return { id: cartId } }\n",
      },
      {
        name: 'TS import() type',
        source: "export function placeOrder(cartId: string): import('./sketch_stub').Order { return { id: cartId } }\n",
      },
      {
        name: 'TS re-export of the model and of the operation',
        source: "export type { Order } from './sketch_stub'\nexport { placeOrder } from './order-service'\n",
      },
      {
        name: 'Python from-import of the model',
        source: 'from .models import Order\n\ndef place_order(cart_id: str) -> Order:\n    return Order(id=cart_id)\n',
        language: 'python',
      },
      {
        name: 'Python parenthesised multi-line from-import',
        source: 'from .models import (\n    User,  # the buyer\n    Order as OrderModel,\n)\n\ndef place_order(cart_id: str) -> OrderModel:\n    return OrderModel(id=cart_id)\n',
        language: 'python',
      },
      {
        name: 'Python module import used as models.Order',
        source: 'import app.models as models\n\ndef place_order(cart_id: str) -> models.Order:\n    return models.Order(id=cart_id)\n',
        language: 'python',
      },
    ]

    for (const testCase of cases) {
      const report = checkImplementationContract({
        implementationSource: testCase.source,
        ...(testCase.language ? { language: testCase.language } : {}),
        ...contract,
      })
      expect(report.signatureDeviations, testCase.name).toEqual([])
      expect(report.passed, testCase.name).toBe(true)
      expect(report.recommendation, testCase.name).toBe('proceed')
    }
  })

  it('counts an operation bound by a wrapper call, a destructuring or a router key', () => {
    const forms = [
      "export const placeOrder = withAuth(async (cartId: string): Promise<Order> => ({ id: cartId }))",
      'export const { placeOrder } = createOrderService()',
      'export const router = createRouter({ placeOrder: procedure.mutation(handlePlaceOrder) })',
    ]
    for (const form of forms) {
      const report = checkImplementationContract({
        implementationSource: `export type Order = { id: string }\n${form}\n`,
        language: 'typescript',
        contractedOperations: ['placeOrder'],
        contractedModels: ['Order'],
      })
      expect(report.signatureDeviations, form).toEqual([])
    }

    const python = checkImplementationContract({
      implementationSource: 'class Order:\n    pass\n\nplace_order = with_auth(_place_order_impl)\n',
      language: 'python',
      contractedOperations: ['placeOrder'],
      contractedModels: ['Order'],
    })
    expect(python.signatureDeviations).toEqual([])
  })

  it('does not count an imported operation, a commented-out import or an attribute of a non-import', () => {
    const cases: Array<{ name: string; source: string; language?: 'typescript' | 'python'; missing: string[] }> = [
      {
        name: 'TS operation that is only imported, not implemented',
        source: "import { placeOrder } from './legacy'\nexport type Order = { id: string }\nexport const submit = (): void => { placeOrder() }\n",
        missing: ['placeOrder'],
      },
      {
        name: 'TS import inside a comment',
        source: "// import type { Order } from './sketch_stub'\nexport function placeOrder(cartId: string): string { return cartId }\n",
        missing: ['Order'],
      },
      {
        name: 'TS property read on a value that is not a namespace import',
        source: 'const api = createApi()\nexport function placeOrder(cartId: string): typeof api.Order { return api.Order(cartId) }\n',
        missing: ['Order'],
      },
      {
        name: 'Python import inside a comment and a docstring',
        source: '# from .models import Order\n"""from .models import Order"""\n\ndef place_order(cart_id: str):\n    return cart_id\n',
        language: 'python',
        missing: ['Order'],
      },
      {
        name: 'Python attribute of an object that was not imported',
        source: 'api = make_api()\n\ndef place_order(cart_id: str):\n    return api.Order(cart_id)\n',
        language: 'python',
        missing: ['Order'],
      },
    ]

    for (const testCase of cases) {
      const report = checkImplementationContract({
        implementationSource: testCase.source,
        ...(testCase.language ? { language: testCase.language } : {}),
        contractedOperations: ['placeOrder'],
        contractedModels: ['Order'],
      })
      expect(report.signatureDeviations.map(signal => signal.snippet), testCase.name).toEqual(testCase.missing)
    }
  })

  it('binds a Python name only at the start of a logical statement, whatever the line breaks', () => {
    const contract = { contractedOperations: ['placeOrder'], contractedModels: ['Order'], language: 'python' as const }
    const missing: Array<{ name: string; source: string }> = [
      {
        name: 'keyword argument on its own line of a multi-line call',
        source: 'from dataclasses import dataclass\n\n@dataclass\nclass Order:\n    id: str\n\ndef checkout(cart_id: str) -> Order:\n    return gateway.submit(\n        place_order=cart_id,\n    )\n',
      },
      {
        name: 'annotated parameter on its own line of a multi-line def',
        source: 'from dataclasses import dataclass\n\n@dataclass\nclass Order:\n    id: str\n\nclass Checkout:\n    def __init__(\n        self,\n        place_order: object,\n    ) -> None:\n        self._p = place_order\n',
      },
      {
        name: 'lambda parameter after a backslash line join',
        source: 'class Order:\n    pass\n\ncallback = lambda \\\n    place_order: place_order\n',
      },
      {
        name: 'keyword argument of a one-line call (control)',
        source: 'class Order:\n    pass\n\ndef checkout(cart_id):\n    return gateway.submit(place_order=cart_id)\n',
      },
      {
        name: 'attribute and subscript targets',
        source: 'class Order:\n    pass\n\nclass Checkout:\n    def __init__(self) -> None:\n        self.place_order = None\n        handlers["place_order"] = None\n',
      },
    ]
    for (const testCase of missing) {
      const report = checkImplementationContract({ implementationSource: testCase.source, ...contract })
      expect(report.signatureDeviations.map(signal => signal.snippet), testCase.name).toEqual(['placeOrder'])
      expect(report.passed, testCase.name).toBe(false)
    }

    const bound: Array<{ name: string; source: string }> = [
      { name: 'module-level wrapper assignment', source: 'class Order:\n    pass\n\nplace_order = with_auth(\n    _place_order_impl,\n)\n' },
      { name: 'Protocol / dataclass field', source: 'from typing import Callable, Protocol\n\nclass Order:\n    pass\n\nclass OrderService(Protocol):\n    place_order: Callable[[str], Order]\n' },
      { name: 'second statement after a semicolon', source: 'class Order:\n    pass\n\nready = True; place_order = make_handler(\n    ready,\n)\n' },
      { name: 'tuple and chained targets', source: 'class Order:\n    pass\n\n(cancel_order, [place_order, *rest]) = handlers = make_handlers()\n' },
      { name: 'parenthesised multi-line from-import of the model', source: 'from .models import (\n    Order,\n)\n\ndef place_order(\n    cart_id: str,\n) -> Order:\n    return Order(id=cart_id)\n' },
    ]
    for (const testCase of bound) {
      const report = checkImplementationContract({ implementationSource: testCase.source, ...contract })
      expect(report.signatureDeviations, testCase.name).toEqual([])
    }
  })

  it('binds a Python simple statement written after a compound header on the same line', () => {
    const contract = { contractedOperations: ['placeOrder'], contractedModels: ['Order'], language: 'python' as const }
    const model = 'class Order:\n    pass\n\n'
    const bound: Array<{ name: string; source: string }> = [
      { name: 'if', source: `${model}if ENABLED: place_order = make_handler()\n` },
      { name: 'if with a walrus, a slice and a lambda in the condition', source: `${model}if (n := len(xs[1:])) and pick(lambda v: v): place_order = make_handler(n)\n` },
      { name: 'elif', source: `${model}if A:\n    pass\nelif B: place_order = make_handler()\n` },
      { name: 'else', source: `${model}if A:\n    pass\nelse: place_order = fallback\n` },
      { name: 'while', source: `${model}while not ready(): place_order = retry()\n` },
      { name: 'while with an unparenthesised walrus', source: `${model}while chunk := read(): place_order = chunk\n` },
      { name: 'if with a lambda outside brackets', source: `${model}if lambda: ENABLED: place_order = make_handler()\n` },
      { name: 'for', source: `${model}for handler in handlers: place_order = handler\n` },
      { name: 'async for', source: `${model}async def main():\n    async for handler in stream(): place_order = handler\n` },
      { name: 'with', source: `${model}with open(path, "r") as source: place_order = load(source)\n` },
      { name: 'try', source: `${model}try: place_order = import_handler()\nexcept ImportError:\n    pass\n` },
      { name: 'except', source: `${model}try:\n    pass\nexcept (ImportError, KeyError) as error: place_order = None\n` },
      { name: 'bare except', source: `${model}try:\n    pass\nexcept: place_order = None\n` },
      { name: 'finally', source: `${model}try:\n    pass\nfinally: place_order = make_handler()\n` },
      { name: 'case', source: `${model}match mode:\n    case "live": place_order = live_handler\n` },
      { name: 'class body', source: 'class Order: place_order: Handler\n' },
      { name: 'def body', source: `${model}def install() -> dict[str, int]: place_order = make_handler(); return {}\n` },
      { name: 'annotation after a header', source: `${model}if TYPE_CHECKING: place_order: Handler\n` },
      { name: 'model import after a header', source: 'if TYPE_CHECKING: from .models import Order\n\ndef place_order(cart_id): ...\n' },
      { name: 'model alias after a header', source: 'try: Order = dict\nexcept NameError:\n    pass\n\ndef place_order(cart_id): ...\n' },
    ]
    for (const testCase of bound) {
      const report = checkImplementationContract({ implementationSource: testCase.source, ...contract })
      expect(report.signatureDeviations.map(signal => signal.snippet), testCase.name).toEqual([])
    }

    const missing: Array<{ name: string; source: string }> = [
      { name: 'name only in an if condition', source: `${model}if place_order is None: handler = fallback\n` },
      { name: 'name only in a while condition', source: `${model}while place_order(): pass\n` },
      { name: 'name only in a with header', source: `${model}with place_order() as handler: handler.run()\n` },
      { name: 'name only in a lambda inside the header', source: `${model}if pick(lambda place_order: place_order): run()\n` },
      { name: 'keyword argument after a header', source: `${model}else: gateway.submit(place_order=cart_id)\n` },
    ]
    for (const testCase of missing) {
      const report = checkImplementationContract({ implementationSource: testCase.source, ...contract })
      expect(report.signatureDeviations.map(signal => signal.snippet), testCase.name).toEqual(['placeOrder'])
    }

    // A soft keyword used as a variable name is no header: `case: int = 1` binds `case`.
    const softKeyword = checkImplementationContract({
      implementationSource: `${model}case: Handler = make_handler()\ndef place_order(): ...\n`,
      contractedOperations: ['placeOrder', 'case'],
      contractedModels: ['Order'],
      language: 'python',
    })
    expect(softKeyword.signatureDeviations).toEqual([])
  })

  it('binds no TypeScript operation in a parameter, its type or its default value', () => {
    const contract = { contractedOperations: ['placeOrder'], contractedModels: ['Order'], language: 'typescript' as const }
    for (const source of [
      'export interface Order { id: string }\nexport function checkout(deps: { placeOrder: (id: string) => Order }) { return deps.placeOrder("x") }\n',
      'export interface Order { id: string }\nexport function checkout(opts = { placeOrder: noop }) { return opts }\n',
      'export interface Order { id: string }\nexport class Checkout { constructor(placeOrder: () => Order) { this.run = placeOrder } }\n',
    ]) {
      const report = checkImplementationContract({ implementationSource: source, ...contract })
      expect(report.signatureDeviations.map(signal => signal.snippet), source).toEqual(['placeOrder'])
    }

    // A constructor parameter property is a class field, and a model named in a parameter type counts.
    const report = checkImplementationContract({
      implementationSource: "import * as Stub from './sketch_stub'\nexport class Checkout {\n  constructor(readonly placeOrder: (order: Stub.Order) => void) {}\n}\n",
      ...contract,
    })
    expect(report.signatureDeviations).toEqual([])
  })

  it('reads TypeScript `#private` members as code, so their escape hatches count', () => {
    const source = [
      'export interface Order { id: string }',
      'export class OrderService {',
      '  #cache: any = new Map()',
      '  placeOrder(cartId: string): Order { return { id: cartId } }',
      '}',
    ].join('\n')

    for (const language of ['typescript', 'auto'] as const) {
      const report = checkImplementationContract({
        implementationSource: source,
        language,
        contractedOperations: ['placeOrder'],
        contractedModels: ['Order'],
      })
      expect(report.escapeHatches.map(signal => [signal.line, signal.message]), language).toEqual([
        [3, 'TypeScript `: any` type escape hatch'],
      ])
      expect(report.passed, language).toBe(false)
    }
  })

  it('skips Python comment lines and string contents but still sees `# type: ignore`', () => {
    const report = checkImplementationContract({
      implementationSource: [
        'class Order:',
        '    pass',
        '# : any and cast(x) here are only prose',
        'def place_order(cart_id: str) -> Order:',
        '    note = "as any: Any"',
        '    return Order()  # type: ignore',
      ].join('\n'),
      language: 'python',
      contractedOperations: ['placeOrder'],
      contractedModels: ['Order'],
    })

    expect(report.escapeHatches.map(signal => [signal.line, signal.message])).toEqual([
      [6, 'Python `# type: ignore` suppression'],
    ])
  })

  it('flags a TypeScript suppression directive written as a comment', () => {
    const report = checkImplementationContract({
      implementationSource: 'export type Order = { id: string }\n// @ts-ignore\nexport function placeOrder(cartId: string): Order { return cartId }\n',
      contractedOperations: ['placeOrder'],
      contractedModels: ['Order'],
    })

    expect(report.escapeHatches.map(signal => [signal.line, signal.message])).toEqual([
      [2, 'TypeScript compiler suppression directive'],
    ])
  })

  it('does not count a lock mentioned only in a comment as a lock reflex', () => {
    const python = checkImplementationContract({
      implementationSource: 'class Order:\n    pass\n\n# never use threading.Lock() here; rely on the DB lease\ndef place_order(cart_id: str) -> Order:\n    return Order()\n',
      contractedOperations: ['placeOrder'],
      contractedModels: ['Order'],
    })
    expect(python.lockReflexes).toEqual([])
    expect(python.passed).toBe(true)

    const typescript = checkImplementationContract({
      implementationSource: 'export type Order = { id: string }\n// avoid new Mutex() here\nexport function placeOrder(cartId: string): Order { return { id: cartId } }\n',
      contractedOperations: ['placeOrder'],
      contractedModels: ['Order'],
    })
    expect(typescript.lockReflexes).toEqual([])
    expect(typescript.passed).toBe(true)
  })

  it('validates detached evidence markdown anchors with code-fence masking and 3-way anchor classification', () => {
    const md = [
      '# Lease Evidence Review {#lease-review-root}',
      '',
      '```markdown',
      '## Fake Heading Inside Code Block {#fake-anchor}',
      '```',
      '',
      '## 1. Atomic Lease Acquisition {#acquire-atomic}',
      '<a id="legacy-compat-anchor"></a>',
    ].join('\n')

    const report = validateDetachedEvidenceMarkdown(md, [
      '#lease-review-root',
      '#acquire-atomic',
      '#1-atomic-lease-acquisition',
    ])

    expect(report.valid).toBe(true)
    expect(report.missingAnchors).toEqual([])
    expect(report.discoveredAnchors).not.toContain('fake-anchor')
    expect(report.inlineHtmlAnchorWarnings).toHaveLength(1)
  })
})
