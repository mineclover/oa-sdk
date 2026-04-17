import json

from oa_interface_cli.main import app
from typer.testing import CliRunner


def test_validate_contract_file(tmp_path) -> None:
    contract_path = tmp_path / "contract.json"
    contract_path.write_text(
        json.dumps(
            {
                "name": "Users API",
                "version": "1.0.0",
                "endpoints": [
                    {
                        "method": "get",
                        "path": "/users",
                        "operation_id": "list_users",
                    }
                ],
                "schemas": {},
            }
        )
    )

    result = CliRunner().invoke(app, ["validate", str(contract_path)])

    assert result.exit_code == 0
    assert "valid" in result.stdout


def test_validate_contract_file_reports_policy_issues(tmp_path) -> None:
    contract_path = tmp_path / "contract.json"
    contract_path.write_text(
        json.dumps(
            {
                "name": "Users API",
                "version": "1.0.0",
                "endpoints": [
                    {
                        "method": "get",
                        "path": "/users",
                        "operation_id": "list_users",
                    },
                    {
                        "method": "post",
                        "path": "/users",
                        "operation_id": "list_users",
                    },
                ],
                "schemas": {},
            }
        )
    )

    result = CliRunner().invoke(app, ["validate", str(contract_path)])

    assert result.exit_code == 1
    assert "error duplicate-operation-id" in result.stdout


def test_validate_module_registry_reference(tmp_path, monkeypatch) -> None:
    fixture = tmp_path / "contract_fixture.py"
    fixture.write_text(
        """
from oa_interface_contracts import ContractRegistry
from pydantic import BaseModel


class Widget(BaseModel):
    id: str


registry = ContractRegistry(name="Widgets API", version="1.0.0")
registry.model("Widget", Widget)
registry.endpoint(
    method="get",
    path="/widgets/{widget_id}",
    operation_id="get_widget",
    response_model="Widget",
    path_params=["widget_id"],
)
"""
    )
    monkeypatch.syspath_prepend(str(tmp_path))

    result = CliRunner().invoke(app, ["validate", "contract_fixture:registry"])

    assert result.exit_code == 0
    assert "valid" in result.stdout


def test_emit_openapi_accepts_module_registry_reference_and_is_deterministic(
    tmp_path,
    monkeypatch,
) -> None:
    fixture = tmp_path / "emit_fixture.py"
    fixture.write_text(
        """
from oa_interface_contracts import ContractRegistry
from pydantic import BaseModel


class Widget(BaseModel):
    id: str


registry = ContractRegistry(name="Widgets API", version="1.0.0")
registry.model("Widget", Widget)
registry.endpoint(
    method="get",
    path="/widgets/{widget_id}",
    operation_id="get_widget",
    response_model="Widget",
    tags=["widgets"],
    path_params=["widget_id"],
)
"""
    )
    monkeypatch.syspath_prepend(str(tmp_path))
    runner = CliRunner()

    first = runner.invoke(app, ["emit-openapi", "emit_fixture:registry"])
    second = runner.invoke(app, ["emit-openapi", "emit_fixture:registry"])

    assert first.exit_code == 0
    assert second.exit_code == 0
    assert first.stdout == second.stdout
    document = json.loads(first.stdout)
    assert document["info"]["title"] == "Widgets API"
    assert document["x-oa-contract-hash"].startswith("sha256:")


def test_emit_openapi_writes_identical_output_across_repeated_runs(tmp_path) -> None:
    contract_path = tmp_path / "contract.json"
    output_path = tmp_path / "openapi.json"
    contract_path.write_text(
        json.dumps(
            {
                "name": "Users API",
                "version": "1.0.0",
                "endpoints": [
                    {
                        "method": "get",
                        "path": "/users",
                        "operation_id": "list_users",
                        "tags": ["users"],
                    }
                ],
                "schemas": {},
            }
        )
    )
    runner = CliRunner()

    first = runner.invoke(
        app,
        ["emit-openapi", str(contract_path), "--output", str(output_path)],
    )
    first_payload = output_path.read_text()
    second = runner.invoke(
        app,
        ["emit-openapi", str(contract_path), "--output", str(output_path)],
    )

    assert first.exit_code == 0
    assert second.exit_code == 0
    assert output_path.read_text() == first_payload


def test_check_artifact_reports_fresh_artifact(tmp_path) -> None:
    contract_path = tmp_path / "contract.json"
    artifact_path = tmp_path / "contracts" / "users-api" / "openapi.json"
    contract_path.write_text(
        json.dumps(
            {
                "name": "Users API",
                "version": "1.0.0",
                "endpoints": [
                    {
                        "method": "get",
                        "path": "/users",
                        "operation_id": "list_users",
                    }
                ],
                "schemas": {},
            }
        )
    )
    runner = CliRunner()
    emit_result = runner.invoke(
        app,
        ["emit-openapi", str(contract_path), "--output", str(artifact_path)],
    )

    result = runner.invoke(
        app,
        ["check-artifact", str(contract_path), str(artifact_path)],
    )

    assert emit_result.exit_code == 0
    assert result.exit_code == 0
    assert "fresh" in result.stdout
    assert str(artifact_path) in result.stdout


def test_check_artifact_exits_nonzero_when_artifact_is_stale(tmp_path) -> None:
    contract_path = tmp_path / "contract.json"
    artifact_path = tmp_path / "contracts" / "users-api" / "openapi.json"
    contract_path.write_text(
        json.dumps(
            {
                "name": "Users API",
                "version": "1.0.0",
                "endpoints": [
                    {
                        "method": "get",
                        "path": "/users",
                        "operation_id": "list_users",
                    }
                ],
                "schemas": {},
            }
        )
    )
    artifact_path.parent.mkdir(parents=True)
    artifact_path.write_text(
        json.dumps(
            {
                "openapi": "3.1.0",
                "info": {"title": "Users API", "version": "1.0.0"},
                "paths": {},
                "components": {"schemas": {}},
                "x-oa-contract-hash": "sha256:stale",
            }
        )
    )

    result = CliRunner().invoke(
        app,
        ["check-artifact", str(contract_path), str(artifact_path)],
    )

    assert result.exit_code == 1
    assert "stale" in result.stdout
    assert str(artifact_path) in result.stdout
    assert "hash mismatch" in result.stdout
    assert "paths: 1 missing" in result.stdout


def test_check_artifact_supports_json_output(tmp_path) -> None:
    contract_path = tmp_path / "contract.json"
    artifact_path = tmp_path / "contracts" / "users-api" / "openapi.json"
    contract_path.write_text(
        json.dumps(
            {
                "name": "Users API",
                "version": "1.0.0",
                "endpoints": [
                    {
                        "method": "get",
                        "path": "/users",
                        "operation_id": "list_users",
                    }
                ],
                "schemas": {},
            }
        )
    )
    artifact_path.parent.mkdir(parents=True)
    artifact_path.write_text(
        json.dumps(
            {
                "openapi": "3.1.0",
                "info": {"title": "Users API", "version": "1.0.0"},
                "paths": {},
                "components": {"schemas": {}},
            }
        )
    )

    result = CliRunner().invoke(
        app,
        ["check-artifact", str(contract_path), str(artifact_path), "--format", "json"],
    )
    payload = json.loads(result.stdout)

    assert result.exit_code == 1
    assert payload["fresh"] is False
    assert payload["artifact"] == str(artifact_path)
    assert payload["summary"] == "hash mismatch; paths: 1 missing"


def test_drift_command_accepts_matching_example_app() -> None:
    result = CliRunner().invoke(
        app,
        [
            "drift",
            "--app",
            "example_api.main:app",
            "--contract",
            "example_api.contracts:registry",
        ],
    )

    assert result.exit_code == 0
    assert "No FastAPI drift detected" in result.stdout


def test_drift_command_exits_nonzero_when_drift_exists(tmp_path, monkeypatch) -> None:
    fixture = tmp_path / "drift_fixture.py"
    fixture.write_text(
        """
from fastapi import FastAPI
from oa_interface_contracts import ContractEndpoint, ContractSpec
from pydantic import BaseModel


class Widget(BaseModel):
    id: str


contract = ContractSpec(
    name="Widgets API",
    version="1.0.0",
    schemas={"Widget": Widget.model_json_schema(mode="validation")},
    endpoints=[
        ContractEndpoint(
            method="get",
            path="/widgets/{widget_id}",
            operation_id="get_widget",
            response_model="Widget",
        )
    ],
)

app = FastAPI(title="Widgets API", version="1.0.0")


@app.get("/widgets/{widget_id}", response_model=Widget, operation_id="runtime_widget")
def get_widget(widget_id: str) -> Widget:
    return Widget(id=widget_id)
"""
    )
    monkeypatch.syspath_prepend(str(tmp_path))

    result = CliRunner().invoke(
        app,
        [
            "drift",
            "--app",
            "drift_fixture:app",
            "--contract",
            "drift_fixture:contract",
        ],
    )

    assert result.exit_code == 1
    assert "operation-id-drift" in result.stdout
