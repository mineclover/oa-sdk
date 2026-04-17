import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Protocol, cast, runtime_checkable

from fastapi import FastAPI
from oa_interface_contracts import (
    ContractSpec,
    RuntimeOpenApiAdapter,
    emit_openapi,
    load_module_attr,
)

from .adapter import FASTAPI_ADAPTER

OpenApiDocument = dict[str, Any]

_HTTP_METHODS = frozenset({"get", "post", "put", "patch", "delete", "head", "options", "trace"})
_IGNORED_SCHEMA_KEYS = frozenset(
    {"title", "$defs", "x-oa-audience", "x-oa-targets", "x-internal-only", "x-internal"}
)
_UNORDERED_SCHEMA_LIST_KEYS = frozenset({"allOf", "anyOf", "enum", "oneOf", "required"})


@runtime_checkable
class OpenApiEmitter(Protocol):
    def emit_openapi(self) -> Mapping[str, Any]: ...


@runtime_checkable
class ContractFactory(Protocol):
    def to_contract(self) -> ContractSpec: ...


@dataclass(frozen=True)
class DriftIssue:
    code: str
    location: str
    detail: str


def detect_drift(
    app_ref: str,
    contract_ref: str,
    *,
    adapter: RuntimeOpenApiAdapter = FASTAPI_ADAPTER,
) -> list[DriftIssue]:
    runtime_openapi = load_runtime_openapi(app_ref, adapter=adapter)
    managed_openapi = load_contract_openapi(contract_ref)
    return compare_openapi(runtime_openapi, managed_openapi)


def load_runtime_openapi(
    reference: str,
    *,
    adapter: RuntimeOpenApiAdapter = FASTAPI_ADAPTER,
) -> OpenApiDocument:
    runtime = load_module_attr(reference)
    return dict(adapter.extract_openapi(runtime))


def load_fastapi_app(reference: str) -> FastAPI:
    value = load_module_attr(reference)
    if not isinstance(value, FastAPI):
        raise TypeError(f"{reference} did not resolve to a FastAPI app")
    return value


def load_contract_openapi(reference: str) -> OpenApiDocument:
    value = load_module_attr(reference)
    return _contract_to_openapi(value)


def compare_openapi(runtime: Mapping[str, Any], managed: Mapping[str, Any]) -> list[DriftIssue]:
    issues: list[DriftIssue] = []
    runtime_paths = _paths(runtime)
    managed_paths = _paths(managed)

    for method, path in sorted(set(managed_paths) - set(runtime_paths)):
        issues.append(
            DriftIssue(
                code="route-missing-in-runtime",
                location=_label(method, path),
                detail="Managed contract route is missing from FastAPI OpenAPI.",
            )
        )

    for method, path in sorted(set(runtime_paths) - set(managed_paths)):
        issues.append(
            DriftIssue(
                code="route-missing-in-contract",
                location=_label(method, path),
                detail="FastAPI route is not declared in the managed contract.",
            )
        )

    for method, path in sorted(set(runtime_paths) & set(managed_paths)):
        runtime_operation = runtime_paths[(method, path)]
        managed_operation = managed_paths[(method, path)]
        location = _label(method, path)
        issues.extend(
            _compare_operation(location, runtime_operation, managed_operation, runtime, managed)
        )

    return issues


def _contract_to_openapi(value: object) -> OpenApiDocument:
    if isinstance(value, ContractSpec):
        return emit_openapi(value)
    if isinstance(value, ContractFactory):
        return emit_openapi(value.to_contract())
    if isinstance(value, OpenApiEmitter):
        return dict(value.emit_openapi())
    if isinstance(value, Mapping):
        return dict(value)
    raise TypeError(
        "contract reference must resolve to ContractSpec, OpenAPI mapping, "
        "or an object exposing to_contract() or emit_openapi()"
    )


def _paths(document: Mapping[str, Any]) -> dict[tuple[str, str], Mapping[str, Any]]:
    paths = document.get("paths")
    if not isinstance(paths, Mapping):
        return {}

    operations: dict[tuple[str, str], Mapping[str, Any]] = {}
    for path, path_item in paths.items():
        if not isinstance(path, str) or not isinstance(path_item, Mapping):
            continue
        for method, operation in path_item.items():
            if not isinstance(method, str) or not isinstance(operation, Mapping):
                continue
            if method.lower() not in _HTTP_METHODS:
                continue
            operations[(method.lower(), path)] = operation
    return operations


def _compare_operation(
    location: str,
    runtime: Mapping[str, Any],
    managed: Mapping[str, Any],
    runtime_document: Mapping[str, Any],
    managed_document: Mapping[str, Any],
) -> list[DriftIssue]:
    issues: list[DriftIssue] = []

    if runtime.get("operationId") != managed.get("operationId"):
        issues.append(
            DriftIssue(
                code="operation-id-drift",
                location=location,
                detail=(
                    f"Runtime operationId {runtime.get('operationId')!r} does not match "
                    f"managed operationId {managed.get('operationId')!r}."
                ),
            )
        )

    runtime_request_schema = _request_schema(runtime, runtime_document)
    managed_request_schema = _request_schema(managed, managed_document)
    if not _schemas_match(
        runtime_request_schema,
        managed_request_schema,
        runtime_document,
        managed_document,
    ):
        issues.append(
            DriftIssue(
                code="request-schema-drift",
                location=location,
                detail="Runtime request body schema does not match the managed contract.",
            )
        )

    runtime_security = _security_requirements(runtime, runtime_document)
    managed_security = _security_requirements(managed, managed_document)
    if runtime_security != managed_security:
        issues.append(
            DriftIssue(
                code="security-drift",
                location=location,
                detail=(
                    f"Runtime security {runtime_security!r} does not match "
                    f"managed security {managed_security!r}."
                ),
            )
        )

    issues.extend(
        _compare_responses(location, runtime, managed, runtime_document, managed_document)
    )
    return issues


def _compare_responses(
    location: str,
    runtime: Mapping[str, Any],
    managed: Mapping[str, Any],
    runtime_document: Mapping[str, Any],
    managed_document: Mapping[str, Any],
) -> list[DriftIssue]:
    issues: list[DriftIssue] = []
    runtime_responses = _responses(runtime)
    managed_responses = _responses(managed)

    for status, managed_response in sorted(managed_responses.items()):
        runtime_response = runtime_responses.get(status)
        if runtime_response is None:
            issues.append(
                DriftIssue(
                    code="response-missing-in-runtime",
                    location=f"{location} {status}",
                    detail="Managed response status is missing from FastAPI OpenAPI.",
                )
            )
            continue

        if not _schemas_match(
            _json_schema(runtime_response, runtime_document),
            _json_schema(managed_response, managed_document),
            runtime_document,
            managed_document,
        ):
            issues.append(
                DriftIssue(
                    code="response-schema-drift",
                    location=f"{location} {status}",
                    detail="Runtime response schema does not match the managed contract.",
                )
            )

    for status, runtime_response in sorted(runtime_responses.items()):
        if status in managed_responses:
            continue
        if _is_framework_response(status, runtime_response, runtime_document):
            continue
        issues.append(
            DriftIssue(
                code="response-missing-in-contract",
                location=f"{location} {status}",
                detail="FastAPI response status is not declared in the managed contract.",
            )
        )

    return issues


def _request_schema(operation: Mapping[str, Any], document: Mapping[str, Any]) -> object:
    request_body = _resolve_mapping_ref(operation.get("requestBody"), document)
    if not isinstance(request_body, Mapping):
        return None
    return _json_schema(request_body, document)


def _responses(operation: Mapping[str, Any]) -> dict[str, Mapping[str, Any]]:
    responses = operation.get("responses")
    if not isinstance(responses, Mapping):
        return {}
    return {
        status: response
        for status, response in responses.items()
        if isinstance(status, str) and isinstance(response, Mapping)
    }


def _json_schema(container: Mapping[str, Any], document: Mapping[str, Any]) -> object:
    resolved_container = _resolve_mapping_ref(container, document)
    if not isinstance(resolved_container, Mapping):
        return None
    content = resolved_container.get("content")
    if not isinstance(content, Mapping):
        return None
    media_type = content.get("application/json")
    if not isinstance(media_type, Mapping):
        return None
    return media_type.get("schema")


def _schemas_match(
    runtime_schema: object,
    managed_schema: object,
    runtime_document: Mapping[str, Any],
    managed_document: Mapping[str, Any],
) -> bool:
    return _normalize_schema(runtime_schema, runtime_document) == _normalize_schema(
        managed_schema,
        managed_document,
    )


def _normalize_schema(
    schema: object,
    document: Mapping[str, Any],
    root: object | None = None,
    seen_refs: frozenset[str] = frozenset(),
    parent_key: str | None = None,
) -> object:
    if root is None:
        root = schema

    if isinstance(schema, Mapping):
        ref = schema.get("$ref")
        sibling_items = [(key, value) for key, value in schema.items() if key != "$ref"]
        if isinstance(ref, str) and ref not in seen_refs:
            target = _resolve_schema_ref(ref, document, root)
            if target is not None:
                target_root = target if _ref_starts_new_schema_root(ref) else root
                normalized = _normalize_schema(
                    target,
                    document,
                    target_root,
                    seen_refs | {ref},
                    parent_key,
                )
                if not sibling_items:
                    return normalized
                if isinstance(normalized, Mapping):
                    merged = dict(normalized)
                    for key, value in sibling_items:
                        if isinstance(key, str) and key not in _IGNORED_SCHEMA_KEYS:
                            merged[key] = _normalize_schema(
                                value,
                                document,
                                target_root,
                                seen_refs,
                                key,
                            )
                    return _stable_mapping(merged)

        normalized_items = {
            str(key): _normalize_schema(value, document, root, seen_refs, str(key))
            for key, value in schema.items()
            if isinstance(key, str) and key not in _IGNORED_SCHEMA_KEYS
        }
        return _stable_mapping(normalized_items)

    if isinstance(schema, Sequence) and not isinstance(schema, (str, bytes, bytearray)):
        normalized_values = [
            _normalize_schema(value, document, root, seen_refs, parent_key) for value in schema
        ]
        if parent_key in _UNORDERED_SCHEMA_LIST_KEYS:
            return sorted(normalized_values, key=_canonical_json)
        return normalized_values

    return schema


def _stable_mapping(value: Mapping[str, Any]) -> dict[str, Any]:
    return {key: value[key] for key in sorted(value)}


def _resolve_schema_ref(
    ref: str,
    document: Mapping[str, Any],
    root: object,
) -> object | None:
    if not ref.startswith("#/"):
        return None
    if ref.startswith("#/$defs/"):
        return _resolve_json_pointer(root, ref[1:])
    return _resolve_json_pointer(document, ref[1:])


def _resolve_mapping_ref(value: object, document: Mapping[str, Any]) -> Mapping[str, Any] | None:
    if not isinstance(value, Mapping):
        return None
    ref = value.get("$ref")
    if not isinstance(ref, str):
        return cast(Mapping[str, Any], value)
    resolved = _resolve_json_pointer(document, ref[1:]) if ref.startswith("#/") else None
    if isinstance(resolved, Mapping):
        return cast(Mapping[str, Any], resolved)
    return cast(Mapping[str, Any], value)


def _resolve_json_pointer(document: object, pointer: str) -> object | None:
    current = document
    for raw_part in pointer.strip("/").split("/"):
        part = raw_part.replace("~1", "/").replace("~0", "~")
        if not isinstance(current, Mapping):
            return None
        current = current.get(part)
    return current


def _ref_starts_new_schema_root(ref: str) -> bool:
    return ref.startswith("#/components/schemas/")


def _canonical_json(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), default=str)


def _is_framework_response(
    status: str,
    response: Mapping[str, Any],
    document: Mapping[str, Any],
) -> bool:
    if status != "422":
        return False

    schema = _json_schema(response, document)
    if _schema_ref_name(schema) in {"HTTPValidationError", "ValidationError"}:
        return True

    resolved = _normalize_schema(schema, document)
    return _is_validation_error_schema(resolved, document)


def _schema_ref_name(schema: object) -> str | None:
    if not isinstance(schema, Mapping):
        return None
    ref = schema.get("$ref")
    if not isinstance(ref, str):
        return None
    return ref.rsplit("/", maxsplit=1)[-1]


def _properties(schema: Mapping[str, Any]) -> Mapping[str, Any]:
    properties = schema.get("properties")
    if isinstance(properties, Mapping):
        return cast(Mapping[str, Any], properties)
    return {}


def _is_validation_error_schema(schema: object, document: Mapping[str, Any]) -> bool:
    if not isinstance(schema, Mapping):
        return False

    detail = _properties(schema).get("detail")
    if not isinstance(detail, Mapping) or detail.get("type") != "array":
        return False

    items = _normalize_schema(detail.get("items"), document)
    if not isinstance(items, Mapping):
        return False
    return {"loc", "msg", "type"}.issubset(_properties(items))


def _security_requirements(
    operation: Mapping[str, Any],
    document: Mapping[str, Any],
) -> list[dict[str, list[str]]]:
    value = operation.get("security", document.get("security", []))
    if not isinstance(value, list):
        return []

    requirements: list[dict[str, list[str]]] = []
    for requirement in value:
        if not isinstance(requirement, Mapping):
            continue
        normalized: dict[str, list[str]] = {}
        for scheme_name, scopes in requirement.items():
            if not isinstance(scheme_name, str):
                continue
            if isinstance(scopes, list):
                normalized[scheme_name] = sorted(
                    scope for scope in scopes if isinstance(scope, str)
                )
            else:
                normalized[scheme_name] = []
        requirements.append({key: normalized[key] for key in sorted(normalized)})

    return sorted(requirements, key=_canonical_json)


def _label(method: str, path: str) -> str:
    return f"{method.upper()} {path}"
