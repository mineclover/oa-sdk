import json

import pytest
from oa_interface_contracts import (
    ContractRegistry,
    assert_contract_valid,
    assert_openapi_artifact_current,
    emit_openapi,
)
from pydantic import BaseModel


class Widget(BaseModel):
    id: str


def _valid_registry() -> ContractRegistry:
    registry = ContractRegistry(name="Widgets API", version="1.0.0")
    registry.model("Widget", Widget)
    registry.endpoint(
        method="get",
        path="/widgets/{widget_id}",
        operation_id="get_widget",
        response_model="Widget",
        path_params=["widget_id"],
    )
    return registry


def test_assert_contract_valid_accepts_direct_registry_and_module_reference(
    tmp_path,
    monkeypatch,
) -> None:
    assert_contract_valid(_valid_registry())

    fixture = tmp_path / "contract_gate_fixture.py"
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

    assert_contract_valid("contract_gate_fixture:registry")


def test_assert_contract_valid_reports_useful_assertion_message() -> None:
    registry = ContractRegistry(name="Widgets API", version="1.0.0")
    registry.endpoint(method="get", path="/widgets", operation_id="list_widgets")
    registry.endpoint(method="post", path="/widgets", operation_id="list_widgets")

    with pytest.raises(AssertionError) as exc_info:
        assert_contract_valid(registry)

    message = str(exc_info.value)
    assert "Contract validation failed for ContractRegistry with 1 issue" in message
    assert "duplicate-operation-id" in message
    assert "operation_id list_widgets is used by GET /widgets, POST /widgets." in message


def test_assert_openapi_artifact_current_accepts_direct_and_module_sources(
    tmp_path,
    monkeypatch,
) -> None:
    registry = _valid_registry()
    artifact = tmp_path / "openapi.json"
    artifact.write_text(json.dumps(emit_openapi(registry.to_spec()), indent=2, sort_keys=True))

    assert_openapi_artifact_current(registry, artifact)

    fixture = tmp_path / "artifact_gate_fixture.py"
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

    assert_openapi_artifact_current("artifact_gate_fixture:registry", artifact)


def test_assert_openapi_artifact_current_reports_stale_artifact(tmp_path) -> None:
    registry = _valid_registry()
    artifact = tmp_path / "openapi.json"
    artifact.write_text(
        json.dumps(
            {
                "openapi": "3.1.0",
                "info": {"title": "Widgets API", "version": "1.0.0"},
                "paths": {},
                "components": {"schemas": {}},
                "x-oa-contract-hash": "sha256:stale",
            }
        )
    )

    with pytest.raises(AssertionError) as exc_info:
        assert_openapi_artifact_current(registry, artifact)

    message = str(exc_info.value)
    assert "OpenAPI artifact is stale for ContractRegistry" in message
    assert "hash mismatch" in message
    assert "paths: 1 missing" in message
    assert "expected_hash: sha256:" in message
    assert "actual_hash: sha256:stale" in message
