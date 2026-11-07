// Golden fixture source: a named string enum (for `enumStyle`) and the scalar encodings that
// `@typespec/openapi3` writes for `@encode` (`pydantic/encoding-degraded` cases).
// Regenerate scalars.openapi.yaml (from the repository root):
//   node_modules/.bin/tsp compile packages/codegen/src/pydantic/__tests__/fixtures/scalars/main.tsp
// then copy out/openapi.yaml (removed afterwards) to scalars.openapi.yaml.
@service(#{ title: "Scalars Fixture" })
namespace OaSdkApi.Scalars;

enum Status {
  Active: "active",
  PendingReview: "pending-review",
}

model Sample {
  status: Status;
  createdAt: utcDateTime;
  @encode(DateTimeKnownEncoding.unixTimestamp, int32)
  createdAtUnix: utcDateTime;
  @encode(DateTimeKnownEncoding.rfc7231)
  modifiedAt: utcDateTime;
  ttl: duration;
  @encode("seconds", int32)
  ttlSeconds: duration;
  payload: bytes;
  @encode("base64url")
  token: bytes;
}
