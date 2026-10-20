import "../dist/protobuf.js";

using TypeSpec.Reflection;

namespace OaSdkTypeSpec;

/**
 * Declares a Model for Protocol Buffers wire serialization.
 * Emits internal x-oa-sdk-protobuf extension.
 * On an Interface it reports invalid-protobuf-rule: put @protobuf on each message model and
 * name the service with @rpc(#{ serviceName }) on the interface.
 */
extern dec protobuf(
  target: Model | Interface,
  options?: valueof unknown,
);

/**
 * Declares a field tag number and optional scalar wire type for Protobuf serialization.
 * Emits internal x-oa-sdk-protobuf-field extension.
 * Field numbers must be unique within a model and in 1..536870911 (19000-19999 reserved).
 */
extern dec field(
  target: ModelProperty,
  index: valueof integer,
  options?: valueof unknown,
);

/**
 * Declares an Operation, or every operation of an Interface, as an RPC service method.
 * Emits internal x-oa-sdk-rpc extension on each operation.
 * On an Interface, serviceName and streaming apply to all of its operations and an operation's
 * own @rpc values win; methodName names a single operation and is rejected on an Interface.
 */
extern dec rpc(
  target: Operation | Interface,
  options?: valueof unknown,
);

/**
 * Declares explicit wire format for communication compression.
 * Emits internal x-oa-sdk-wire-format extension.
 * On an Interface it sets the format of every operation that does not declare its own.
 */
extern dec wireFormat(
  target: Model | Operation | Interface,
  format: valueof string,
);
