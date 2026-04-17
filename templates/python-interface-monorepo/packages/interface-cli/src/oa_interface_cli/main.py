import json
from pathlib import Path
from typing import Annotated

import typer
from oa_interface_contracts import (
    ContractRegistry,
    ContractSpec,
    ValidationIssue,
    diff_contracts,
    emit_openapi,
    validate_contract_spec,
)
from oa_interface_fastapi import detect_drift, load_module_attr
from rich.console import Console

app = typer.Typer(no_args_is_help=True)
console = Console()


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
    path: Annotated[Path, typer.Argument(exists=True, readable=True)],
    output: Annotated[Path | None, typer.Option("--output", "-o")] = None,
) -> None:
    contract = ContractSpec.model_validate_json(path.read_text())
    payload = json.dumps(emit_openapi(contract), indent=2, sort_keys=True)
    if output is None:
        console.print(payload)
    else:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(f"{payload}\n")
        console.print(f"[green]wrote[/green] {output}")


@app.command()
def diff(
    base: Annotated[Path, typer.Argument(exists=True, readable=True)],
    head: Annotated[Path, typer.Argument(exists=True, readable=True)],
    fail_on_breaking: Annotated[bool, typer.Option("--fail-on-breaking")] = False,
) -> None:
    base_contract = ContractSpec.model_validate_json(base.read_text())
    head_contract = ContractSpec.model_validate_json(head.read_text())
    changes = diff_contracts(base_contract, head_contract)

    if not changes:
        console.print("[green]No breaking changes detected.[/green]")
        return

    for change in changes:
        console.print(f"[red]{change.code}[/red] {change.endpoint} - {change.detail}")

    if fail_on_breaking:
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
