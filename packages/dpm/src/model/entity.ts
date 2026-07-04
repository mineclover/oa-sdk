import {
  renderCanonicalKeySegments,
  type CanonicalKeyValueMap,
  type TenantNamespaceInput,
} from './canonical-key.js'
import {
  copyEndpoint,
  type ModelEndpoint,
} from './endpoint.js'

export type EntityKeyStrategyType = 'single_column' | 'composite'

export type EntityKeyStrategy = {
  type: EntityKeyStrategyType
  canonicalColumns: string[]
  separator?: string
  tenant?: TenantNamespaceInput
}

export type EntityTransform = {
  type: 'deterministic_token'
  namespace: string
  prefix?: string
  reversible: boolean
}

export type EntityDeclarationInput = {
  name: string
  namespace: string
  root: ModelEndpoint
  keyStrategy: EntityKeyStrategy
  transform: EntityTransform
}

export type EntityDeclaration = EntityDeclarationInput & {
  identity: string
  keyStrategy: EntityKeyStrategy & {
    separator: string
  }
}

export function createEntityDeclaration(input: EntityDeclarationInput): EntityDeclaration {
  requireNonEmpty(input.name, 'entity.name')
  requireNonEmpty(input.namespace, 'entity.namespace')
  const root = copyEndpoint(input.root, 'entity.root')
  const keyStrategy = normalizeKeyStrategy(input.keyStrategy, root)
  if (input.transform.namespace !== input.namespace) {
    throw new Error('entity transform namespace must match entity namespace')
  }

  return {
    name: input.name,
    namespace: input.namespace,
    root,
    keyStrategy,
    transform: copyTransform(input.transform),
    identity: `entity:${input.namespace}/${input.name}`,
  }
}

export function renderEntityCanonicalKey(
  entity: Pick<EntityDeclaration, 'namespace' | 'keyStrategy'>,
  values: CanonicalKeyValueMap,
): string {
  return renderCanonicalKeySegments({
    namespace: entity.namespace,
    separator: entity.keyStrategy.separator,
    tenantColumns: entity.keyStrategy.tenant?.columns ?? [],
    columns: entity.keyStrategy.canonicalColumns,
    values,
  })
}

function normalizeKeyStrategy(
  strategy: EntityKeyStrategy,
  root: ModelEndpoint,
): EntityDeclaration['keyStrategy'] {
  const separator = strategy.separator ?? ':'
  requireNonEmpty(separator, 'entity.keyStrategy.separator')
  if (strategy.canonicalColumns.length === 0) {
    throw new Error('entity.keyStrategy.canonicalColumns must contain at least one column')
  }
  if (strategy.type === 'single_column' && strategy.canonicalColumns.length !== 1) {
    throw new Error('single_column entity keys require exactly one canonical column')
  }

  const canonicalColumns = strategy.canonicalColumns.map((column, index) =>
    requireRootColumn(root, column, `entity.keyStrategy.canonicalColumns[${index}]`),
  )
  const tenant = strategy.tenant
    ? {
        columns: strategy.tenant.columns.map((column, index) =>
          requireRootColumn(root, column, `entity.keyStrategy.tenant.columns[${index}]`),
        ),
      }
    : undefined

  return {
    type: strategy.type,
    canonicalColumns,
    separator,
    ...(tenant ? { tenant } : {}),
  }
}

function requireRootColumn(root: ModelEndpoint, column: string, label: string): string {
  const normalized = requireNonEmpty(column, label)
  if (!root.columns.includes(normalized)) {
    throw new Error(`${label} must be declared on entity.root.columns`)
  }
  return normalized
}

function copyTransform(transform: EntityTransform): EntityTransform {
  requireNonEmpty(transform.type, 'entity.transform.type')
  requireNonEmpty(transform.namespace, 'entity.transform.namespace')
  return {
    type: transform.type,
    namespace: transform.namespace,
    ...(transform.prefix ? { prefix: transform.prefix } : {}),
    reversible: transform.reversible,
  }
}

function requireNonEmpty(value: string, label: string): string {
  if (value.length === 0) {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value
}
