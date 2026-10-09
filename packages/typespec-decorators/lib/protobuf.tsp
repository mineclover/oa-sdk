import "../dist/protobuf.js";

using TypeSpec.Reflection;

namespace OaSdkTypeSpec;

/**
 * Declares a Model or Interface for Protocol Buffers wire serialization.
 * Emits internal x-oa-sdk-protobuf extension.
 */
extern dec protobuf(
  target: Model | Interface,
  options?: valueof unknown,
);

/**
 * Declares a field tag number and optional scalar wire type for Protobuf serialization.
 * Emits internal x-oa-sdk-protobuf-field extension.
 */
extern dec field(
  target: ModelProperty,
  index: valueof integer,
  options?: valueof unknown,
);

/**
 * Declares an Operation or Interface as an RPC service method.
 * Emits internal x-oa-sdk-rpc extension.
 */
extern dec rpc(
  target: Operation | Interface,
  options?: valueof unknown,
);

/**
 * Declares explicit wire format for communication compression.
 * Emits internal x-oa-sdk-wire-format extension.
 */
extern dec wireFormat(
  target: Model | Operation | Interface,
  format: valueof string,
);
