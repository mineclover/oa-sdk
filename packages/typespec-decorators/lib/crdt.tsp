import "../dist/crdt.js";

using TypeSpec.Reflection;

namespace OaSdkTypeSpec;

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
