import "../dist/governance.js";

using TypeSpec.Reflection;

namespace OaSdkTypeSpec;

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
