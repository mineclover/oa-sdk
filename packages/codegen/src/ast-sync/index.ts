export {
  applyTextEdits,
  computeEntitySpecDiff,
  createDeleteEdit,
  createInsertEdit,
  createReplaceEdit,
  syncEntitySpecWithCode,
  TsAstTypeAdapter,
  TypiaTypeAdapter,
  ZodTypeAdapter,
} from '@oa-sdk/ast-sync';

export type {
  ASTDiff,
  ASTDiffKind,
  EntityDiscriminator,
  EntityKind,
  EntityPropertySpec,
  EntitySpec,
  PropertyConstraint,
  SyncOptions,
  SyncResult,
  TextEdit,
  TypeAdapter,
} from '@oa-sdk/ast-sync';
