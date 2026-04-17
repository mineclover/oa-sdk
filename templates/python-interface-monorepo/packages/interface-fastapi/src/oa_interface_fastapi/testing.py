from collections.abc import Mapping
from os import PathLike
from pathlib import Path
from typing import Any, Protocol, runtime_checkable

from fastapi import FastAPI
from oa_interface_contracts import ContractInput, emit_openapi, load_contract_spec

from .adapter import FASTAPI_ADAPTER
from .drift import DriftIssue, _contract_to_openapi, compare_openapi
from .loader import load_module_attr


@runtime_checkable
class OpenApiProvider(Protocol):
    def openapi(self) -> Mapping[str, Any]: ...


FastApiInput = str | FastAPI | Mapping[str, Any] | OpenApiProvider


def assert_no_fastapi_drift(app: FastApiInput, contract: ContractInput) -> None:
    app_label = _source_label(app)
    contract_label = _source_label(contract)
    try:
        runtime_openapi = _runtime_openapi(app)
        managed_openapi = _managed_openapi(contract)
        issues = compare_openapi(runtime_openapi, managed_openapi)
    except Exception as exc:  # noqa: BLE001 - convert loader failures into pytest assertion text.
        raise AssertionError(
            f"FastAPI drift check failed for {app_label} -> {contract_label}: {exc}"
        ) from exc

    if issues:
        raise AssertionError(_drift_failure_message(app_label, contract_label, issues))


def _runtime_openapi(source: FastApiInput) -> Mapping[str, Any]:
    if isinstance(source, str):
        app = load_module_attr(source)
        return FASTAPI_ADAPTER.extract_openapi(app)
    if isinstance(source, FastAPI):
        return FASTAPI_ADAPTER.extract_openapi(source)
    if isinstance(source, Mapping):
        return source
    if isinstance(source, OpenApiProvider):
        return source.openapi()
    raise TypeError("app source must be FastAPI, OpenAPI mapping, or module:attr reference")


def _managed_openapi(source: ContractInput) -> Mapping[str, Any]:
    if isinstance(source, (str, PathLike)):
        text = str(source)
        path = Path(source)
        if path.exists():
            return emit_openapi(load_contract_spec(source))
        if isinstance(source, str) and ":" in source:
            return _contract_to_openapi(load_module_attr(source))
        raise ValueError(f"{text} is not a readable file or module:attr reference")
    return _contract_to_openapi(source)


def _drift_failure_message(
    app_label: str,
    contract_label: str,
    issues: list[DriftIssue],
) -> str:
    issue_count = len(issues)
    issue_label = "issue" if issue_count == 1 else "issues"
    lines = [
        (
            "FastAPI drift detected for "
            f"{app_label} -> {contract_label} with {issue_count} {issue_label}:"
        )
    ]
    lines.extend(f"- {issue.code} at {issue.location}: {issue.detail}" for issue in issues)
    return "\n".join(lines)


def _source_label(source: object) -> str:
    if isinstance(source, (str, PathLike)):
        return str(source)
    return source.__class__.__name__
