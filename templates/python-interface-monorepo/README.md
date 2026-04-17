# Python Interface Contract Workspace

uv workspace template for Python API contract management with Pydantic models,
OpenAPI artifacts, and CI gates.

The goal is not only to generate OpenAPI. The goal is to make API contracts easy
to review, change, and keep aligned with the running Python API.

## Architecture

The intended contract flow is:

```txt
Pydantic DTOs
  -> ContractRegistry / ContractSpec
  -> deterministic OpenAPI artifact
  -> drift / diff gates
  -> FastAPI runtime and generated clients
```

Responsibilities:

- Pydantic DTOs define request and response shapes.
- `ContractRegistry` is the intended authoring surface for models, endpoints,
  security schemes, reusable responses, examples, and targets.
- `ContractSpec` is the serializable contract document used by the CLI.
- OpenAPI JSON is a generated artifact. Do not treat it as the source of truth.
- Diff gates classify contract changes before merge.
- Drift gates compare the managed contract against the FastAPI runtime OpenAPI.

This boundary keeps implementation code, contract review, and generated artifacts
separate enough to manage independently.

## Workspace Layout

| Path | Purpose |
|---|---|
| `packages/interface-contracts` | Core contract models, Pydantic schema extraction, OpenAPI emit, and breaking diff primitives. |
| `packages/interface-cli` | `oa-contract` CLI for validation, OpenAPI artifact generation, and compatibility checks. |
| `apps/example-api` | FastAPI example that shares Pydantic DTOs and contract definitions with the tooling. |

Future adapters should be added as workspace members under `packages/*`, for
example `packages/interface-fastapi`.

## Management Model

Recommended project layout for a real API:

```txt
apps/example-api/src/example_api/
  models.py       # Pydantic DTOs
  contracts.py    # ContractRegistry or ContractSpec
  main.py         # FastAPI app and route handlers

contracts/example-api/
  contract.json
  openapi.json
  compatibility-report.json
```

Rules:

- Keep DTOs in Pydantic models.
- Register schemas and endpoints in the contract layer.
- Keep route handlers in the app layer.
- Generate `openapi.json` from the contract layer.
- Review `contract.json` changes, not only generated OpenAPI changes.
- Fail CI when generated artifacts are stale, breaking changes are unapproved,
  or FastAPI runtime drift is detected.

## Commands

Install and run workspace checks:

```bash
uv sync
uv run pytest
uv run ruff check .
uv run mypy
```

Run the CLI:

```bash
uv run --package oa-interface-cli oa-contract --help
```

Validate a serialized contract:

```bash
uv run --package oa-interface-cli oa-contract validate contracts/example-api/contract.json
```

Emit deterministic OpenAPI:

```bash
uv run --package oa-interface-cli oa-contract emit-openapi \
  contracts/example-api/contract.json \
  --output contracts/example-api/openapi.json
```

Review breaking changes:

```bash
uv run --package oa-interface-cli oa-contract diff \
  contracts/base.contract.json \
  contracts/head.contract.json \
  --fail-on-breaking
```

Run the example FastAPI app:

```bash
uv run --package example-api python -m example_api.main
```

Target drift command for the FastAPI adapter lane:

```bash
uv run --package oa-interface-cli oa-contract drift \
  --app example_api.main:app \
  --contract example_api.contracts:registry
```

The `drift` command is part of the intended management surface. If the adapter
package has not landed yet, keep this command in acceptance criteria and do not
claim runtime drift is enforced in CI.

## Adding Models And Endpoints

1. Add or update the Pydantic DTO.
2. Register the model schema in `ContractRegistry` or `ContractSpec.schemas`.
3. Register reusable security schemes, error responses, and examples when the
   endpoint needs them.
4. Register the endpoint with `registry.endpoint(...)`, or use
   `@registry.route(...)` beside the framework route decorator.
5. Add or update the FastAPI route with matching request and response models.
6. Emit OpenAPI and inspect the artifact diff.
7. Run validation, diff, drift, and workspace checks.

In the example app, DTOs live in `models.py`, the managed contract lives in
`contracts.py`, and FastAPI routes live in `main.py`. Keep that separation in
real services so implementation changes and contract changes can be reviewed
independently.

```python
@registry.route(
    method="post",
    path="/users",
    operation_id="create_user",
    request_model="CreateUser",
    response_model="User",
)
@app.post("/users", response_model=User, operation_id="create_user")
def create_user(body: CreateUser) -> User:
    ...
```

## Breaking Change Review

Treat these as breaking until proven otherwise:

- endpoint removed
- method or path changed
- `operation_id` changed
- request model changed
- response model changed
- required request field added
- response field removed
- response field type narrowed
- status code removed
- security requirement strengthened

Non-breaking changes usually include:

- endpoint added
- optional request field added
- optional response field added
- summary or description changed
- tag added
- additional success status documented

Every pull request that changes API contracts should include:

- the contract diff output
- whether `--fail-on-breaking` passed
- the generated OpenAPI artifact diff
- the FastAPI drift result once the adapter is available

## FastAPI Drift Handling

FastAPI can generate OpenAPI from route decorators and Pydantic models. This is
useful, but it should not silently replace managed contracts.

The drift gate should compare:

- route exists in FastAPI and contract
- method and path match
- `operationId` matches
- request body schema matches
- response schema and documented status codes match
- tags and summaries are intentionally aligned
- security requirements match

If FastAPI exposes a route not declared in the contract, either add it to the
contract or explicitly exclude it from public contract checks. If the contract
declares a route not implemented by FastAPI, block the change until the handler
or contract is corrected.

## Acceptance Criteria

Team implementation should be considered complete when:

- `ContractRegistry` exists as the preferred authoring API and can emit a
  deterministic `ContractSpec`.
- Duplicate schema names, duplicate endpoints, duplicate operation IDs, missing
  model references, and invalid path parameter references are rejected.
- `oa-contract validate` accepts valid contract JSON and fails invalid contracts.
- `oa-contract emit-openapi` produces stable OpenAPI 3.1 JSON with sorted output.
- `oa-contract diff --fail-on-breaking` exits non-zero for breaking changes.
- `oa-contract drift --app module:app --contract module:registry` compares
  FastAPI runtime OpenAPI against the managed contract and exits non-zero on
  drift.
- `uv run pytest`, `uv run ruff check .`, and `uv run mypy` pass from the
  workspace root.
- README examples match the implemented CLI behavior.

## uv Workspace Notes

This template follows uv workspace conventions: every workspace member has its
own `pyproject.toml`, and dependencies between workspace members use
`[tool.uv.sources]` with `workspace = true`.
