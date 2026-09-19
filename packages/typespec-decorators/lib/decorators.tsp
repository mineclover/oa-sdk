import "../dist/decorators.js";

using TypeSpec.Reflection;

namespace OaSdkTypeSpec;

/**
 * Refer to a reusable OpenAPI response component from an operation response.
 * The helper owns only the v5 component-reference payload; it cannot emit an
 * arbitrary OA SDK extension.
 */
extern dec oaUseResponseComponent(
  target: Operation,
  statusCode: valueof string,
  componentName: valueof string,
);

/**
 * Declares one or more persona capability traits supported by an operation,
 * validated against packages/personas/src/traits/skill.yaml.
 * Emits the x-oa-sdk-persona-traits OpenAPI extension payload.
 */
extern dec personaCapability(
  target: Operation,
  ...traits: valueof string[],
);

/**
 * Attaches pseudonymization transform rules and privacy controls to a model property.
 * Emits the x-oa-sdk-dpm-projection OpenAPI extension payload.
 */
extern dec pseudonymize(
  target: ModelProperty,
  transform: valueof string,
  role?: valueof string,
  pii?: valueof boolean,
  relationship?: valueof string,
);

/**
 * Declares CRDT semantics and conflict resolution strategy for a model property.
 * Emits the x-oa-sdk-crdt OpenAPI extension payload.
 */
extern dec crdt(
  target: ModelProperty,
  options: valueof unknown,
);

/**
 * Declares CRDT partitioning, sharding, and compaction lifecycle for a model.
 * Emits the x-oa-sdk-crdt-entity OpenAPI extension payload.
 */
extern dec crdtEntity(
  target: Model,
  options: valueof unknown,
);

