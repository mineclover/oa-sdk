import "../dist/chunk-stream.js";

using TypeSpec.Reflection;

namespace OaSdkTypeSpec;

/**
 * Declares Chunk Stream transmission parameters, presets, and memory residency policies
 * on a Model, Operation, or Interface.
 * Emits internal x-oa-sdk-chunk-stream extension.
 */
extern dec chunkStream(
  target: Model | Operation | Interface,
  options?: valueof unknown,
);
