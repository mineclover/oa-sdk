from collections.abc import Mapping
from importlib import import_module
from os import PathLike
from pathlib import Path
from typing import Any, Protocol, runtime_checkable

from .artifact import compare_openapi_documents, load_openapi_artifact
from .openapi import emit_openapi
from .registry import ContractRegistry
from .spec import ContractSpec
from .validation import ValidationIssue, validate_contract_spec


@runtime_checkable
class ContractFactory(Protocol):
    def to_contract(self) -> ContractSpec: ...


ContractInput = (
    str
    | PathLike[str]
    | ContractSpec
    | ContractRegistry
    | Mapping[str, Any]
    | ContractFactory
)


def load_contract_spec(source: ContractInput) -> ContractSpec:
    if isinstance(source, ContractSpec):
        return source
    if isinstance(source, ContractRegistry):
        return source.to_spec(validate=False)
    if isinstance(source, Mapping):
        return ContractSpec.model_validate(source)
    if isinstance(source, (str, PathLike)):
        text = str(source)
        path = Path(source)
        if path.exists():
            return ContractSpec.model_validate_json(path.read_text())
        if isinstance(source, str) and ":" in source:
            return load_contract_spec(_load_module_attr(source))
        raise ValueError(f"{text} is not a readable file or module:attr reference")
    if isinstance(source, ContractFactory):
        return source.to_contract()
    raise TypeError(
        "contract source must be ContractSpec, ContractRegistry, mapping, file, or module:attr"
    )


def assert_contract_valid(source: ContractInput) -> None:
    label = _source_label(source)
    try:
        contract = load_contract_spec(source)
        issues = validate_contract_spec(contract)
    except Exception as exc:  # noqa: BLE001 - convert loader failures into pytest assertion text.
        raise AssertionError(f"Contract validation failed for {label}: {exc}") from exc

    if issues:
        raise AssertionError(_validation_failure_message(label, issues))


def assert_openapi_artifact_current(
    source: ContractInput,
    artifact: str | Path,
    *,
    target: str | None = None,
) -> None:
    label = _source_label(source)
    try:
        contract = load_contract_spec(source)
        expected = emit_openapi(contract, target=target)
        actual = load_openapi_artifact(artifact)
        result = compare_openapi_documents(artifact, expected, actual)
    except Exception as exc:  # noqa: BLE001 - convert loader failures into pytest assertion text.
        raise AssertionError(
            f"OpenAPI artifact freshness check failed for {label} -> {artifact}: {exc}"
        ) from exc

    if result.fresh:
        return

    target_text = f" target={target!r}" if target is not None else ""
    raise AssertionError(
        "\n".join(
            [
                f"OpenAPI artifact is stale for {label}{target_text}: {result.artifact}",
                f"- summary: {result.summary}",
                f"- expected_hash: {result.expected_hash}",
                f"- actual_hash: {result.actual_hash}",
            ]
        )
    )


def _load_module_attr(reference: str) -> Any:
    module_name, separator, attr_path = reference.partition(":")
    if not separator or not module_name or not attr_path:
        raise ValueError("reference must use module:attribute syntax")

    value: Any = import_module(module_name)
    for attr in attr_path.split("."):
        value = getattr(value, attr)
    return value


def _validation_failure_message(label: str, issues: list[ValidationIssue]) -> str:
    issue_count = len(issues)
    issue_label = "issue" if issue_count == 1 else "issues"
    lines = [f"Contract validation failed for {label} with {issue_count} {issue_label}:"]
    lines.extend(
        f"- {issue.severity} {issue.code} at {issue.location}: {issue.detail}"
        for issue in issues
    )
    return "\n".join(lines)


def _source_label(source: object) -> str:
    if isinstance(source, (str, PathLike)):
        return str(source)
    return source.__class__.__name__
