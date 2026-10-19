import type {
  DecoratorContext,
  Diagnostic,
  DiagnosticTarget,
  Interface,
  Model,
  ModelProperty,
  Namespace,
  Operation,
  Program,
  Type,
} from '@typespec/compiler'
import { SyntaxKind } from '@typespec/compiler/ast'
import { getExtensions } from '@typespec/openapi'
import { describe, expect, it } from 'vitest'
import { $onValidate, $traceId, TRACE_EXTENSION } from './governance.js'

type MockProgram = Program & { diagnostics: Diagnostic[] }

/** A namespace holding `operations` and `interfaces`, as `program.getGlobalNamespaceType()` returns. */
function namespace(operations: Operation[] = [], interfaces: Interface[] = []): Namespace {
  return {
    kind: 'Namespace',
    name: '',
    operations: new Map(operations.map(operation => [operation.name, operation])),
    interfaces: new Map(interfaces.map(declared => [declared.name, declared])),
    namespaces: new Map(),
  } as unknown as Namespace
}

/**
 * A program whose checker maps declaration syntax nodes to the type declared there,
 * as `program.checker.getTypeForNode` does.
 */
function createProgram(declarations: ReadonlyMap<object, Type> = new Map(), globalNamespace = namespace()): MockProgram {
  const stateMaps = new Map<symbol, Map<unknown, unknown>>()
  const diagnostics: Diagnostic[] = []
  const program = {
    diagnostics,
    checker: {
      getTypeForNode(node: object): Type | undefined {
        return declarations.get(node)
      },
    },
    getGlobalNamespaceType: () => globalNamespace,
    stateMap(key: symbol) {
      let map = stateMaps.get(key)
      if (!map) {
        map = new Map()
        stateMaps.set(key, map)
      }
      return map
    },
    reportDiagnostic(diagnostic: Diagnostic) {
      diagnostics.push(diagnostic)
    },
  }
  return program as unknown as MockProgram
}

/** A decorator context for one `@traceId` application, identified by its syntax node. */
function applicationContext(program: Program, applicationNode: object | undefined): DecoratorContext {
  return {
    program,
    decoratorTarget: applicationNode as DiagnosticTarget,
    getArgumentTarget: () => undefined,
  } as unknown as DecoratorContext
}

function model(name: string): Model {
  return { kind: 'Model', name } as unknown as Model
}

function trace(program: Program, target: Type): unknown {
  return getExtensions(program, target).get(TRACE_EXTENSION)
}

describe('$traceId ownership', () => {
  it('accepts one application that TypeSpec replays onto derived types and emits it only on the declaration', () => {
    const baseStatement = { kind: SyntaxKind.ModelStatement }
    const base = model('Base')
    const derived = model('Derived')
    const instance = model('Page<User>')
    const program = createProgram(new Map([[baseStatement, base]]))
    // `@traceId(...)` written above `model Base`; `model Derived is Base` and a template
    // instance re-run that same application.
    const application = { kind: SyntaxKind.DecoratorExpression, parent: baseStatement }

    $traceId(applicationContext(program, application), base, 'TRC-BASE-001')
    $traceId(applicationContext(program, application), derived, 'TRC-BASE-001')
    $traceId(applicationContext(program, application), instance, 'TRC-BASE-001')

    expect(program.diagnostics).toEqual([])
    expect(trace(program, base)).toEqual({ trackingId: 'TRC-BASE-001' })
    expect(trace(program, derived)).toBeUndefined()
    expect(trace(program, instance)).toBeUndefined()
  })

  it('emits an augment decorator `@@traceId(Base, ...)` only on the type it names', () => {
    const baseReference = { kind: SyntaxKind.TypeReference }
    const base = model('Base')
    const derived = model('Derived')
    const program = createProgram(new Map([[baseReference, base]]))
    const augment = { kind: SyntaxKind.AugmentDecoratorStatement, targetType: baseReference }

    $traceId(applicationContext(program, augment), base, 'TRC-BASE-002')
    $traceId(applicationContext(program, augment), derived, 'TRC-BASE-002')

    expect(program.diagnostics).toEqual([])
    expect(trace(program, base)).toEqual({ trackingId: 'TRC-BASE-002' })
    expect(trace(program, derived)).toBeUndefined()
  })

  it('emits an augment on the member copy it names although the reference resolves to the copy source meanwhile', () => {
    // `model CreateWidget { ...Widget }` + `@@traceId(CreateWidget.name, ...)`. While the augment runs
    // on the copy, the copy is not linked to its symbol yet, so the checker resolves the reference
    // to the source `Widget.name`.
    const nameNode = { kind: SyntaxKind.ModelProperty }
    const widgetName = { kind: 'ModelProperty', name: 'name', node: nameNode } as unknown as ModelProperty
    const createWidget = { kind: 'Model', name: 'CreateWidget', node: { kind: SyntaxKind.ModelStatement } } as unknown as Model
    const createWidgetCopy = { kind: 'Model', name: 'CreateWidgetCopy', node: { kind: SyntaxKind.ModelStatement } } as unknown as Model
    const named = { kind: 'ModelProperty', name: 'name', node: nameNode, sourceProperty: widgetName, model: createWidget } as unknown as ModelProperty
    // `model CreateWidgetCopy { ...CreateWidget }` replays the augment; a mutator clone keeps everything.
    const derived = { ...named, sourceProperty: named, model: createWidgetCopy } as ModelProperty
    const clone = { ...named } as ModelProperty
    const reference = { kind: SyntaxKind.MemberExpression }
    const program = createProgram(new Map<object, Type>([[reference, widgetName]]))
    const augment = { kind: SyntaxKind.AugmentDecoratorStatement, targetType: reference }

    $traceId(applicationContext(program, augment), named, 'TRC-CREATE-NAME-001')
    $traceId(applicationContext(program, augment), derived, 'TRC-CREATE-NAME-001')
    $traceId(applicationContext(program, augment), clone, 'TRC-CREATE-NAME-001')

    expect(program.diagnostics).toEqual([])
    expect(trace(program, named)).toEqual({ trackingId: 'TRC-CREATE-NAME-001' })
    expect(trace(program, derived)).toBeUndefined()
    expect(trace(program, clone)).toEqual({ trackingId: 'TRC-CREATE-NAME-001' })
    expect(trace(program, widgetName)).toBeUndefined()
  })

  it('emits an augment of a template declaration on none of its instances, without resolving the reference', () => {
    const pageStatement = { kind: SyntaxKind.ModelStatement, templateParameters: [{ kind: SyntaxKind.TemplateParameterDeclaration }] }
    const userPage = { kind: 'Model', name: 'Page', node: pageStatement } as unknown as Model
    const orderPage = { kind: 'Model', name: 'Page', node: pageStatement } as unknown as Model
    const program = createProgram()
    // `@@traceId(Page, ...)` names `Page<T>`; resolving it without template arguments would report
    // invalid-template-args, so the checker must not be asked.
    program.checker.getTypeForNode = () => {
      throw new Error('an augment target reference must not be resolved')
    }
    const augment = { kind: SyntaxKind.AugmentDecoratorStatement, targetType: { kind: SyntaxKind.TypeReference } }

    $traceId(applicationContext(program, augment), userPage, 'TRC-PAGE-005')
    $traceId(applicationContext(program, augment), orderPage, 'TRC-PAGE-005')

    expect(program.diagnostics).toEqual([])
    expect(trace(program, userPage)).toBeUndefined()
    expect(trace(program, orderPage)).toBeUndefined()
  })

  it('decides an augment on an `op ... is` parameter copy by the operation owning it, once checking is done', () => {
    // `@get op getT<T>(@path id: string): T;`. The parameters of `op X is getT<...>` are a clone
    // of a getT instance's parameters, syntax node included, so their node lies in the template.
    const getTStatement = { kind: SyntaxKind.OperationStatement, templateParameters: [{ kind: SyntaxKind.TemplateParameterDeclaration }] }
    const signature: { kind: SyntaxKind; parent: object; parameters?: object } = { kind: SyntaxKind.OperationSignatureDeclaration, parent: getTStatement }
    const parametersNode = { kind: SyntaxKind.ModelExpression, parent: signature }
    signature.parameters = parametersNode
    const idNode = { kind: SyntaxKind.ModelProperty, parent: parametersNode }
    const parameters = (): Model => ({ kind: 'Model', name: '', node: parametersNode }) as unknown as Model
    const parameter = (model: Model, sourceProperty?: ModelProperty): ModelProperty =>
      ({ kind: 'ModelProperty', name: 'id', node: idNode, model, sourceProperty }) as unknown as ModelProperty
    const operation = (name: string, operationParameters: Model, templateParameters: object[] = []): Operation =>
      ({ kind: 'Operation', name, node: { kind: SyntaxKind.OperationStatement, templateParameters }, parameters: operationParameters }) as unknown as Operation

    // `op getWidgetCopy is getT<Widget>;` and `op getWidgetCopyV2 is getWidgetCopy;`
    const instanceId = parameter(parameters())
    const named = parameter(parameters(), instanceId)
    const derived = parameter(parameters(), named)
    const getWidgetCopy = operation('getWidgetCopy', named.model as Model)
    const getWidgetCopyV2 = operation('getWidgetCopyV2', derived.model as Model)
    // `op getCopyT<U> is getT<U>;`: the statement first runs on the instance getCopyT<Widget>,
    // which belongs to no namespace, while the template declaration does.
    const instanceCopyId = parameter(parameters(), parameter(parameters()))
    const getCopyT = operation('getCopyT', parameters(), [{ kind: SyntaxKind.TemplateParameterDeclaration }])
    // `op getPlainCopyT<U> is getPlain;`: the statement first runs on the template declaration.
    const declarationCopyId = parameter(parameters(), parameter(parameters()))
    const getPlainCopyT = operation('getPlainCopyT', declarationCopyId.model as Model, [{ kind: SyntaxKind.TemplateParameterDeclaration }])

    const program = createProgram(new Map(), namespace([getWidgetCopy, getWidgetCopyV2, getCopyT, getPlainCopyT]))
    program.checker.getTypeForNode = () => {
      throw new Error('an augment target reference must not be resolved')
    }
    const augment = { kind: SyntaxKind.AugmentDecoratorStatement, targetType: { kind: SyntaxKind.TypeReference } }
    const templateAugment = { kind: SyntaxKind.AugmentDecoratorStatement, targetType: { kind: SyntaxKind.TypeReference } }
    const declarationAugment = { kind: SyntaxKind.AugmentDecoratorStatement, targetType: { kind: SyntaxKind.TypeReference } }

    $traceId(applicationContext(program, augment), named, 'TRC-COPY-ID-001')
    $traceId(applicationContext(program, augment), derived, 'TRC-COPY-ID-001')
    $traceId(applicationContext(program, templateAugment), instanceCopyId, 'TRC-COPY-T-ID-001')
    $traceId(applicationContext(program, declarationAugment), declarationCopyId, 'TRC-PLAIN-COPY-T-ID-001')
    // Which operation owns the copied parameters is unknown while checking.
    expect(trace(program, named)).toBeUndefined()

    $onValidate(program)

    expect(program.diagnostics).toEqual([])
    expect(trace(program, named)).toEqual({ trackingId: 'TRC-COPY-ID-001' })
    expect(trace(program, derived)).toBeUndefined()
    expect(trace(program, instanceId)).toBeUndefined()
    expect(trace(program, instanceCopyId)).toBeUndefined()
    expect(trace(program, declarationCopyId)).toBeUndefined()
    // A mutator clone made after checking (a versioned snapshot) is the same element.
    const clone = { ...named } as ModelProperty
    $traceId(applicationContext(program, augment), clone, 'TRC-COPY-ID-001')
    expect(trace(program, clone)).toEqual({ trackingId: 'TRC-COPY-ID-001' })
  })

  it('does not count an operation that `interface ... extends` copies as the owner of the parameters it shares', () => {
    // `interface Ops<T> { read is getT<T>; }` + `interface WidgetOps extends Ops<Widget> {}`:
    // WidgetOps.read is a clone of Ops<Widget>.read and keeps its parameters, an instance's.
    const opsStatement = { kind: SyntaxKind.InterfaceStatement, templateParameters: [{ kind: SyntaxKind.TemplateParameterDeclaration }] }
    const signature: { kind: SyntaxKind; parent: object; parameters?: object } = { kind: SyntaxKind.OperationSignatureDeclaration, parent: {} }
    const parametersNode = { kind: SyntaxKind.ModelExpression, parent: signature }
    signature.parameters = parametersNode
    const sharedParameters = { kind: 'Model', name: '', node: parametersNode } as unknown as Model
    const instanceRead = { kind: 'ModelProperty', name: 'id', node: {}, model: sharedParameters, sourceProperty: {} } as unknown as ModelProperty
    const widgetOps = {
      kind: 'Interface',
      name: 'WidgetOps',
      node: { kind: SyntaxKind.InterfaceStatement, templateParameters: [] },
      operations: new Map(),
    } as unknown as Interface
    // The clone keeps the node of Ops<T>.read but belongs to the concrete WidgetOps.
    widgetOps.operations.set('read', {
      kind: 'Operation',
      name: 'read',
      node: { kind: SyntaxKind.OperationStatement, parent: opsStatement, templateParameters: [] },
      interface: widgetOps,
      parameters: sharedParameters,
    } as unknown as Operation)
    const program = createProgram(new Map(), namespace([], [widgetOps]))
    const augment = { kind: SyntaxKind.AugmentDecoratorStatement, targetType: { kind: SyntaxKind.TypeReference } }

    $traceId(applicationContext(program, augment), instanceRead, 'TRC-OPS-T-READ-ID-001')
    $onValidate(program)

    expect(program.diagnostics).toEqual([])
    expect(trace(program, instanceRead)).toBeUndefined()
  })

  it('lets a derived type carry its own @traceId next to the replayed one', () => {
    const baseStatement = { kind: SyntaxKind.ModelStatement }
    const derivedStatement = { kind: SyntaxKind.ModelStatement }
    const base = model('Base')
    const derived = model('Derived')
    const program = createProgram(new Map([[baseStatement, base], [derivedStatement, derived]]))
    const baseApplication = { kind: SyntaxKind.DecoratorExpression, parent: baseStatement }
    const derivedApplication = { kind: SyntaxKind.DecoratorExpression, parent: derivedStatement }

    $traceId(applicationContext(program, baseApplication), base, 'TRC-BASE-003')
    $traceId(applicationContext(program, baseApplication), derived, 'TRC-BASE-003')
    $traceId(applicationContext(program, derivedApplication), derived, 'TRC-DERIVED-003')

    expect(program.diagnostics).toEqual([])
    expect(trace(program, base)).toEqual({ trackingId: 'TRC-BASE-003' })
    expect(trace(program, derived)).toEqual({ trackingId: 'TRC-DERIVED-003' })
  })

  it('keeps the id on a mutator clone of the declaration but not on a template instance', () => {
    const widgetStatement = { kind: SyntaxKind.ModelStatement, templateParameters: [] }
    const pageStatement = { kind: SyntaxKind.ModelStatement, templateParameters: [{ kind: SyntaxKind.TemplateParameterDeclaration }] }
    // A mutator clone (e.g. a versioned snapshot) copies the type, node included.
    const widget = { kind: 'Model', name: 'Widget', node: widgetStatement } as unknown as Model
    const widgetClone = { ...widget } as Model
    const page = { kind: 'Model', name: 'Page', node: pageStatement } as unknown as Model
    const pageInstance = { kind: 'Model', name: 'Page', node: pageStatement } as unknown as Model
    const program = createProgram(new Map<object, Type>([[widgetStatement, widget], [pageStatement, page]]))
    const widgetApplication = { kind: SyntaxKind.DecoratorExpression, parent: widgetStatement }
    const pageApplication = { kind: SyntaxKind.DecoratorExpression, parent: pageStatement }

    $traceId(applicationContext(program, widgetApplication), widget, 'TRC-WIDGET-004')
    $traceId(applicationContext(program, widgetApplication), widgetClone, 'TRC-WIDGET-004')
    $traceId(applicationContext(program, pageApplication), pageInstance, 'TRC-PAGE-004')

    expect(program.diagnostics).toEqual([])
    expect(widgetClone).not.toBe(widget)
    expect(trace(program, widget)).toEqual({ trackingId: 'TRC-WIDGET-004' })
    expect(trace(program, widgetClone)).toEqual({ trackingId: 'TRC-WIDGET-004' })
    expect(trace(program, pageInstance)).toBeUndefined()
  })

  it('treats a decorator invoked without a syntax node as written on its target', () => {
    const program = createProgram()
    const target = model('Programmatic')

    $traceId(applicationContext(program, undefined), target, 'TRC-PROG-001')

    expect(program.diagnostics).toEqual([])
    expect(trace(program, target)).toEqual({ trackingId: 'TRC-PROG-001' })
  })

  it('still rejects the same id written in two separate @traceId applications', () => {
    const firstStatement = { kind: SyntaxKind.ModelStatement }
    const secondStatement = { kind: SyntaxKind.ModelStatement }
    const first = model('First')
    const second = model('Second')
    const program = createProgram(new Map([[firstStatement, first], [secondStatement, second]]))

    $traceId(applicationContext(program, { kind: SyntaxKind.DecoratorExpression, parent: firstStatement }), first, 'TRC-SHARED-001')
    $traceId(applicationContext(program, { kind: SyntaxKind.DecoratorExpression, parent: secondStatement }), second, 'TRC-SHARED-001')

    expect(program.diagnostics).toHaveLength(1)
    expect(program.diagnostics[0]?.message).toContain('Duplicate traceId "TRC-SHARED-001"')
    expect(trace(program, second)).toBeUndefined()
  })
})
