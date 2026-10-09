import "@typespec/http";
import "@typespec/openapi";
import "./scene-player.tsp";

using TypeSpec.Http;
using TypeSpec.OpenAPI;

@service(#{
  title: "Scene Player Behavior Contract Specification",
})
@info(#{
  version: "1.0.0",
})
namespace ScenePlayerBehavior;

@route("/behavior/scene-player")
interface ScenePlayerOperations {
  @get
  @route("/context")
  getContext(): PlayerContext;

  @post
  @route("/events")
  sendEvent(@body event: PlayerEvent): void;

  @post
  @route("/state/playing")
  enterPlaying(@body input: PlayingStateInput): PlayingStateOutput;
}
