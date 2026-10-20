/**
 * @fileoverview Intent-Unit Module: OpenAPI Governance, DPM Privacy, Traceability & Evidence/Intent Decorator Barrel
 * @intent INTENT-OA-DEC-GOVERNANCE
 * @doc discussions/intent-modularization-convention/track-c-oa-sdk-delegation/01-OA-SDK-OWNERSHIP-AND-DELEGATION-PLAN.md#todo-oa-01
 */

import type {
  DecoratorContext,
  DiagnosticTarget,
  Enum,
  Interface,
  Model,
  ModelProperty,
  Namespace,
  Operation,
  Program,
  Scalar,
  Type,
  Union,
} from '@typespec/compiler'
import { SyntaxKind, type Node } from '@typespec/compiler/ast'
import { getExtensions, setExtension } from '@typespec/openapi'
import {
  DERIVED_FROM_EXTENSION,
  EVIDENCE_EXTENSION,
  INTENT_EXTENSION,
  TRACE_EXTENSION,
  VALID_DOC_ANCHOR_PATTERN,
  VALID_DPM_ROLES,
  VALID_DPM_TRANSFORMS,
  VALID_INTENT_ID_PATTERN,
  VALID_PERSONA_TRAITS,
  VALID_REPLACES_ID_PATTERN,
  VALID_REQUIREMENT_ID_PATTERN,
  VALID_TRACE_ID_PATTERN,
  namespace,
} from './constants.js'
import {
  $derivedFrom,
  $evidence,
  $evidenceReview,
  $intent,
  extractHeadingFormEvidence,
  readExistingTraceExtension,
} from './evidence-and-intent-decorators.js'
import { reportDiagnostic } from './lib.js'

export {
  $derivedFrom,
  $evidence,
  $evidenceReview,
  $intent,
  DERIVED_FROM_EXTENSION,
  EVIDENCE_EXTENSION,
  extractHeadingFormEvidence,
  INTENT_EXTENSION,
  TRACE_EXTENSION,
  VALID_DOC_ANCHOR_PATTERN,
  VALID_DPM_ROLES,
  VALID_DPM_TRANSFORMS,
  VALID_INTENT_ID_PATTERN,
  VALID_PERSONA_TRAITS,
  VALID_REPLACES_ID_PATTERN,
  VALID_REQUIREMENT_ID_PATTERN,
  VALID_TRACE_ID_PATTERN,
  namespace,
}

// The Atlas schema drift gate is a JavaScript-only governance check (no decorator), served
// from this `./governance` subpath so a CI script can import it next to the decorators.
export {
  AtlasSchemaInspectOutputSchema,
  verifyAtlasSchemaDrift,
  type AtlasColumn,
  type AtlasDriftReport,
  type AtlasSchemaInspectOutput,
  type AtlasTable,
  type DriftIssue,
  type StorageDriftSchema,
  type StorageMapping,
} from './storage-drift.js'

export const PERSONA_TRAITS_EXTENSION = 'x-oa-sdk-persona-traits'
export const DPM_PROJECTION_EXTENSION = 'x-oa-sdk-dpm-projection'

const TRACE_ID_STATE_KEY = Symbol.for('@oa-sdk/typespec-decorators/traceIdRegistry')
/** Per program: each `@@traceId` augment statement -> its {@link AugmentedTrackingId}. */
const AUGMENT_TARGET_STATE_KEY = Symbol.for('@oa-sdk/typespec-decorators/traceIdAugmentTargets')

export type TraceabilityTarget = Model | Operation | Interface | Enum | Union | Scalar | ModelProperty
export type LineageTarget = Model | Operation | Interface | Enum | Union | Scalar

/**
 * One `@@traceId(Target, id)` statement. TypeSpec runs the statement on the type it names before
 * any other (see {@link applyAugmentedTrackingId}), then replays it onto types derived from that
 * type and onto mutator clones of it.
 */
interface AugmentedTrackingId {
  /** The type the statement names: the first type it ran on. */
  readonly named: TraceabilityTarget
  readonly trackingId: string
  /**
   * Whether `named` is a concrete element, which carries the id, rather than part of a template;
   * `undefined` until `$onValidate` decides it (see {@link isConcreteAugmentTarget}).
   */
  carries: boolean | undefined
  /** `named` and its mutator clones that the statement ran on while `carries` was undecided. */
  readonly undecided: TraceabilityTarget[]
}

export function $personaCapability(
  context: DecoratorContext,
  target: Operation,
  ...traits: string[]
): void {
  let hasInvalid = false
  for (let idx = 0; idx < traits.length; idx++) {
    const trait = traits[idx]
    if (trait === undefined || !VALID_PERSONA_TRAITS.has(trait)) {
      hasInvalid = true
      reportDiagnostic(context.program, {
        code: 'invalid-persona-trait',
        target: context.getArgumentTarget(idx) ?? target,
        format: { trait: trait ?? '' },
      })
    }
  }
  if (hasInvalid) return

  const existing = getExtensions(context.program, target).get(PERSONA_TRAITS_EXTENSION)
  const existingTraits = Array.isArray(existing)
    ? existing.filter((t): t is string => typeof t === 'string')
    : []

  const merged = Array.from(new Set([...existingTraits, ...traits])).sort()
  setExtension(context.program, target, PERSONA_TRAITS_EXTENSION, merged)
}

export function $pseudonymize(
  context: DecoratorContext,
  target: ModelProperty,
  transform: string,
  role?: string,
  pii?: boolean,
  relationship?: string,
): void {
  if (!VALID_DPM_TRANSFORMS.has(transform)) {
    reportDiagnostic(context.program, {
      code: 'invalid-pseudonymize-rule',
      target: context.getArgumentTarget(0) ?? target,
      format: {
        message: `Invalid transform "${transform}". Expected one of: ${[...VALID_DPM_TRANSFORMS].join(', ')}.`,
      },
    })
    return
  }

  if (role !== undefined && !VALID_DPM_ROLES.has(role)) {
    reportDiagnostic(context.program, {
      code: 'invalid-pseudonymize-rule',
      target: context.getArgumentTarget(1) ?? target,
      format: {
        message: `Invalid role "${role}". Expected one of: ${[...VALID_DPM_ROLES].join(', ')}.`,
      },
    })
    return
  }

  if (role === 'direct_identifier' && transform === 'keep') {
    reportDiagnostic(context.program, {
      code: 'invalid-pseudonymize-rule',
      target: context.getArgumentTarget(0) ?? target,
      format: { message: 'direct_identifier cannot use keep transform (SAF001).' },
    })
    return
  }

  if (role === 'foreign_identifier' && pii === true && !relationship) {
    reportDiagnostic(context.program, {
      code: 'invalid-pseudonymize-rule',
      target: context.getArgumentTarget(1) ?? target,
      format: { message: 'pii=true foreign_identifier requires relationship reference (SAF002).' },
    })
    return
  }

  if (pii === true && transform === 'keep') {
    reportDiagnostic(context.program, {
      code: 'invalid-pseudonymize-rule',
      target: context.getArgumentTarget(0) ?? target,
      format: { message: 'pii=true field cannot use keep transform (SAF010).' },
    })
    return
  }

  const payload: Record<string, unknown> = {
    transform,
    ...(role !== undefined ? { role } : {}),
    ...(pii !== undefined ? { pii } : {}),
    ...(relationship !== undefined ? { relationship } : {}),
  }

  setExtension(context.program, target, DPM_PROJECTION_EXTENSION, payload)
}

export function $traceId(
  context: DecoratorContext,
  target: TraceabilityTarget,
  id: string,
): void {
  const normalized = typeof id === 'string' ? id.trim() : ''
  if (!VALID_TRACE_ID_PATTERN.test(normalized)) {
    reportDiagnostic(context.program, {
      code: 'invalid-trace-rule',
      target: context.getArgumentTarget(0) ?? target,
      format: {
        message: `Invalid traceId "${id}". Expected 2-128 characters matching ${VALID_TRACE_ID_PATTERN.source}.`,
      },
    })
    return
  }

  // Ownership is keyed on the decorator application, not on the decorated type.
  // TypeSpec re-runs a declaration's decorators on every type it derives from that
  // declaration (`model B is A`, `op b is a`, operations cloned by `interface B
  // extends A`, properties copied by a spread or an `is`), on every template
  // instance and on every clone a mutator makes of it (a versioned snapshot), so one
  // `@traceId` application legitimately reaches several types.
  // Those runs share the application's syntax node (`decoratorTarget`); two separate
  // applications of the same id do not, and stay a duplicate. Contexts without a
  // syntax node (decorators invoked programmatically) fall back to the target type.
  const owner: unknown = context.decoratorTarget ?? target
  const stateMap = context.program.stateMap(TRACE_ID_STATE_KEY)
  const existingOwner: unknown = stateMap.get(normalized as never)
  if (existingOwner !== undefined && existingOwner !== owner) {
    reportDiagnostic(context.program, {
      code: 'invalid-trace-rule',
      target: context.getArgumentTarget(0) ?? target,
      format: {
        message: `Duplicate traceId "${normalized}". Each @traceId within a TypeSpec program must be unique.`,
      },
    })
    return
  }
  stateMap.set(normalized as never, owner)

  // A tracking id names one spec element, so only the declaration the application is
  // written on, or the type a `@@traceId` augment names (which may be a member TypeSpec
  // copied, e.g. `CreateWidget.name` of `model CreateWidget { ...Widget }`), carries it.
  // A derived type is a separate element (its own OpenAPI schema, property or operation);
  // emitting the id there too would give two elements one trackingId,
  // which `oa-gen trace --verify` rejects as `traceability/duplicate-tracking-id`.
  // A derived type gets a generated tracking id, or its own `@traceId`. A mutator clone
  // of the declaration (each version document of a `@versioned` service is emitted from
  // one) is that same element in another view of the program, so it keeps the id.
  const application = context.decoratorTarget
  if (isSyntaxNode(application) && application.kind === SyntaxKind.AugmentDecoratorStatement) {
    applyAugmentedTrackingId(context.program, application, target, normalized)
  } else if (isDeclaringType(context, target)) {
    writeTrackingId(context.program, target, normalized)
  }
}

/**
 * Library validation, run by the TypeSpec compiler once checking is complete. It decides the
 * `@@traceId` statements whose named type is a property copied into an operation's parameters
 * (`@@traceId(getWidgetCopy::parameters.id, ...)` with `op getWidgetCopy is getT<Widget>`, or a
 * spread into the signature): such a property belongs to the operation that owns those
 * parameters, which the checker links to them only after the statement ran (see
 * {@link isConcreteAugmentTarget}). The id goes on the property, and on the mutator clones made
 * of it meanwhile, when that operation is concrete; an operation that is or belongs to a
 * template (`op getCopyT<U> is getT<U>`, an operation of `interface Ops<T>`) gets none.
 */
export function $onValidate(program: Program): void {
  let owners: ReadonlyMap<Model, Operation> | undefined
  program.stateMap(AUGMENT_TARGET_STATE_KEY).forEach(value => {
    // Only applyAugmentedTrackingId writes the state map under AUGMENT_TARGET_STATE_KEY.
    const augmented = value as AugmentedTrackingId
    if (augmented.carries !== undefined) return
    owners ??= operationsByParameters(program.getGlobalNamespaceType())
    const { named } = augmented
    const owner = named.kind === 'ModelProperty' && named.model !== undefined ? owners.get(named.model) : undefined
    augmented.carries = owner !== undefined && !isPartOfTemplate(owner)
    if (augmented.carries) {
      for (const target of augmented.undecided) writeTrackingId(program, target, augmented.trackingId)
    }
    augmented.undecided.length = 0
  })
}

function writeTrackingId(program: Program, target: TraceabilityTarget, trackingId: string): void {
  const existing = getExtensions(program, target).get(TRACE_EXTENSION)
  const trace = typeof existing === 'object' && existing !== null && !Array.isArray(existing)
    ? existing as Record<string, unknown>
    : {}
  setExtension(program, target, TRACE_EXTENSION, { ...trace, trackingId })
}

/**
 * Whether `target` is the type the current `@traceId` application is written on, or a clone of
 * that type made by TypeSpec's mutation engine (see {@link isSameDeclaration}). `false` for a
 * type TypeSpec derived from it and replayed the application onto: a `model B is A` or
 * `op b is a` copy, an operation cloned by `interface B extends A`, a property copied by a
 * spread or an `is`, and a template instance (`Page<User>` is not the declaration `Page<T>`).
 * Without a syntax node for the application (a decorator invoked programmatically) the target
 * counts as the declaration. A `@@traceId` statement is handled by
 * {@link applyAugmentedTrackingId}.
 */
function isDeclaringType(context: DecoratorContext, target: TraceabilityTarget): boolean {
  const application = context.decoratorTarget
  if (!isSyntaxNode(application)) return true
  const declaration = application.kind === SyntaxKind.DecoratorExpression ? application.parent : undefined
  if (declaration === undefined) return true
  const declared: Type | undefined = context.program.checker.getTypeForNode(declaration)
  if (declared === undefined) return false
  if (target === declared) return true
  // A template declaration (or a member of one) never runs its own decorators, so a type
  // sharing its syntax node is a template instance or a member of one.
  if (declared.node !== undefined && isInTemplateDeclaration(declared.node)) return false
  return isSameDeclaration(target, declared)
}

/**
 * Puts the id of the `@@traceId` statement `augment` on `target` when `target` is the type the
 * statement names, or a mutator clone of it, and that type is a concrete element.
 *
 * The named type is the first type the statement runs on in this program. TypeSpec runs an
 * augment on the type its target reference names (a declaration, or a member TypeSpec copied
 * there: `CreateWidget.name` of `model CreateWidget { ...Widget }`, a member of `model B is A`,
 * an operation of `interface B extends A`, a parameter of `op b is a`) and replays it onto a
 * derived type only once that named type is finished, since a derived type copies the
 * decorators of a resolved type; mutator clones come after checking. TypeSpec forbids an
 * augment of a template instance, so the first type is part of a template only when the
 * reference names a template declaration or a member of one (`@@traceId(Page, ...)`,
 * `@@traceId(Page.items, ...)`, `@@traceId(getT::parameters.id, ...)`); then the statement
 * runs on every instance, and none carries the id.
 *
 * Resolving the reference itself (`checker.getTypeForNode(targetType)`) cannot replace this:
 * while the augment runs on a member copy the copy is not linked to its symbol yet, so the
 * reference resolves to the member it was copied from; and a reference to a template
 * declaration without template arguments reports `invalid-template-args`.
 */
function applyAugmentedTrackingId(
  program: Program,
  augment: Node,
  target: TraceabilityTarget,
  trackingId: string,
): void {
  // Only this function writes the state map under AUGMENT_TARGET_STATE_KEY.
  const augments = program.stateMap(AUGMENT_TARGET_STATE_KEY)
  let augmented = augments.get(augment as never) as AugmentedTrackingId | undefined
  if (augmented === undefined) {
    augmented = { named: target, trackingId, carries: isConcreteAugmentTarget(target), undecided: [] }
    augments.set(augment as never, augmented)
  } else if (!isSameDeclaration(target, augmented.named)) {
    return
  }
  if (augmented.carries === undefined) augmented.undecided.push(target)
  else if (augmented.carries) writeTrackingId(program, target, trackingId)
}

/**
 * Whether the type a `@@traceId` statement names is a concrete element of the program (see
 * {@link isPartOfTemplate}), or `undefined` when only `$onValidate` can tell: a property copied
 * into an operation's parameters (by `op ... is`, or by a spread into the signature) is part of
 * a template exactly when that operation is. The parameters of an `op ... is` copy are a clone of
 * the parameters of the operation it copies, syntax node included, and nothing in the clone
 * names the operation that owns it; the checker sets that operation's `parameters` only after
 * building the clone, and so after running the statement on its properties.
 */
function isConcreteAugmentTarget(named: Type): boolean | undefined {
  if (
    named.kind === 'ModelProperty'
    && named.sourceProperty !== undefined
    && named.model !== undefined
    && isOperationParameters(named.model)
  ) {
    return undefined
  }
  return !isPartOfTemplate(named)
}

/**
 * Whether `model` is the parameters of an operation: its syntax node is the parameter list of an
 * operation signature (for an `op ... is` copy, the signature it copies).
 */
function isOperationParameters(model: Model): boolean {
  const node = model.node
  const parent = node?.parent
  return parent?.kind === SyntaxKind.OperationSignatureDeclaration && parent.parameters === node
}

/**
 * The operations declared in `namespace` and in its sub-namespaces, by their parameters model.
 * Template declarations are included and template instances (`getT<Widget>`, the operations of
 * `Ops<Widget>`) are not, since an instance belongs to no namespace. An operation that
 * `interface B extends A` copies into `B` shares its parameters with the operation of `A` it
 * copies (`cloneType` keeps them), so only the operation of the interface that declares it counts.
 */
function operationsByParameters(namespace: Namespace, owners = new Map<Model, Operation>()): Map<Model, Operation> {
  for (const operation of namespace.operations.values()) owners.set(operation.parameters, operation)
  for (const declaringInterface of namespace.interfaces.values()) {
    for (const operation of declaringInterface.operations.values()) {
      const declaredHere = declaringInterface.node !== undefined && operation.node?.parent === declaringInterface.node
      if (declaredHere) owners.set(operation.parameters, operation)
    }
  }
  for (const child of namespace.namespaces.values()) operationsByParameters(child, owners)
  return owners
}

/**
 * Whether `candidate` is `declared` itself or a clone of it made by TypeSpec's mutation engine
 * (`unsafe_mutateSubgraph*`). `@typespec/openapi3` emits each version of a `@versioned` service
 * from such clones (the `@typespec/versioning` snapshot mutators), and `MergePatchUpdate<T>`
 * builds its variants with one. The engine replays the original decorator applications on a
 * clone, which keeps the type's syntax node and its place in the program: a property clone is
 * copied from (a clone of) the original's `sourceProperty`, or from nothing when the original
 * is not a copy, and belongs to (a clone of) the original's model; an operation clone belongs to
 * (a clone of) the original's interface.
 *
 * A type TypeSpec derives from `declared` fails the comparison: a `model B is A` or
 * `op b is a` copy has its own node; a property copy (a spread, an intersection, an `is`, an
 * `op ... is` parameter) is copied from `declared` itself or from a copy of it, or belongs to
 * another model; and an operation cloned by `interface B extends A` belongs to `B`.
 * A template instance, or a member of one, shares a node with the template declaration; callers
 * rule templates out first ({@link isDeclaringType}, {@link isConcreteAugmentTarget}).
 */
function isSameDeclaration(candidate: Type, declared: Type): boolean {
  if (candidate === declared) return true
  const node = declared.node
  if (node === undefined || candidate.node !== node || candidate.kind !== declared.kind) return false
  if (candidate.kind === 'ModelProperty' && declared.kind === 'ModelProperty') {
    return isSameOrBothAbsent(candidate.sourceProperty, declared.sourceProperty)
      && isSameOrBothAbsent(candidate.model, declared.model)
  }
  if (candidate.kind === 'Operation' && declared.kind === 'Operation') {
    return isSameOrBothAbsent(candidate.interface, declared.interface)
  }
  return true
}

function isSameOrBothAbsent(candidate: Type | undefined, declared: Type | undefined): boolean {
  return candidate === undefined || declared === undefined
    ? candidate === declared
    : isSameDeclaration(candidate, declared)
}

/**
 * Whether `type` is a template declaration, a template instance or a member of one, i.e. no
 * concrete element of the program. A member TypeSpec copied into another container keeps the
 * syntax node of its source, so a copy is judged by the container it was copied into: the
 * `items` of `model UserPage is Page<User>` is concrete although its node lies inside the
 * template `Page<T>`, and the `name` that `model Box<T> { ...Widget }` copies is templated
 * although its node does not. A property copied into an operation's parameters is judged by
 * the operation instead, which only `$onValidate` can find (see {@link isConcreteAugmentTarget}).
 */
function isPartOfTemplate(type: Type): boolean {
  if (type.kind === 'ModelProperty' && type.sourceProperty !== undefined && type.model !== undefined) {
    return isPartOfTemplate(type.model)
  }
  if (type.kind === 'Operation' && type.interface !== undefined) {
    return hasTemplateParameters(type.node) || isPartOfTemplate(type.interface)
  }
  return type.node !== undefined && isInTemplateDeclaration(type.node)
}

/** Whether `node` is, or lies inside, a declaration with template parameters. */
function isInTemplateDeclaration(node: Node): boolean {
  for (let current: Node | undefined = node; current !== undefined; current = current.parent) {
    if (hasTemplateParameters(current)) return true
  }
  return false
}

function hasTemplateParameters(node: Node | undefined): boolean {
  return node !== undefined && 'templateParameters' in node && node.templateParameters.length > 0
}

function isSyntaxNode(target: DiagnosticTarget | undefined): target is Node {
  return (
    typeof target === 'object'
    && target !== null
    && 'kind' in target
    && typeof target.kind === 'number'
    && !('entityKind' in target)
  )
}

export function $replaces(
  context: DecoratorContext,
  target: LineageTarget,
  ...replacedIds: string[]
): void {
  if (replacedIds.length === 0) {
    reportDiagnostic(context.program, {
      code: 'invalid-trace-rule',
      target,
      format: { message: '@replaces requires at least one non-empty target identifier.' },
    })
    return
  }

  const validated: string[] = []
  let hasInvalid = false
  for (let idx = 0; idx < replacedIds.length; idx++) {
    const raw = replacedIds[idx]
    const normalized = typeof raw === 'string' ? raw.trim() : ''
    if (!VALID_REPLACES_ID_PATTERN.test(normalized)) {
      hasInvalid = true
      reportDiagnostic(context.program, {
        code: 'invalid-trace-rule',
        target: context.getArgumentTarget(idx) ?? target,
        format: {
          message: `Invalid replacement identifier "${raw ?? ''}". Expected non-empty canonical ID or symbol identifier matching ${VALID_REPLACES_ID_PATTERN.source}.`,
        },
      })
    } else {
      validated.push(normalized)
    }
  }
  if (hasInvalid) return

  const existing = readExistingTraceExtension(context, target)
  const existingReplaces = Array.isArray(existing.replaces)
    ? existing.replaces.filter((item): item is string => typeof item === 'string')
    : []
  const merged = Array.from(new Set([...existingReplaces, ...validated])).sort()

  setExtension(context.program, target, TRACE_EXTENSION, {
    ...existing,
    replaces: merged,
  })
}

export function $requirement(
  context: DecoratorContext,
  target: TraceabilityTarget,
  ...requirementIds: string[]
): void {
  if (requirementIds.length === 0) {
    reportDiagnostic(context.program, {
      code: 'invalid-trace-rule',
      target,
      format: { message: '@requirement requires at least one non-empty requirement identifier.' },
    })
    return
  }

  const validated: string[] = []
  let hasInvalid = false
  for (let idx = 0; idx < requirementIds.length; idx++) {
    const raw = requirementIds[idx]
    const normalized = typeof raw === 'string' ? raw.trim() : ''
    if (!VALID_REQUIREMENT_ID_PATTERN.test(normalized)) {
      hasInvalid = true
      reportDiagnostic(context.program, {
        code: 'invalid-trace-rule',
        target: context.getArgumentTarget(idx) ?? target,
        format: {
          message: `Invalid requirement identifier "${raw ?? ''}". Expected 2-128 characters matching ${VALID_REQUIREMENT_ID_PATTERN.source}.`,
        },
      })
    } else {
      validated.push(normalized)
    }
  }
  if (hasInvalid) return

  const existing = readExistingTraceExtension(context, target)
  const existingRequirements = Array.isArray(existing.requirements)
    ? existing.requirements.filter((item): item is string => typeof item === 'string')
    : []
  const merged = Array.from(new Set([...existingRequirements, ...validated])).sort()

  setExtension(context.program, target, TRACE_EXTENSION, {
    ...existing,
    requirements: merged,
  })
}
