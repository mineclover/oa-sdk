/**
 * TypeScript Data Contracts and Type Guards generated from Scene Player TypeSpec SSOT
 */

export interface ScenePlayerInput {
  sceneId: string
  autoplay?: boolean
}

export interface PlayerContext {
  sceneId: string
  currentTime: number
  playing: boolean
  selectedObjectId?: string
}

export interface PlayEvent {
  type: 'PLAY'
}

export interface PauseEvent {
  type: 'PAUSE'
}

export interface SeekEvent {
  type: 'SEEK'
  time: number
}

export interface SelectObjectEvent {
  type: 'SELECT_OBJECT'
  objectId: string
}

export type PlayerEvent = PlayEvent | PauseEvent | SeekEvent | SelectObjectEvent

export interface PlayingStateInput {
  animationId: string
  startTime: number
}

export interface PlayingContextRefinement {
  playing: true
}

export interface PlayingStateOutput {
  completedAt: number
}

export interface PlayAnimationParams {
  animationId: string
  speed: number
}

// ----------------------------------------------------------------------------
// Type Guards
// ----------------------------------------------------------------------------

export function isPlayEvent(event: PlayerEvent): event is PlayEvent {
  return event.type === 'PLAY'
}

export function isPauseEvent(event: PlayerEvent): event is PauseEvent {
  return event.type === 'PAUSE'
}

export function isSeekEvent(event: PlayerEvent): event is SeekEvent {
  return event.type === 'SEEK' && typeof (event as SeekEvent).time === 'number'
}

export function isSelectObjectEvent(event: PlayerEvent): event is SelectObjectEvent {
  return event.type === 'SELECT_OBJECT' && typeof (event as SelectObjectEvent).objectId === 'string'
}

export function isPlayerEvent(val: unknown): val is PlayerEvent {
  if (!val || typeof val !== 'object') return false
  const type = (val as { type?: unknown }).type
  return (
    type === 'PLAY' ||
    type === 'PAUSE' ||
    type === 'SEEK' ||
    type === 'SELECT_OBJECT'
  )
}
