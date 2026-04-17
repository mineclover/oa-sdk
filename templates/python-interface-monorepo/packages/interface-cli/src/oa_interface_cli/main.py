import json
from pathlib import Path
from typing import Annotated

import typer
from oa_interface_contracts import ContractSpec, diff_contracts, emit_openapi
from oa_interface_fastapi import detect_drift
from rich.console import Console

app = typer.Typer(no_args_is_help=True)
console = Console()


@app.command()
def validate(path: Annotated[Path, typer.Argument(exists=True, readable=True)]) -> None:
    ContractSpec.model_validate_json(path.read_text())
    console.print(f"[green]valid[/green] {path}")


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
