/**
 * Canonical AST Bidirectional Synchronization Data Structures & Types
 * (V3 Unified Architecture)
 */

export interface PropertyConstraint {
  min?: number | undefined;
  max?: number | undefined;
  minimum?: number | undefined;
  maximum?: number | undefined;
  minLength?: number | undefined;
  maxLength?: number | undefined;
  pattern?: string | undefined;
  format?: string | undefined;
  default?: unknown;
  email?: boolean | undefined;
  url?: boolean | undefined;
  uuid?: boolean | undefined;
  cuid?: boolean | undefined;
  datetime?: boolean | undefined;
  int?: boolean | undefined;
  positive?: boolean | undefined;
  nonnegative?: boolean | undefined;
  negative?: boolean | undefined;
  nonpositive?: boolean | undefined;
  multipleOf?: number | undefined;
  enum?: (string | number | boolean)[] | undefined;
  [key: string]: unknown;
}

export interface EntityPropertySpec {
  name: string;
  type: string;
  optional?: boolean | undefined;
  nullable?: boolean | undefined;
  docComment?: string | undefined;
  defaultValue?: unknown;
  constraints?: PropertyConstraint | undefined;
  metadata?: Record<string, unknown> | undefined;
  sourceSpan?: { start: number; end: number } | undefined;
}

export type EntityKind = 'schema' | 'interface' | 'type-alias' | 'object-literal' | 'node';

export interface EntityDiscriminator {
  propertyName: string;
  value?: string | undefined;
  mapping?: Record<string, string> | undefined;
}

export interface EntitySpec {
  id: string;
  name: string;
  kind: EntityKind;
  docComment?: string | undefined;
  properties: Record<string, EntityPropertySpec>;
  extends?: string[] | undefined;
  discriminator?: EntityDiscriminator | undefined;
  metadata?: Record<string, unknown> | undefined;
  sourceSpan?: { start: number; end: number } | undefined;
}

export interface TextEdit {
  start: number;
  end: number;
  newText: string;
}

export type ASTDiffKind =
  | 'add-property'
  | 'remove-property'
  | 'update-property'
  | 'update-entity'
  | 'add-extends'
  | 'remove-extends'
  | 'update-doc-comment'
  | 'update-discriminator';

export interface ASTDiff {
  kind: ASTDiffKind;
  path: string;
  propertyName?: string | undefined;
  oldValue?: unknown;
  newValue?: unknown;
  description?: string | undefined;
}
