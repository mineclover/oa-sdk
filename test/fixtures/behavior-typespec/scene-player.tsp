namespace ScenePlayerBehavior;

@doc("Actor input contract for Scene Player actor")
model ScenePlayerInput {
  @minLength(1)
  sceneId: string;
  autoplay?: boolean;
}

@doc("Runtime context for Scene Player")
model PlayerContext {
  @minLength(1)
  sceneId: string;
  currentTime: float64;
  playing: boolean;
  selectedObjectId?: string;
}

// ----------------------------------------------------
// Events (Discriminated Message Vocabulary)
// ----------------------------------------------------

@doc("PLAY event triggers playback start")
model PlayEvent {
  type: "PLAY";
}

@doc("PAUSE event pauses playback")
model PauseEvent {
  type: "PAUSE";
}

@doc("SEEK event jumps to target timestamp")
model SeekEvent {
  type: "SEEK";
  @minValue(0)
  time: float64;
}

@doc("SELECT_OBJECT event selects a scene graphic element")
model SelectObjectEvent {
  type: "SELECT_OBJECT";
  @minLength(1)
  objectId: string;
}

@doc("Discriminated union of all player events")
union PlayerEvent {
  play: PlayEvent,
  pause: PauseEvent,
  seek: SeekEvent,
  selectObject: SelectObjectEvent,
}

// ----------------------------------------------------
// State Contracts (State-Level Input, Refinement & Output)
// ----------------------------------------------------

@doc("Input required when transitioning into Playing state")
model PlayingStateInput {
  @minLength(1)
  animationId: string;
  @minValue(0)
  startTime: float64;
}

@doc("Context refinement guaranteed while in Playing state")
model PlayingContextRefinement {
  playing: true;
}

@doc("Output emitted when Playing state exits or completes")
model PlayingStateOutput {
  @minValue(0)
  completedAt: float64;
}

// ----------------------------------------------------
// Action Params
// ----------------------------------------------------

@doc("Parameters passed to playAnimation effect action")
model PlayAnimationParams {
  @minLength(1)
  animationId: string;
  @minValue(0.1)
  @maxValue(10.0)
  speed: float64;
}
