/**
 * XState v5 Machine Adapter for Scene Player Behavior Contract
 * Uses TypeSpec-generated static TypeScript types (Approach A & D).
 */

import type {
  ScenePlayerInput,
  PlayerContext,
  PlayerEvent,
  PlayingStateInput,
  PlayingStateOutput,
  PlayAnimationParams,
} from '../contracts/types.js'

export interface V5MachineSnapshot {
  value: 'idle' | 'playing' | 'paused'
  context: PlayerContext
}

export interface V5TransitionResult {
  nextState: V5MachineSnapshot
  actionsTriggered: Array<{ name: string; params?: unknown }>
}

/**
 * Creates a Scene Player state machine following XState v5 contract conventions.
 */
export function createScenePlayerV5Machine(input: ScenePlayerInput) {
  let currentState: 'idle' | 'playing' | 'paused' = input.autoplay ? 'playing' : 'idle'
  let currentContext: PlayerContext = {
    sceneId: input.sceneId,
    currentTime: 0,
    playing: !!input.autoplay,
  }

  function getSnapshot(): V5MachineSnapshot {
    return {
      value: currentState,
      context: { ...currentContext },
    }
  }

  function send(event: PlayerEvent): V5TransitionResult {
    const actions: Array<{ name: string; params?: unknown }> = []

    switch (currentState) {
      case 'idle':
        if (event.type === 'PLAY') {
          currentState = 'playing'
          currentContext.playing = true
          actions.push({
            name: 'playAnimation',
            params: { animationId: 'scene-intro', speed: 1.0 } satisfies PlayAnimationParams,
          })
        } else if (event.type === 'SEEK') {
          currentContext.currentTime = event.time
          actions.push({ name: 'updateClock', params: { time: event.time } })
        } else if (event.type === 'SELECT_OBJECT') {
          currentContext.selectedObjectId = event.objectId
        }
        break

      case 'playing':
        if (event.type === 'PAUSE') {
          currentState = 'paused'
          currentContext.playing = false
          actions.push({ name: 'pauseAnimation' })
        } else if (event.type === 'SEEK') {
          currentContext.currentTime = event.time
          actions.push({ name: 'updateClock', params: { time: event.time } })
        } else if (event.type === 'SELECT_OBJECT') {
          currentContext.selectedObjectId = event.objectId
        }
        break

      case 'paused':
        if (event.type === 'PLAY') {
          currentState = 'playing'
          currentContext.playing = true
          actions.push({
            name: 'playAnimation',
            params: { animationId: 'scene-resume', speed: 1.0 } satisfies PlayAnimationParams,
          })
        } else if (event.type === 'SEEK') {
          currentContext.currentTime = event.time
          actions.push({ name: 'updateClock', params: { time: event.time } })
        } else if (event.type === 'SELECT_OBJECT') {
          currentContext.selectedObjectId = event.objectId
        }
        break
    }

    return {
      nextState: getSnapshot(),
      actionsTriggered: actions,
    }
  }

  return {
    getSnapshot,
    send,
  }
}
