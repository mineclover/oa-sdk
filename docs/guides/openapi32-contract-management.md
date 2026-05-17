# OpenAPI 3.2 Contract Management

oa-sdk manages the public API contract that connects domain intent, normalized
information structure, implementation, tests, and runtime governance.

The first managed contract format is OpenAPI 3.2. A document can be parsed as a
generic OpenAPI 3.x input, but it is not an oa-sdk managed contract until it
passes the OpenAPI 3.2 gate.

## Layer Roles

- Data model: organize fields by domain intent, not by incidental storage shape.
- Information structure: normalize names, references, schemas, operations, and
  shared components so one meaning has one stable representation.
- API contract: provide the same external capability through stable request,
  response, error, and operation semantics even when internals change.
- Infrastructure: reduce data-flow complexity by making contract extraction,
  normalization, validation, review, and drift checks repeatable.
- oa-sdk: manage the exposed API contract and keep its record deliverable across
  docs, code generation, tests, review, and runtime comparison.

## Baseline Gate

Use the strict OpenAPI 3.2 gate for artifacts that are published, reviewed, or
used as the source of generated clients/routers:

```bash
oa-gen validate --spec contracts/openapi.yaml --require-32
```

Use the compatible mode only for intake or migration work:

```bash
oa-gen validate --spec contracts/openapi.raw.yaml
oa-gen upgrade --spec contracts/openapi.raw.yaml --output contracts/openapi.upgraded.yaml
oa-gen validate --spec contracts/openapi.upgraded.yaml --require-32
```

The strict gate fails OpenAPI 3.0/3.1 documents instead of treating them as
informational warnings. That keeps managed contracts unambiguous: once a
contract enters oa-sdk governance, downstream tools can assume OpenAPI 3.2
semantics.
