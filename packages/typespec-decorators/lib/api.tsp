import "../dist/api.js";
import "./contracts.tsp";

using TypeSpec.Reflection;

namespace OaSdkTypeSpec;

/**
 * Refer to a reusable OpenAPI response component from an operation response.
 * The helper owns only the v5 component-reference payload; it cannot emit an
 * arbitrary OA SDK extension.
 */
extern dec oaUseResponseComponent(
  target: Operation,
  statusCode: valueof string,
  componentName: valueof string,
);
