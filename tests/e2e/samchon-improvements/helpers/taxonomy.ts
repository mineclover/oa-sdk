/**
 * Re-exports from @oa-sdk/ast-sync genuine package.
 */
export {
  classifyTypeShape,
  auditTypeShapesInSource,
  extractDeclarationShape,
  collectShapeFeatures,
  getDeclarationShapesInSource,
  ALL_SHAPE_FEATURES,
  UNSUPPORTED_SHAPE_FEATURES,
  POLICY_REQUIRED_SHAPE_FEATURES,
  DIRECT_SHAPE_FEATURES,
  UNSUPPORTED_FEATURES,
  POLICY_REQUIRED_FEATURES,
  DIRECT_FEATURES,
} from '@oa-sdk/ast-sync'
export type {
  ContractShapeFeature,
  TypeSpecProjection,
  ContractTypeShape,
  ShapeDiagnostic,
  ShapeAuditResult,
} from '@oa-sdk/ast-sync'
