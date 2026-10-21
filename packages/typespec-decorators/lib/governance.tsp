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

/**
 * Assigns a stable, immutable tracking identifier to a specification element
 * that survives file moves and symbol renames.
 * Emits the `x-oa-sdk-trace.trackingId` OpenAPI extension payload on the declaration
 * it is written on, and on mutator clones of it (e.g. `@versioned` snapshots).
 * Types TypeSpec derives from that declaration (`is` copies, interface-extends clones,
 * spread copies, template instances) do not carry it; give such a type its own @traceId.
 * Known limits: parameters and anonymous types that TypeSpec shares between a declaration
 * and its derived types (interface-extends operation parameters, anonymous body/return/property
 * types of `op is`/`model is`) keep the id under every derived element, and
 * `scalar B extends A` inherits A's id through the OpenAPI emitter.
 * An id may be written in only one @traceId application per program.
 */
extern dec traceId(
  target: Model | Operation | Interface | Enum | Union | Scalar | ModelProperty,
  id: valueof string,
);

/**
 * Declares one or more canonical definition IDs or symbol identifiers that this
 * specification element replaces (refactoring / migration lineage).
 * Emits the `x-oa-sdk-trace.replaces` OpenAPI extension payload.
 */
extern dec replaces(
  target: Model | Operation | Interface | Enum | Union | Scalar,
  ...replacedIds: valueof string[],
);

/**
 * Links a specification element to one or more external requirement, compliance,
 * or issue identifiers (e.g. "GDPR-ART-15", "SPEC-USER-001").
 * Emits the `x-oa-sdk-trace.requirements` OpenAPI extension payload.
 */
extern dec requirement(
  target: Model | Operation | Interface | Enum | Union | Scalar | ModelProperty,
  ...requirementIds: valueof string[],
);

/**
 * Attaches evidence references (string locators like "contracts/common.md#lease",
 * requirement claims like "REQ-01:Verified", or structured record metadata) to a
 * TypeSpec declaration (`IUD-07`).
 * Emits `x-oa-sdk-evidence` and merges into `x-oa-sdk-trace.evidence`.
 */
extern dec evidence(
  target: Model | Operation | Interface | Enum | Union | Scalar | ModelProperty,
  ...evidenceArgs: valueof unknown[],
);

/**
 * Binds a detached evidence review document (`evidence/*.md#anchor`) or verification status
 * to a TypeSpec declaration without bloating implementation code comments.
 * Emits `x-oa-sdk-evidence.review`.
 */
extern dec evidenceReview(
  target: Model | Operation | Interface | Enum | Union | Scalar | ModelProperty,
  reviewLocator: valueof string,
  summary?: valueof string,
);

/**
 * Declares the single functional Intent-Unit ID (`@intent`) and optional 1:1 co-decomposed
 * documentation anchor (`@doc` locator) owned by a TypeSpec model, interface, or operation (`IUD-02`).
 * Emits `x-oa-sdk-intent` and merges into `x-oa-sdk-trace.intent`.
 */
extern dec intent(
  target: Model | Operation | Interface | Enum | Union | Scalar | ModelProperty,
  intentId: valueof string,
  docAnchor?: valueof string,
);

/**
 * Declares Base A -> Derived B contract lineage (`@derivedFrom("BaseA", "reason")`) when an
 * intent unit derives a specialized contract (`model B is A`) rather than polluting `Layer 1 Base A`
 * with mode flags or intent-specific optional fields (`IUD-05`).
 * Emits `x-oa-sdk-derived-from` and merges into `x-oa-sdk-trace.derivedFrom`.
 */
extern dec derivedFrom(
  target: Model | Operation | Interface | Enum | Union | Scalar,
  baseSymbol: valueof string,
  reason: valueof string,
);

