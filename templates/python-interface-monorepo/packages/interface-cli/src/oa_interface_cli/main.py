import json
from pathlib import Path
from typing import Annotated, Any, Literal, cast

import typer
from oa_interface_contracts import (
    ContractChange,
    ContractSpec,
    RuntimeOpenApiAdapter,
    ValidationIssue,
    compare_openapi_documents,
    diff_contract_changes,
    emit_openapi,
    load_contract_spec,
    load_module_attr,
    load_openapi_artifact,
    serialize_contract_snapshot,
    validate_contract_spec,
)
from oa_interface_fastapi import (
    FASTAPI_ADAPTER,
    DriftIssue,
    compare_openapi,
)
from rich.console import Console

app = typer.Typer(no_args_is_help=True)
console = Console()

OutputFormat = Literal["human", "json"]
DriftOutputFormat = Literal["text", "json", "markdown"]
AdapterName = Literal["fastapi"]
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


@app.command()
def snapshot(
    source: Annotated[
        str,
        typer.Argument(help="Contract JSON, snapshot JSON, or module:attr registry reference."),
    ],
    output: Annotated[Path | None, typer.Option("--output", "-o")] = None,
) -> None:
    try:
        payload = serialize_contract_snapshot(source)
    except (AttributeError, ImportError, OSError, TypeError, ValueError) as exc:
        console.print(f"[red]invalid[/red] {source} - {exc}")
        raise typer.Exit(1) from exc

    if output is None:
        console.print(payload, soft_wrap=True)
        return

    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(f"{payload}\n")
    console.print(f"[green]wrote[/green] {output}", soft_wrap=True)


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
        actual = load_openapi_artifact(artifact)
    except (AttributeError, ImportError, OSError, TypeError, ValueError) as exc:
        _print_artifact_error(artifact, str(exc), output_format)
        raise typer.Exit(1) from exc

    expected = emit_openapi(contract)
    result = compare_openapi_documents(artifact, expected, actual).to_dict()

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
    base_contract = _load_contract_source(str(base))
    head_contract = _load_contract_source(str(head))
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
    adapter_name: Annotated[
        AdapterName,
        typer.Option("--adapter", help="Runtime adapter used to extract OpenAPI from --app."),
    ] = "fastapi",
) -> None:
    adapter = _runtime_adapter(adapter_name)
    issues = _detect_drift(app_ref, contract_ref, adapter=adapter)

    _print_drift_result(issues, output_format, adapter=adapter)

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
    return load_contract_spec(source)


def _runtime_adapter(adapter_name: AdapterName) -> RuntimeOpenApiAdapter:
    if adapter_name == "fastapi":
        return FASTAPI_ADAPTER
    raise ValueError(f"unsupported adapter {adapter_name!r}")


def _detect_drift(
    app_ref: str,
    contract_ref: str,
    *,
    adapter: RuntimeOpenApiAdapter,
) -> list[DriftIssue]:
    runtime_openapi = _runtime_openapi(app_ref, adapter=adapter)
    managed_openapi = emit_openapi(_load_contract_source(contract_ref))
    return compare_openapi(runtime_openapi, managed_openapi)


def _runtime_openapi(
    app_ref: str,
    *,
    adapter: RuntimeOpenApiAdapter,
) -> dict[str, Any]:
    runtime = load_module_attr(app_ref)
    return dict(adapter.extract_openapi(runtime))


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
    *,
    adapter: RuntimeOpenApiAdapter,
) -> None:
    if output_format == "json":
        console.print(
            json.dumps(_drift_result_payload(issues), indent=2, sort_keys=True),
            soft_wrap=True,
        )
        return

    if output_format == "markdown":
        console.print(_drift_markdown(issues, adapter=adapter), soft_wrap=True)
        return

    if not issues:
        console.print(f"[green]No {adapter.framework} drift detected.[/green]")
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


def _drift_markdown(
    issues: list[DriftIssue],
    *,
    adapter: RuntimeOpenApiAdapter,
) -> str:
    if not issues:
        return f"## {adapter.framework} Drift\n\nNo {adapter.framework} drift detected."

    rows = [
        f"## {adapter.framework} Drift",
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
    drift_result = _review_drift_result(app_ref, managed_openapi, adapter=FASTAPI_ADAPTER)
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
    *,
    adapter: RuntimeOpenApiAdapter,
) -> dict[str, object]:
    if app_ref is None:
        return {
            "checked": False,
            "drift": None,
            "issues": [],
            "summary": "not checked",
        }

    try:
        runtime_openapi = _runtime_openapi(app_ref, adapter=adapter)
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
        actual_openapi = load_openapi_artifact(artifact)
    except (OSError, ValueError) as exc:
        return {
            "checked": True,
            "artifact": str(artifact),
            "fresh": False,
            "summary": str(exc),
            "expected_hash": _document_contract_hash(expected_openapi),
            "actual_hash": None,
        }

    result = compare_openapi_documents(artifact, expected_openapi, actual_openapi).to_dict()
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
