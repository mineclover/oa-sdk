from pathlib import Path

from example_api.contracts import registry
from example_api.main import app, contract
from oa_interface_contracts import assert_contract_valid, assert_openapi_artifact_current
from oa_interface_fastapi import assert_no_fastapi_drift

WORKSPACE_ROOT = Path(__file__).resolve().parents[3]
OPENAPI_ARTIFACT = WORKSPACE_ROOT / "contracts" / "example-api" / "openapi.json"


def test_example_app_exposes_contract() -> None:
    assert contract.name == "Example Users API"
    assert contract.endpoints[0].operation_id == "create_user"
    assert contract.endpoints[0].security == [{"BearerAuth": []}]
    assert contract.security_schemes["BearerAuth"].scheme == "bearer"
    assert registry.to_contract() == contract
    assert registry.to_spec() == contract


def test_example_contract_gate() -> None:
    assert_contract_valid("example_api.main:contract")
    assert_no_fastapi_drift(app, contract)
    assert_openapi_artifact_current("example_api.main:contract", OPENAPI_ARTIFACT)
