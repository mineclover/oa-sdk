import "../dist/behavior.js";

using TypeSpec.Reflection;

namespace OaSdkTypeSpec;

/**
 * Declares a Model as an Actor Input contract for XState / Behavior runtimes.
 * Emits internal x-oa-sdk-behavior-actor-input.
 */
extern dec actorInput(target: Model);

/**
 * Declares a Model as a Machine Context contract for XState / Behavior runtimes.
 * Emits internal x-oa-sdk-behavior-machine-context.
 */
extern dec machineContext(target: Model);

/**
 * Declares a Model as an Event Payload contract for XState / Behavior runtimes.
 * Emits internal x-oa-sdk-behavior-event-payload.
 */
extern dec eventPayload(target: Model, eventType?: valueof string);

/**
 * Binds a Model to an external canonical Behavior IR artifact ID.
 * Emits internal x-oa-sdk-behavior-ref.
 */
extern dec behaviorRef(target: Model, behaviorId: valueof string);
