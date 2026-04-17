from pathlib import Path

from example_api.contracts import registry
from example_api.main import app, contract, create_user
from example_api.models import CreateUser, User
from fastapi.security import HTTPAuthorizationCredentials
from oa_interface_contracts import assert_contract_valid, assert_openapi_artifact_current
from oa_interface_fastapi import assert_no_fastapi_drift

WORKSPACE_ROOT = Path(__file__).resolve().parents[3]
OPENAPI_ARTIFACT = WORKSPACE_ROOT / "contracts" / "example-api" / "openapi.json"


def test_example_registry_exposes_governed_contract() -> None:
    endpoint = contract.endpoints[0]
    public_target = contract.targets[0]
    unauthorized = contract.standard_error_responses["Unauthorized"]

    assert contract.name == "Example Users API"
    assert endpoint.operation_id == "create_user"
    assert endpoint.security == [{"BearerAuth": []}]
    assert endpoint.error_responses == ["Unauthorized"]
    assert endpoint.targets == ["public"]
    assert contract.security_schemes["BearerAuth"].scheme == "bearer"
    assert unauthorized.status_code == "401"
    assert unauthorized.model == "ErrorResponse"
    assert public_target.name == "public"
    assert public_target.public is True
    assert public_target.required_error_responses == ["Unauthorized"]
    assert contract.schemas["CreateUser"]["x-oa-audience"] == "public"
    assert contract.schemas["ErrorResponse"]["x-oa-audience"] == "public"
    assert contract.schemas["User"]["x-oa-audience"] == "public"
    assert registry.to_contract() == contract
    assert registry.to_spec() == contract


def test_example_fastapi_route_matches_reference_contract() -> None:
    result = create_user(
        CreateUser(email="new-user@example.com"),
        HTTPAuthorizationCredentials(scheme="Bearer", credentials="token"),
    )
    operation = app.openapi()["paths"]["/users"]["post"]

    assert result == User(id="usr_1", email="new-user@example.com")
    assert operation["operationId"] == "create_user"
    assert operation["security"] == [{"BearerAuth": []}]
    assert "401" in operation["responses"]


def test_example_fastapi_drift_gate_is_clean() -> None:
    assert_no_fastapi_drift(app, contract)


def test_example_contract_gate() -> None:
    assert_contract_valid("example_api.main:contract")
    assert_openapi_artifact_current("example_api.main:contract", OPENAPI_ARTIFACT)
