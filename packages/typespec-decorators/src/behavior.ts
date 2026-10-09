import type { DecoratorContext, Model } from '@typespec/compiler'
import { setExtension } from '@typespec/openapi'
import { namespace } from './constants.js'

export { namespace }
export const BEHAVIOR_ACTOR_INPUT_EXTENSION = 'x-oa-sdk-behavior-actor-input'
export const BEHAVIOR_MACHINE_CONTEXT_EXTENSION = 'x-oa-sdk-behavior-machine-context'
export const BEHAVIOR_EVENT_PAYLOAD_EXTENSION = 'x-oa-sdk-behavior-event-payload'
export const BEHAVIOR_REF_EXTENSION = 'x-oa-sdk-behavior-ref'

/**
 * Declares a Model as an Actor Input contract for XState / Behavior runtimes.
 * Emits internal `x-oa-sdk-behavior-actor-input: true`.
 */
export function $actorInput(
  context: DecoratorContext,
  target: Model,
): void {
  setExtension(context.program, target, BEHAVIOR_ACTOR_INPUT_EXTENSION, true)
}

/**
 * Declares a Model as a Machine Context contract for XState / Behavior runtimes.
 * Emits internal `x-oa-sdk-behavior-machine-context: true`.
 */
export function $machineContext(
  context: DecoratorContext,
  target: Model,
): void {
  setExtension(context.program, target, BEHAVIOR_MACHINE_CONTEXT_EXTENSION, true)
}

/**
 * Declares a Model as an Event Payload contract for XState / Behavior runtimes.
 * Emits internal `x-oa-sdk-behavior-event-payload: { eventType }`.
 */
export function $eventPayload(
  context: DecoratorContext,
  target: Model,
  eventType?: string,
): void {
  const payload = {
    eventType: eventType ?? target.name,
  }
  setExtension(context.program, target, BEHAVIOR_EVENT_PAYLOAD_EXTENSION, payload)
}

/**
 * Binds a Model to an external canonical Behavior IR artifact ID.
 * Emits internal `x-oa-sdk-behavior-ref: { behaviorId }`.
 */
export function $behaviorRef(
  context: DecoratorContext,
  target: Model,
  behaviorId: string,
): void {
  setExtension(context.program, target, BEHAVIOR_REF_EXTENSION, { behaviorId })
}
