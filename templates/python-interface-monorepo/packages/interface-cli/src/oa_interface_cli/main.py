import json
from json import JSONDecodeError
from pathlib import Path
from typing import Annotated, Any, Literal, cast

import typer
from oa_interface_contracts import (
    ContractChange,
    ContractRegistry,
    ContractSpec,
    ValidationIssue,
    diff_contract_changes,
    emit_openapi,
    validate_contract_spec,
)
from oa_interface_fastapi import (
    DriftIssue,
    compare_openapi,
    detect_drift,
    load_fastapi_app,
    load_module_attr,
)
from rich.console import Console

app = typer.Typer(no_args_is_help=True)
console = Console()

OutputFormat = Literal["human", "json"]
DriftOutputFormat = Literal["text", "json", "markdown"]
ReviewOutputFormat = Literal["json", "markdown"]
ReviewRecommendation = Literal["APPROVE", "COMMENT", "REQUEST_CHANGES"]


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
    target: Annotated[
        str | None,
        typer.Option(
            "--target",
            help="Emit only operations and reachable schemas assigned to this target.",
        ),
    ] = None,
) -> None:
    try:
        contract = _load_contract_source(source)
    except (AttributeError, ImportError, OSError, TypeError, ValueError) as exc:
        console.print(f"[red]invalid[/red] {source} - {exc}")
        raise typer.Exit(1) from exc

    try:
        document = emit_openapi(contract, target=target)
    except ValueError as exc:
        console.print(f"[red]invalid[/red] {source} - {exc}")
        raise typer.Exit(1) from exc

    payload = json.dumps(document, indent=2, sort_keys=True)
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
    output_format: Annotated[DriftOutputFormat, typer.Option("--format", "-f")] = "text",
) -> None:
    issues = detect_drift(app_ref, contract_ref)

    _print_drift_result(issues, output_format)

    if issues:
        raise typer.Exit(1)


@app.command()
def review(
    base: Annotated[
        str,
        typer.Argument(help="Base contract JSON file or module:attr reference."),
    ],
    head: Annotated[
        str,
        typer.Argument(help="Head contract JSON file or module:attr reference."),
    ],
    artifact: Annotated[
        Path | None,
        typer.Option(
            "--artifact",
            help="Generated OpenAPI artifact to freshness-check against the head contract.",
        ),
    ] = None,
    app_ref: Annotated[
        str | None,
        typer.Option("--app", help="FastAPI app reference as module:attr for drift checks."),
    ] = None,
    target: Annotated[
        str | None,
        typer.Option(
            "--target",
            help="Review the target-specific OpenAPI slice for drift and artifact freshness.",
        ),
    ] = None,
    output_format: Annotated[ReviewOutputFormat, typer.Option("--format", "-f")] = "markdown",
) -> None:
    try:
        report = _build_review_report(
            base=base,
            head=head,
            app_ref=app_ref,
            artifact=artifact,
            target=target,
        )
    except (AttributeError, ImportError, OSError, TypeError, ValueError) as exc:
        _print_review_load_error(str(exc), output_format)
        raise typer.Exit(1) from exc

    if output_format == "json":
        console.print(json.dumps(report, indent=2, sort_keys=True), markup=False, soft_wrap=True)
    else:
        console.print(_review_markdown(report), markup=False, soft_wrap=True)

    if report.get("recommendation") == "REQUEST_CHANGES":
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


def _print_drift_result(
    issues: list[DriftIssue],
    output_format: DriftOutputFormat,
) -> None:
    if output_format == "json":
        console.print(
            json.dumps(_drift_result_payload(issues), indent=2, sort_keys=True),
            soft_wrap=True,
        )
        return

    if output_format == "markdown":
        console.print(_drift_markdown(issues), soft_wrap=True)
        return

    if not issues:
        console.print("[green]No FastAPI drift detected.[/green]")
        return

    for issue in issues:
        console.print(f"[red]{issue.code}[/red] {issue.location} - {issue.detail}")


def _drift_result_payload(issues: list[DriftIssue]) -> dict[str, object]:
    return {
        "drift": bool(issues),
        "issues": [
            {
                "code": issue.code,
                "location": issue.location,
                "detail": issue.detail,
            }
            for issue in issues
        ],
    }


def _drift_markdown(issues: list[DriftIssue]) -> str:
    if not issues:
        return "## FastAPI Drift\n\nNo FastAPI drift detected."

    rows = [
        "## FastAPI Drift",
        "",
        "| Code | Location | Detail |",
        "| --- | --- | --- |",
    ]
    for issue in issues:
        rows.append(
            "| "
            f"{_markdown_cell(issue.code)} | "
            f"{_markdown_cell(issue.location)} | "
            f"{_markdown_cell(issue.detail)} |"
        )
    return "\n".join(rows)


def _markdown_cell(value: object) -> str:
    return str(value).replace("\n", " ").replace("|", "\\|")


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


def _build_review_report(
    *,
    base: str,
    head: str,
    app_ref: str | None,
    artifact: Path | None,
    target: str | None,
) -> dict[str, object]:
    base_contract = _load_contract_source(base)
    head_contract = _load_contract_source(head)
    validation_issues = validate_contract_spec(head_contract)
    diff_result = diff_contract_changes(base_contract, head_contract)
    managed_openapi = emit_openapi(head_contract, target=target)
    drift_result = _review_drift_result(app_ref, managed_openapi)
    artifact_result = _review_artifact_result(artifact, managed_openapi)

    drift_failed = bool(drift_result.get("issues"))
    artifact_failed = artifact_result.get("fresh") is False
    incomplete_checks = (
        drift_result.get("checked") is not True or artifact_result.get("checked") is not True
    )
    recommendation = _review_recommendation(
        breaking=diff_result.breaking,
        non_breaking=diff_result.non_breaking,
        validation_issues=validation_issues,
        drift_failed=drift_failed,
        artifact_failed=artifact_failed,
        incomplete_checks=incomplete_checks,
    )

    return {
        "recommendation": recommendation,
        "base": base,
        "head": head,
        "target": target,
        "summary": {
            "breaking_changes": len(diff_result.breaking),
            "non_breaking_changes": len(diff_result.non_breaking),
            "validation_issues": len(validation_issues),
            "drift_issues": len(cast(list[object], drift_result["issues"])),
            "artifact_fresh": artifact_result.get("fresh"),
            "checks_incomplete": incomplete_checks,
        },
        "diff": {
            "breaking": [_change_payload(change) for change in diff_result.breaking],
            "non_breaking": [_change_payload(change) for change in diff_result.non_breaking],
        },
        "drift": drift_result,
        "artifact": artifact_result,
        "validation": {
            "issues": [_validation_issue_payload(issue) for issue in validation_issues],
        },
    }


def _review_recommendation(
    *,
    breaking: list[ContractChange],
    non_breaking: list[ContractChange],
    validation_issues: list[ValidationIssue],
    drift_failed: bool,
    artifact_failed: bool,
    incomplete_checks: bool,
) -> ReviewRecommendation:
    has_validation_errors = any(issue.severity == "error" for issue in validation_issues)
    if breaking or has_validation_errors or drift_failed or artifact_failed:
        return "REQUEST_CHANGES"
    if non_breaking or validation_issues or incomplete_checks:
        return "COMMENT"
    return "APPROVE"


def _review_drift_result(
    app_ref: str | None,
    managed_openapi: dict[str, Any],
) -> dict[str, object]:
    if app_ref is None:
        return {
            "checked": False,
            "drift": None,
            "issues": [],
            "summary": "not checked",
        }

    try:
        runtime_openapi = load_fastapi_app(app_ref).openapi()
        issues = compare_openapi(runtime_openapi, managed_openapi)
    except Exception as exc:  # noqa: BLE001 - report drift-check failures in the review body.
        issues = [
            DriftIssue(
                code="drift-check-failed",
                location=app_ref,
                detail=str(exc),
            )
        ]

    return {
        "checked": True,
        "drift": bool(issues),
        "issues": [_drift_issue_payload(issue) for issue in issues],
        "summary": "drift detected" if issues else "no drift detected",
    }


def _review_artifact_result(
    artifact: Path | None,
    expected_openapi: dict[str, Any],
) -> dict[str, object]:
    if artifact is None:
        return {
            "checked": False,
            "artifact": None,
            "fresh": None,
            "summary": "not checked",
            "expected_hash": _document_contract_hash(expected_openapi),
            "actual_hash": None,
        }

    try:
        actual_openapi = _load_openapi_artifact(artifact)
    except (OSError, ValueError) as exc:
        return {
            "checked": True,
            "artifact": str(artifact),
            "fresh": False,
            "summary": str(exc),
            "expected_hash": _document_contract_hash(expected_openapi),
            "actual_hash": None,
        }

    result = _artifact_check_result(artifact, expected_openapi, actual_openapi)
    result["checked"] = True
    return result


def _change_payload(change: ContractChange) -> dict[str, str]:
    return {
        "code": change.code,
        "endpoint": change.endpoint,
        "detail": change.detail,
        "severity": change.severity,
    }


def _validation_issue_payload(issue: ValidationIssue) -> dict[str, str]:
    return {
        "severity": issue.severity,
        "code": issue.code,
        "location": issue.location,
        "detail": issue.detail,
    }


def _drift_issue_payload(issue: DriftIssue) -> dict[str, str]:
    return {
        "code": issue.code,
        "location": issue.location,
        "detail": issue.detail,
    }


def _review_markdown(report: dict[str, object]) -> str:
    diff_result = cast(dict[str, object], report["diff"])
    drift_result = cast(dict[str, object], report["drift"])
    artifact_result = cast(dict[str, object], report["artifact"])
    validation_result = cast(dict[str, object], report["validation"])
    breaking = cast(list[dict[str, str]], diff_result["breaking"])
    non_breaking = cast(list[dict[str, str]], diff_result["non_breaking"])
    drift_issues = cast(list[dict[str, str]], drift_result["issues"])
    validation_issues = cast(list[dict[str, str]], validation_result["issues"])

    lines = [
        "# Contract Review",
        "",
        f"Recommendation: **{report['recommendation']}**",
        "",
        "## Breaking Changes",
        *_markdown_change_lines(breaking),
        "",
        "## Drift Issues",
        *_markdown_issue_lines(drift_issues, checked=drift_result.get("checked") is True),
        "",
        "## Artifact Freshness",
        *_markdown_artifact_lines(artifact_result),
        "",
        "## Validation Issues",
        *_markdown_validation_lines(validation_issues),
        "",
        "## Non-breaking Changes",
        *_markdown_change_lines(non_breaking),
    ]
    return "\n".join(lines)


def _markdown_change_lines(changes: list[dict[str, str]]) -> list[str]:
    if not changes:
        return ["None."]
    return [
        (
            f"- `{_markdown_code_text(change['code'])}` "
            f"`{_markdown_code_text(change['endpoint'])}` - "
            f"{_markdown_text(change['detail'])}"
        )
        for change in changes
    ]


def _markdown_issue_lines(
    issues: list[dict[str, str]],
    *,
    checked: bool,
) -> list[str]:
    if not checked:
        return ["Not checked."]
    if not issues:
        return ["None."]
    return [
        (
            f"- `{_markdown_code_text(issue['code'])}` "
            f"`{_markdown_code_text(issue['location'])}` - "
            f"{_markdown_text(issue['detail'])}"
        )
        for issue in issues
    ]


def _markdown_validation_lines(issues: list[dict[str, str]]) -> list[str]:
    if not issues:
        return ["None."]
    return [
        (
            f"- **{_markdown_text(issue['severity'])}** "
            f"`{_markdown_code_text(issue['code'])}` "
            f"`{_markdown_code_text(issue['location'])}` - "
            f"{_markdown_text(issue['detail'])}"
        )
        for issue in issues
    ]


def _markdown_artifact_lines(status: dict[str, object]) -> list[str]:
    if status.get("checked") is not True:
        return ["Not checked."]
    state = "fresh" if status.get("fresh") is True else "stale"
    artifact = _markdown_code_text(status.get("artifact"))
    summary = _markdown_text(status.get("summary"))
    return [f"- `{artifact}`: **{state}** - {summary}"]


def _markdown_text(value: object) -> str:
    return str(value).replace("\n", " ").strip()


def _markdown_code_text(value: object) -> str:
    return _markdown_text(value).replace("`", "\\`")


def _print_review_load_error(detail: str, output_format: ReviewOutputFormat) -> None:
    if output_format == "json":
        console.print(
            json.dumps(
                {
                    "recommendation": "REQUEST_CHANGES",
                    "error": detail,
                },
                indent=2,
                sort_keys=True,
            ),
            markup=False,
            soft_wrap=True,
        )
        return

    console.print(
        "\n".join(
            [
                "# Contract Review",
                "",
                "Recommendation: **REQUEST_CHANGES**",
                "",
                "## Error",
                _markdown_text(detail),
            ]
        ),
        markup=False,
        soft_wrap=True,
    )


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
