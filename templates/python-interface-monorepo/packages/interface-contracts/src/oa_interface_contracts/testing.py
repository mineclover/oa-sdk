from os import PathLike
from pathlib import Path

from .artifact import compare_openapi_documents, load_openapi_artifact
from .openapi import emit_openapi
from .snapshot import ContractInput, load_contract_spec
from .validation import ValidationIssue, validate_contract_spec


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
