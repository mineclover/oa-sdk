from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Protocol, runtime_checkable

from fastapi import FastAPI
from oa_interface_contracts import ContractSpec, emit_openapi

from .loader import load_module_attr

OpenApiDocument = dict[str, Any]


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


def detect_drift(app_ref: str, contract_ref: str) -> list[DriftIssue]:
    fastapi_app = load_fastapi_app(app_ref)
    runtime_openapi: OpenApiDocument = fastapi_app.openapi()
    managed_openapi = load_contract_openapi(contract_ref)
    return compare_openapi(runtime_openapi, managed_openapi)


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
        issues.extend(_compare_operation(location, runtime_operation, managed_operation))

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
            operations[(method.lower(), path)] = operation
    return operations


def _compare_operation(
    location: str,
    runtime: Mapping[str, Any],
    managed: Mapping[str, Any],
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

    runtime_request_schema = _request_schema(runtime)
    managed_request_schema = _request_schema(managed)
    if runtime_request_schema != managed_request_schema:
        issues.append(
            DriftIssue(
                code="request-schema-drift",
                location=location,
                detail="Runtime request body schema does not match the managed contract.",
            )
        )

    issues.extend(_compare_responses(location, runtime, managed))
    return issues


def _compare_responses(
    location: str,
    runtime: Mapping[str, Any],
    managed: Mapping[str, Any],
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

        if _json_schema(runtime_response) != _json_schema(managed_response):
            issues.append(
                DriftIssue(
                    code="response-schema-drift",
                    location=f"{location} {status}",
                    detail="Runtime response schema does not match the managed contract.",
                )
            )

    return issues


def _request_schema(operation: Mapping[str, Any]) -> object:
    request_body = operation.get("requestBody")
    if not isinstance(request_body, Mapping):
        return None
    return _json_schema(request_body)


def _responses(operation: Mapping[str, Any]) -> dict[str, Mapping[str, Any]]:
    responses = operation.get("responses")
    if not isinstance(responses, Mapping):
        return {}
    return {
        status: response
        for status, response in responses.items()
        if isinstance(status, str) and isinstance(response, Mapping)
    }


def _json_schema(container: Mapping[str, Any]) -> object:
    content = container.get("content")
    if not isinstance(content, Mapping):
        return None
    media_type = content.get("application/json")
    if not isinstance(media_type, Mapping):
        return None
    return media_type.get("schema")


def _label(method: str, path: str) -> str:
    return f"{method.upper()} {path}"
