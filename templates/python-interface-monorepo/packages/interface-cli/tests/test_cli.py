import json
from pathlib import Path

from oa_interface_cli.cli_spec import OA_CONTRACT_GOVERNANCE_MANIFEST
from oa_interface_cli.main import app
from typer.testing import CliRunner


def test_cli_manifest_matches_registered_commands() -> None:
    manifest_commands = {
        command["name"]
        for command in OA_CONTRACT_GOVERNANCE_MANIFEST["commands"]
    }
    help_result = CliRunner().invoke(app, ["--help"])

    assert help_result.exit_code == 0
    for command_name in sorted(manifest_commands):
        assert command_name in help_result.stdout


def test_cli_manifest_matches_repo_spec() -> None:
    repo_root = Path(__file__).resolve().parents[5]
    repo_manifest_path = repo_root / "docs" / "cli-spec" / "oa-contract.governance.json"
    if not repo_manifest_path.exists():
        return

    assert json.loads(repo_manifest_path.read_text()) == OA_CONTRACT_GOVERNANCE_MANIFEST


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


def test_emit_openapi_target_option_filters_output(tmp_path, monkeypatch) -> None:
    fixture = tmp_path / "target_fixture.py"
    fixture.write_text(
        """
from oa_interface_contracts import ContractRegistry
from pydantic import BaseModel


class Widget(BaseModel):
    id: str


class AdminWidget(BaseModel):
    id: str
    permissions: list[str]


class InternalWidget(BaseModel):
    id: str
    shard: str


registry = ContractRegistry(name="Widgets API", version="1.0.0")
registry.public_target()
registry.admin_target()
registry.internal_target()
registry.model("Widget", Widget, audience="public")
registry.model("AdminWidget", AdminWidget, audience="admin")
registry.model("InternalWidget", InternalWidget, audience="internal")
registry.endpoint(
    method="get",
    path="/widgets",
    operation_id="list_widgets",
    response_model="Widget",
    targets=["public"],
)
registry.endpoint(
    method="get",
    path="/admin/widgets",
    operation_id="list_admin_widgets",
    response_model="AdminWidget",
    targets=["admin"],
)
registry.endpoint(
    method="get",
    path="/internal/widgets",
    operation_id="list_internal_widgets",
    response_model="InternalWidget",
    targets=["internal"],
)
"""
    )
    monkeypatch.syspath_prepend(str(tmp_path))

    result = CliRunner().invoke(
        app,
        ["emit-openapi", "target_fixture:registry", "--target", "public"],
    )

    assert result.exit_code == 0
    document = json.loads(result.stdout)
    assert list(document["paths"]) == ["/widgets"]
    assert list(document["components"]["schemas"]) == ["Widget"]


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


def test_snapshot_command_writes_stable_snapshot_with_toolkit_metadata(
    tmp_path,
    monkeypatch,
) -> None:
    fixture = tmp_path / "snapshot_fixture.py"
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
    snapshot_path = tmp_path / "contracts" / "widgets" / "contract.json"
    runner = CliRunner()

    first = runner.invoke(
        app,
        ["snapshot", "snapshot_fixture:registry", "--output", str(snapshot_path)],
    )
    first_payload = snapshot_path.read_text()
    second = runner.invoke(
        app,
        ["snapshot", "snapshot_fixture:registry", "--output", str(snapshot_path)],
    )
    payload = json.loads(first_payload)

    assert first.exit_code == 0
    assert second.exit_code == 0
    assert snapshot_path.read_text() == first_payload
    assert payload["format"] == "oa-contract-snapshot"
    assert payload["snapshot_version"] == 1
    assert payload["toolkit"]["oa-interface-cli"]
    assert payload["toolkit"]["oa-interface-contracts"]
    assert payload["contract"]["name"] == "Widgets API"


def test_snapshot_can_feed_existing_contract_commands(tmp_path, monkeypatch) -> None:
    fixture = tmp_path / "snapshot_gate_fixture.py"
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
    snapshot_path = tmp_path / "contract.json"
    runner = CliRunner()
    snapshot_result = runner.invoke(
        app,
        ["snapshot", "snapshot_gate_fixture:registry", "--output", str(snapshot_path)],
    )

    validate_result = runner.invoke(app, ["validate", str(snapshot_path)])
    diff_result = runner.invoke(app, ["diff", str(snapshot_path), str(snapshot_path)])
    module_openapi_result = runner.invoke(
        app,
        ["emit-openapi", "snapshot_gate_fixture:registry"],
    )
    snapshot_openapi_result = runner.invoke(app, ["emit-openapi", str(snapshot_path)])
    review_result = runner.invoke(
        app,
        ["review", str(snapshot_path), str(snapshot_path), "--format", "json"],
    )
    review_payload = json.loads(review_result.stdout)

    assert snapshot_result.exit_code == 0
    assert validate_result.exit_code == 0
    assert diff_result.exit_code == 0
    assert "No contract changes detected" in diff_result.stdout
    assert module_openapi_result.exit_code == 0
    assert snapshot_openapi_result.exit_code == 0
    assert json.loads(snapshot_openapi_result.stdout) == json.loads(module_openapi_result.stdout)
    assert review_result.exit_code == 0
    assert review_payload["recommendation"] == "COMMENT"


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


def test_check_artifact_supports_target_specific_artifacts(tmp_path) -> None:
    contract_path = tmp_path / "contract.json"
    artifact_path = tmp_path / "contracts" / "widgets-api" / "openapi.public.json"
    contract_path.write_text(
        json.dumps(
            {
                "name": "Widgets API",
                "version": "1.0.0",
                "targets": [
                    {"name": "public", "public": True},
                    {"name": "admin"},
                ],
                "endpoints": [
                    {
                        "method": "get",
                        "path": "/widgets",
                        "operation_id": "list_widgets",
                        "targets": ["public"],
                    },
                    {
                        "method": "get",
                        "path": "/admin/widgets",
                        "operation_id": "list_admin_widgets",
                        "targets": ["admin"],
                    },
                ],
                "schemas": {},
            }
        )
    )
    runner = CliRunner()
    emit_result = runner.invoke(
        app,
        [
            "emit-openapi",
            str(contract_path),
            "--target",
            "public",
            "--output",
            str(artifact_path),
        ],
    )

    result = runner.invoke(
        app,
        ["check-artifact", str(contract_path), str(artifact_path), "--target", "public"],
    )
    full_contract_result = runner.invoke(
        app,
        ["check-artifact", str(contract_path), str(artifact_path)],
    )

    assert emit_result.exit_code == 0
    assert result.exit_code == 0
    assert "fresh" in result.stdout
    assert full_contract_result.exit_code == 1
    assert "stale" in full_contract_result.stdout


def test_diff_output_separates_breaking_and_non_breaking_changes(tmp_path) -> None:
    base_path = tmp_path / "base.contract.json"
    head_path = tmp_path / "head.contract.json"
    base_path.write_text(
        json.dumps(
            {
                "name": "Users API",
                "version": "1.0.0",
                "endpoints": [
                    {
                        "method": "get",
                        "path": "/users",
                        "operation_id": "list_users",
                        "response_model": "User",
                    }
                ],
                "schemas": {
                    "User": {
                        "type": "object",
                        "properties": {"id": {"type": "string"}},
                    }
                },
            }
        )
    )
    head_path.write_text(
        json.dumps(
            {
                "name": "Users API",
                "version": "1.1.0",
                "endpoints": [
                    {
                        "method": "get",
                        "path": "/users",
                        "operation_id": "search_users",
                        "response_model": "User",
                    },
                    {
                        "method": "get",
                        "path": "/status",
                        "operation_id": "get_status",
                    },
                ],
                "schemas": {
                    "User": {
                        "type": "object",
                        "properties": {
                            "id": {"type": "string"},
                            "display_name": {"type": "string"},
                        },
                    }
                },
            }
        )
    )

    result = CliRunner().invoke(app, ["diff", str(base_path), str(head_path)])

    assert result.exit_code == 0
    assert "Breaking changes" in result.stdout
    assert "operation-id-changed" in result.stdout
    assert "Non-breaking changes" in result.stdout
    assert "endpoint-added" in result.stdout
    assert "response-field-added" in result.stdout


def test_diff_fail_on_breaking_allows_non_breaking_changes(tmp_path) -> None:
    base_path = tmp_path / "base.contract.json"
    head_path = tmp_path / "head.contract.json"
    base_path.write_text(
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
    head_path.write_text(
        json.dumps(
            {
                "name": "Users API",
                "version": "1.1.0",
                "endpoints": [
                    {
                        "method": "get",
                        "path": "/users",
                        "operation_id": "list_users",
                    },
                    {
                        "method": "get",
                        "path": "/status",
                        "operation_id": "get_status",
                    },
                ],
                "schemas": {},
            }
        )
    )

    result = CliRunner().invoke(
        app,
        ["diff", str(base_path), str(head_path), "--fail-on-breaking"],
    )

    assert result.exit_code == 0
    assert "No breaking changes detected" in result.stdout
    assert "Non-breaking changes" in result.stdout


def test_diff_fail_on_breaking_exits_nonzero_for_breaking_changes(tmp_path) -> None:
    base_path = tmp_path / "base.contract.json"
    head_path = tmp_path / "head.contract.json"
    base_path.write_text(
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
    head_path.write_text(
        json.dumps(
            {
                "name": "Users API",
                "version": "1.1.0",
                "endpoints": [],
                "schemas": {},
            }
        )
    )

    result = CliRunner().invoke(
        app,
        ["diff", str(base_path), str(head_path), "--fail-on-breaking"],
    )

    assert result.exit_code == 1
    assert "Breaking changes" in result.stdout
    assert "endpoint-removed" in result.stdout


def test_drift_command_accepts_matching_example_app() -> None:
    result = CliRunner().invoke(
        app,
        [
            "drift",
            "--app",
            "example_api.main:app",
            "--contract",
            "example_api.contracts:registry",
            "--adapter",
            "fastapi",
        ],
    )

    assert result.exit_code == 0
    assert "No FastAPI drift detected" in result.stdout


def _write_drift_fixture(tmp_path):
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
    return fixture


def test_drift_command_exits_nonzero_when_drift_exists(tmp_path, monkeypatch) -> None:
    _write_drift_fixture(tmp_path)
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


def test_drift_command_supports_json_output(tmp_path, monkeypatch) -> None:
    _write_drift_fixture(tmp_path)
    monkeypatch.syspath_prepend(str(tmp_path))

    result = CliRunner().invoke(
        app,
        [
            "drift",
            "--app",
            "drift_fixture:app",
            "--contract",
            "drift_fixture:contract",
            "--format",
            "json",
        ],
    )

    payload = json.loads(result.stdout)
    assert result.exit_code == 1
    assert payload["drift"] is True
    assert payload["issues"][0]["code"] == "operation-id-drift"


def test_drift_command_supports_markdown_output(tmp_path, monkeypatch) -> None:
    _write_drift_fixture(tmp_path)
    monkeypatch.syspath_prepend(str(tmp_path))

    result = CliRunner().invoke(
        app,
        [
            "drift",
            "--app",
            "drift_fixture:app",
            "--contract",
            "drift_fixture:contract",
            "--format",
            "markdown",
        ],
    )

    assert result.exit_code == 1
    assert "## FastAPI Drift" in result.stdout
    assert "| Code | Location | Detail |" in result.stdout
    assert "operation-id-drift" in result.stdout


def test_review_command_supports_clean_json_report(tmp_path) -> None:
    artifact_path = tmp_path / "contracts" / "example-api" / "openapi.json"
    runner = CliRunner()
    emit_result = runner.invoke(
        app,
        [
            "emit-openapi",
            "example_api.main:contract",
            "--output",
            str(artifact_path),
        ],
    )

    result = runner.invoke(
        app,
        [
            "review",
            "example_api.main:contract",
            "example_api.main:contract",
            "--app",
            "example_api.main:app",
            "--artifact",
            str(artifact_path),
            "--format",
            "json",
        ],
    )
    payload = json.loads(result.stdout)

    assert emit_result.exit_code == 0
    assert result.exit_code == 0
    assert payload["recommendation"] == "APPROVE"
    assert payload["diff"]["breaking"] == []
    assert payload["diff"]["non_breaking"] == []
    assert payload["drift"]["issues"] == []
    assert payload["artifact"]["fresh"] is True
    assert payload["validation"]["issues"] == []


def test_review_imports_app_before_loading_registry_references(tmp_path, monkeypatch) -> None:
    contracts_fixture = tmp_path / "review_contracts_fixture.py"
    contracts_fixture.write_text(
        """
from oa_interface_contracts import ContractRegistry
from pydantic import BaseModel


class Widget(BaseModel):
    id: str


registry = ContractRegistry(name="Widgets API", version="1.0.0")
registry.model("Widget", Widget)
"""
    )
    app_fixture = tmp_path / "review_app_fixture.py"
    app_fixture.write_text(
        """
from fastapi import FastAPI

from review_contracts_fixture import Widget, registry


app = FastAPI(title="Widgets API", version="1.0.0")


@registry.route(
    method="get",
    path="/widgets/{widget_id}",
    operation_id="get_widget",
    response_model="Widget",
    path_params=["widget_id"],
)
@app.get("/widgets/{widget_id}", response_model=Widget, operation_id="get_widget")
def get_widget(widget_id: str) -> Widget:
    return Widget(id=widget_id)
"""
    )
    monkeypatch.syspath_prepend(str(tmp_path))

    result = CliRunner().invoke(
        app,
        [
            "review",
            "review_contracts_fixture:registry",
            "review_contracts_fixture:registry",
            "--app",
            "review_app_fixture:app",
            "--format",
            "json",
        ],
    )
    payload = json.loads(result.stdout)

    assert result.exit_code == 0
    assert payload["recommendation"] == "COMMENT"
    assert payload["summary"]["checks_incomplete"] is True
    assert payload["drift"]["issues"] == []


def test_review_target_ignores_runtime_routes_outside_target(tmp_path, monkeypatch) -> None:
    fixture = tmp_path / "review_target_fixture.py"
    fixture.write_text(
        """
from fastapi import FastAPI
from oa_interface_contracts import ContractRegistry
from pydantic import BaseModel


class PublicWidget(BaseModel):
    id: str


class AdminWidget(BaseModel):
    id: str


registry = ContractRegistry(name="Widgets API", version="1.0.0")
registry.public_target()
registry.admin_target()
registry.model("PublicWidget", PublicWidget, audience="public")
registry.model("AdminWidget", AdminWidget, audience="admin")

app = FastAPI(title="Widgets API", version="1.0.0")


@registry.route(
    method="get",
    path="/widgets/{widget_id}",
    operation_id="get_widget",
    response_model="PublicWidget",
    targets=["public"],
    path_params=["widget_id"],
)
@app.get("/widgets/{widget_id}", response_model=PublicWidget, operation_id="get_widget")
def get_widget(widget_id: str) -> PublicWidget:
    return PublicWidget(id=widget_id)


@registry.route(
    method="get",
    path="/admin/widgets/{widget_id}",
    operation_id="get_admin_widget",
    response_model="AdminWidget",
    targets=["admin"],
    path_params=["widget_id"],
)
@app.get(
    "/admin/widgets/{widget_id}",
    response_model=AdminWidget,
    operation_id="get_admin_widget",
)
def get_admin_widget(widget_id: str) -> AdminWidget:
    return AdminWidget(id=widget_id)


contract = registry.to_spec()
"""
    )
    monkeypatch.syspath_prepend(str(tmp_path))

    result = CliRunner().invoke(
        app,
        [
            "review",
            "review_target_fixture:contract",
            "review_target_fixture:contract",
            "--app",
            "review_target_fixture:app",
            "--target",
            "public",
            "--format",
            "json",
        ],
    )
    payload = json.loads(result.stdout)

    assert result.exit_code == 0
    assert payload["recommendation"] == "COMMENT"
    assert payload["drift"]["issues"] == []


def test_review_command_markdown_report_orders_failing_sections(tmp_path, monkeypatch) -> None:
    fixture = tmp_path / "review_fixture.py"
    fixture.write_text(
        """
from fastapi import FastAPI


app = FastAPI(title="Users API", version="2.0.0")


@app.get("/status", operation_id="runtime_status")
def get_status() -> dict[str, str]:
    return {"status": "ok"}
"""
    )
    monkeypatch.syspath_prepend(str(tmp_path))
    base_path = tmp_path / "base.contract.json"
    head_path = tmp_path / "head.contract.json"
    artifact_path = tmp_path / "contracts" / "users-api" / "openapi.json"
    base_path.write_text(
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
    head_path.write_text(
        json.dumps(
            {
                "name": "Users API",
                "version": "2.0.0",
                "endpoints": [
                    {
                        "method": "get",
                        "path": "/status",
                        "operation_id": "get_status",
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
                "info": {"title": "Users API", "version": "2.0.0"},
                "paths": {},
                "components": {"schemas": {}},
                "x-oa-contract-hash": "sha256:stale",
            }
        )
    )

    result = CliRunner().invoke(
        app,
        [
            "review",
            str(base_path),
            str(head_path),
            "--app",
            "review_fixture:app",
            "--artifact",
            str(artifact_path),
            "--format",
            "markdown",
        ],
    )

    assert result.exit_code == 1
    assert "Recommendation: **REQUEST_CHANGES**" in result.stdout
    assert "endpoint-removed" in result.stdout
    assert "operation-id-drift" in result.stdout
    assert "**stale**" in result.stdout
    assert "endpoint-added" in result.stdout
    assert result.stdout.index("## Breaking Changes") < result.stdout.index("## Drift Issues")
    assert result.stdout.index("## Drift Issues") < result.stdout.index("## Artifact Freshness")
    assert result.stdout.index("## Artifact Freshness") < result.stdout.index(
        "## Non-breaking Changes"
    )
