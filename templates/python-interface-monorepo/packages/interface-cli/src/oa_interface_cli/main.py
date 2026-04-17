import json
from json import JSONDecodeError
from pathlib import Path
from typing import Annotated, Any, Literal, cast

import typer
from oa_interface_contracts import (
    ContractRegistry,
    ContractSpec,
    ValidationIssue,
    diff_contract_changes,
    emit_openapi,
    validate_contract_spec,
)
from oa_interface_fastapi import detect_drift, load_module_attr
from rich.console import Console

app = typer.Typer(no_args_is_help=True)
console = Console()

OutputFormat = Literal["human", "json"]


@app.command()
def validate(source: Annotated[str, typer.Argument()]) -> None:
    try:
        contract = _load_contract_source(source)
    except (AttributeError, ImportError, OSError, TypeError, ValueError) as exc:
        console.print(f"[red]invalid[/red] {source} - {exc}")
        raise typer.Exit(1) from exc

    issues = validate_contract_spec(contract)
    if issues:
        _print_validation_issues(issues)
        raise typer.Exit(1)

    console.print(f"[green]valid[/green] {source}")


@app.command("emit-openapi")
def emit_openapi_command(
    source: Annotated[str, typer.Argument()],
    output: Annotated[Path | None, typer.Option("--output", "-o")] = None,
) -> None:
    try:
        contract = _load_contract_source(source)
    except (AttributeError, ImportError, OSError, TypeError, ValueError) as exc:
        console.print(f"[red]invalid[/red] {source} - {exc}")
        raise typer.Exit(1) from exc

    payload = json.dumps(emit_openapi(contract), indent=2, sort_keys=True)
    if output is None:
        console.print(payload)
    else:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(f"{payload}\n")
        console.print(f"[green]wrote[/green] {output}")


@app.command("check-artifact")
def check_artifact(
    source: Annotated[str, typer.Argument()],
    artifact: Annotated[Path, typer.Argument(exists=True, readable=True)],
    output_format: Annotated[OutputFormat, typer.Option("--format", "-f")] = "human",
) -> None:
    try:
        contract = _load_contract_source(source)
        actual = _load_openapi_artifact(artifact)
    except (AttributeError, ImportError, OSError, TypeError, ValueError) as exc:
        _print_artifact_error(artifact, str(exc), output_format)
        raise typer.Exit(1) from exc

    expected = emit_openapi(contract)
    result = _artifact_check_result(artifact, expected, actual)

    if output_format == "json":
        console.print(json.dumps(result, indent=2, sort_keys=True), soft_wrap=True)
    elif result["fresh"]:
        console.print(
            f"[green]fresh[/green] {result['artifact']} - {result['summary']}",
            soft_wrap=True,
        )
    else:
        console.print(
            f"[red]stale[/red] {result['artifact']} - {result['summary']}",
            soft_wrap=True,
        )

    if not result["fresh"]:
        raise typer.Exit(1)


@app.command()
def diff(
    base: Annotated[Path, typer.Argument(exists=True, readable=True)],
    head: Annotated[Path, typer.Argument(exists=True, readable=True)],
    fail_on_breaking: Annotated[bool, typer.Option("--fail-on-breaking")] = False,
) -> None:
    base_contract = ContractSpec.model_validate_json(base.read_text())
    head_contract = ContractSpec.model_validate_json(head.read_text())
    result = diff_contract_changes(base_contract, head_contract)

    if not result.breaking and not result.non_breaking:
        console.print("[green]No contract changes detected.[/green]")
        return

    if result.breaking:
        console.print("[red]Breaking changes[/red]")
        for change in result.breaking:
            console.print(f"[red]{change.code}[/red] {change.endpoint} - {change.detail}")
    else:
        console.print("[green]No breaking changes detected.[/green]")

    if result.non_breaking:
        console.print("[green]Non-breaking changes[/green]")
        for change in result.non_breaking:
            console.print(f"[green]{change.code}[/green] {change.endpoint} - {change.detail}")

    if fail_on_breaking and result.breaking:
        raise typer.Exit(1)


@app.command()
def drift(
    app_ref: Annotated[str, typer.Option("--app", help="FastAPI app reference as module:attr")],
    contract_ref: Annotated[
        str,
        typer.Option("--contract", help="Contract reference as module:attr"),
    ],
) -> None:
    issues = detect_drift(app_ref, contract_ref)

    if not issues:
        console.print("[green]No FastAPI drift detected.[/green]")
        return

    for issue in issues:
        console.print(f"[red]{issue.code}[/red] {issue.location} - {issue.detail}")

    raise typer.Exit(1)


def _load_contract_source(source: str) -> ContractSpec:
    path = Path(source)
    if path.exists():
        return ContractSpec.model_validate_json(path.read_text())
    if ":" in source:
        return _contract_from_reference(source)
    raise ValueError(f"{source} is not a readable file or module:attr reference")


def _load_openapi_artifact(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text())
    except JSONDecodeError as exc:
        raise ValueError(f"{path} is not valid JSON: {exc.msg}") from exc
    if not isinstance(payload, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return cast(dict[str, Any], payload)


def _contract_from_reference(reference: str) -> ContractSpec:
    value = load_module_attr(reference)
    if isinstance(value, ContractSpec):
        return value
    if isinstance(value, ContractRegistry):
        return value.to_spec(validate=False)
    raise TypeError("contract reference must resolve to ContractSpec or ContractRegistry")


def _print_validation_issues(issues: list[ValidationIssue]) -> None:
    for issue in issues:
        style = "red" if issue.severity == "error" else "yellow"
        console.print(
            f"[{style}]{issue.severity}[/{style}] "
            f"{issue.code} {issue.location} - {issue.detail}"
        )


def _artifact_check_result(
    artifact: Path,
    expected: dict[str, Any],
    actual: dict[str, Any],
) -> dict[str, object]:
    fresh = actual == expected
    return {
        "artifact": str(artifact),
        "fresh": fresh,
        "summary": "matches managed OpenAPI"
        if fresh
        else _artifact_drift_summary(expected, actual),
        "expected_hash": _document_contract_hash(expected),
        "actual_hash": _document_contract_hash(actual),
    }


def _artifact_drift_summary(
    expected: dict[str, Any],
    actual: dict[str, Any],
) -> str:
    parts: list[str] = []
    if _document_contract_hash(expected) != _document_contract_hash(actual):
        parts.append("hash mismatch")
    parts.extend(
        summary
        for summary in (
            _mapping_drift_summary(
                "paths",
                _object_map(expected, "paths"),
                _object_map(actual, "paths"),
            ),
            _mapping_drift_summary(
                "schemas",
                _component_map(expected, "schemas"),
                _component_map(actual, "schemas"),
            ),
            _mapping_drift_summary(
                "responses",
                _component_map(expected, "responses"),
                _component_map(actual, "responses"),
            ),
            _mapping_drift_summary(
                "securitySchemes",
                _component_map(expected, "securitySchemes"),
                _component_map(actual, "securitySchemes"),
            ),
        )
        if summary is not None
    )
    return "; ".join(parts) if parts else "content differs from managed OpenAPI"


def _mapping_drift_summary(
    label: str,
    expected: dict[str, Any],
    actual: dict[str, Any],
) -> str | None:
    expected_keys = set(expected)
    actual_keys = set(actual)
    missing = expected_keys - actual_keys
    extra = actual_keys - expected_keys
    changed = {
        key
        for key in expected_keys & actual_keys
        if expected[key] != actual[key]
    }
    if not missing and not extra and not changed:
        return None

    counts: list[str] = []
    if missing:
        counts.append(f"{len(missing)} missing")
    if extra:
        counts.append(f"{len(extra)} extra")
    if changed:
        counts.append(f"{len(changed)} changed")
    return f"{label}: {', '.join(counts)}"


def _object_map(document: dict[str, Any], key: str) -> dict[str, Any]:
    value = document.get(key)
    if isinstance(value, dict):
        return cast(dict[str, Any], value)
    return {}


def _component_map(document: dict[str, Any], key: str) -> dict[str, Any]:
    components = document.get("components")
    if not isinstance(components, dict):
        return {}
    value = components.get(key)
    if isinstance(value, dict):
        return cast(dict[str, Any], value)
    return {}


def _document_contract_hash(document: dict[str, Any]) -> str | None:
    value = document.get("x-oa-contract-hash")
    if isinstance(value, str):
        return value
    return None


def _print_artifact_error(
    artifact: Path,
    detail: str,
    output_format: OutputFormat,
) -> None:
    if output_format == "json":
        console.print(
            json.dumps(
                {
                    "artifact": str(artifact),
                    "fresh": False,
                    "summary": detail,
                    "expected_hash": None,
                    "actual_hash": None,
                },
                indent=2,
                sort_keys=True,
            ),
            soft_wrap=True,
        )
    else:
        console.print(f"[red]invalid[/red] {artifact} - {detail}", soft_wrap=True)
