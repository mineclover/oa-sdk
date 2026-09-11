/**
 * Type Shape Taxonomy & Feasibility Diagnostics
 *
 * Defines the 24 TypeScript syntax features and 3-tier feasibility projections
 * ('direct' | 'policy-required' | 'unsupported') for OpenAPI 3.2 and TypeSpec contract emission.
 */

export type ContractShapeFeature =
  | 'array'
  | 'conditional'
  | 'constructor-type'
  | 'function-type'
  | 'generic-declaration'
  | 'generic-instantiation'
  | 'import-type'
  | 'indexed-access'
  | 'inheritance'
  | 'intersection'
  | 'literal'
  | 'mapped'
  | 'nullable'
  | 'object'
  | 'optional'
  | 'recursive-reference'
  | 'reference'
  | 'template-literal'
  | 'tuple'
  | 'type-operator'
  | 'type-query'
  | 'undefined'
  | 'union'
  | 'utility-type';

export type TypeSpecProjection = 'direct' | 'policy-required' | 'unsupported';

export interface ContractTypeShape {
  readonly features: readonly ContractShapeFeature[];
  readonly typeSpecProjection: TypeSpecProjection;
}

export interface ShapeDiagnostic {
  readonly code: 'unsupported-shape' | 'policy-required-shape';
  readonly message: string;
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly endLine: number;
  readonly endColumn: number;
  readonly feature: ContractShapeFeature;
  readonly snippet?: string;
  readonly severity: 'error' | 'warning';
}

export interface ShapeAuditResult {
  readonly valid: boolean;
  readonly scannedDeclarations: number;
  readonly scannedFiles: number;
  readonly diagnostics: readonly ShapeDiagnostic[];
  readonly summary: string;
}

/**
 * 9 Syntax features that cannot be expressed statically in OpenAPI 3.2 / TypeSpec
 * without arbitrary programmatic execution or code-level evaluation.
 */
export const UNSUPPORTED_SHAPE_FEATURES: ReadonlySet<ContractShapeFeature> = new Set<ContractShapeFeature>([
  'conditional',
  'constructor-type',
  'function-type',
  'import-type',
  'indexed-access',
  'mapped',
  'template-literal',
  'type-operator',
  'type-query',
]);

/**
 * 5 Syntax features that can be represented in OpenAPI 3.2 or TypeSpec,
 * but require explicit TypeAdapter authoring policies.
 */
export const POLICY_REQUIRED_SHAPE_FEATURES: ReadonlySet<ContractShapeFeature> = new Set<ContractShapeFeature>([
  'generic-declaration',
  'generic-instantiation',
  'tuple',
  'undefined',
  'utility-type',
]);

/**
 * 10 Direct mapping features suitable for static schema projection.
 */
export const DIRECT_SHAPE_FEATURES: ReadonlySet<ContractShapeFeature> = new Set<ContractShapeFeature>([
  'array',
  'inheritance',
  'intersection',
  'literal',
  'nullable',
  'object',
  'optional',
  'recursive-reference',
  'reference',
  'union',
]);

export const UNSUPPORTED_FEATURES = UNSUPPORTED_SHAPE_FEATURES;
export const POLICY_REQUIRED_FEATURES = POLICY_REQUIRED_SHAPE_FEATURES;
export const DIRECT_FEATURES = DIRECT_SHAPE_FEATURES;

/**
 * All 24 recognized TypeScript syntax features.
 */
export const ALL_SHAPE_FEATURES: readonly ContractShapeFeature[] = [
  'array',
  'conditional',
  'constructor-type',
  'function-type',
  'generic-declaration',
  'generic-instantiation',
  'import-type',
  'indexed-access',
  'inheritance',
  'intersection',
  'literal',
  'mapped',
  'nullable',
  'object',
  'optional',
  'recursive-reference',
  'reference',
  'template-literal',
  'tuple',
  'type-operator',
  'type-query',
  'undefined',
  'union',
  'utility-type',
];

/**
 * Standard TypeScript utility types recognized as 'utility-type'.
 */
export const UTILITY_TYPE_NAMES: ReadonlySet<string> = new Set<string>([
  'Awaited',
  'Exclude',
  'Extract',
  'InstanceType',
  'NonNullable',
  'Omit',
  'Parameters',
  'Partial',
  'Pick',
  'Readonly',
  'Record',
  'Required',
  'ReturnType',
  'Uppercase',
  'Lowercase',
  'Capitalize',
  'Uncapitalize',
]);
