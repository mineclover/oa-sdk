/**
 * XState v6 Machine Adapter with Standard Schema v1 Runtime Lowering
 * Validates root events/inputs and state-level schemas using TypeSpec-projected schemas.
 */

import type { StandardSchemaV1, StandardResult } from './standard-schema-adapter.js'
import type {
  ScenePlayerInput,
  PlayerContext,
  PlayerEvent,
  PlayingStateInput,
  PlayingStateOutput,
} from '../contracts/types.js'

export interface V6MachineSchemas {
  input: StandardSchemaV1<unknown, ScenePlayerInput>
  context: StandardSchemaV1<unknown, PlayerContext>
  events: StandardSchemaV1<unknown, PlayerEvent>
  playingStateInput: StandardSchemaV1<unknown, PlayingStateInput>
  playingStateOutput: StandardSchemaV1<unknown, PlayingStateOutput>
}

export interface V6MachineSnapshot {
  value: 'idle' | 'playing' | 'paused'
  context: PlayerContext
}

export type V6SendResult =
  | {
      status: 'transitioned'
      nextState: V6MachineSnapshot
      stateOutput?: PlayingStateOutput
    }
  | {
      status: 'rejected'
      issues: Array<{ message: string }>
    }

export function createScenePlayerV6Machine(
  input: unknown,
  schemas: V6MachineSchemas,
) {
  // 1. Root input validation via Standard Schema v1
  const inputValidation = schemas.input['~standard'].validate(input)
  if (inputValidation.issues) {
    throw new Error(`Invalid ActorInput: ${inputValidation.issues.map((i) => i.message).join(', ')}`)
  }

  const validProps = inputValidation.value
  let currentState: 'idle' | 'playing' | 'paused' = validProps.autoplay ? 'playing' : 'idle'
  let currentContext: PlayerContext = {
    sceneId: validProps.sceneId,
    currentTime: 0,
    playing: !!validProps.autoplay,
  }

  function getSnapshot(): V6MachineSnapshot {
    return {
      value: currentState,
      context: { ...currentContext },
    }
  }

  function send(rawEvent: unknown, stateInput?: unknown): V6SendResult {
    // 2. Event validation via Standard Schema v1
    const eventValidation = schemas.events['~standard'].validate(rawEvent)
    if (eventValidation.issues) {
      return {
        status: 'rejected',
        issues: [...eventValidation.issues],
      }
    }

    const event = eventValidation.value
    let stateOutput: PlayingStateOutput | undefined

    switch (currentState) {
      case 'idle':
        if (event.type === 'PLAY') {
          // 3. State-level input validation when entering playing
          if (stateInput !== undefined) {
            const stateInputVal = schemas.playingStateInput['~standard'].validate(stateInput)
            if (stateInputVal.issues) {
              return {
                status: 'rejected',
                issues: [...stateInputVal.issues],
              }
            }
          }
          currentState = 'playing'
          currentContext.playing = true
        } else if (event.type === 'SEEK') {
          currentContext.currentTime = event.time
        } else if (event.type === 'SELECT_OBJECT') {
          currentContext.selectedObjectId = event.objectId
        }
        break

      case 'playing':
        if (event.type === 'PAUSE') {
          // 4. State-level output validation when exiting playing
          stateOutput = { completedAt: currentContext.currentTime }
          const stateOutputVal = schemas.playingStateOutput['~standard'].validate(stateOutput)
          if (stateOutputVal.issues) {
            return {
              status: 'rejected',
              issues: [...stateOutputVal.issues],
            }
          }
          currentState = 'paused'
          currentContext.playing = false
        } else if (event.type === 'SEEK') {
          currentContext.currentTime = event.time
        } else if (event.type === 'SELECT_OBJECT') {
          currentContext.selectedObjectId = event.objectId
        }
        break

      case 'paused':
        if (event.type === 'PLAY') {
          if (stateInput !== undefined) {
            const stateInputVal = schemas.playingStateInput['~standard'].validate(stateInput)
            if (stateInputVal.issues) {
              return {
                status: 'rejected',
                issues: [...stateInputVal.issues],
              }
            }
          }
          currentState = 'playing'
          currentContext.playing = true
        } else if (event.type === 'SEEK') {
          currentContext.currentTime = event.time
        } else if (event.type === 'SELECT_OBJECT') {
          currentContext.selectedObjectId = event.objectId
        }
        break
    }

    // 5. Context invariant validation after transition
    const contextValidation = schemas.context['~standard'].validate(currentContext)
    if (contextValidation.issues) {
      return {
        status: 'rejected',
        issues: [...contextValidation.issues],
      }
    }

    return {
      status: 'transitioned',
      nextState: getSnapshot(),
      stateOutput,
    }
  }

  return {
    getSnapshot,
    send,
  }
}
