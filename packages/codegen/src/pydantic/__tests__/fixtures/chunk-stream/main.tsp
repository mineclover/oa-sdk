// Golden fixture source: discriminator + extends polymorphism and @pattern scalars from
// packages/schemas/typespec/chunk-stream.tsp, compiled into its own service so every model is emitted.
// Regenerate chunk-stream.openapi.yaml (from the repository root):
//   node_modules/.bin/tsp compile packages/codegen/src/pydantic/__tests__/fixtures/chunk-stream/main.tsp
// then copy out/openapi.yaml (removed afterwards) to chunk-stream.openapi.yaml.
import "../../../../../../schemas/typespec/chunk-stream.tsp";

@service(#{ title: "Chunk Stream Fixture" })
namespace OaSdkApi.ChunkStream;
