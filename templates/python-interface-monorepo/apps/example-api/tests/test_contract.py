from example_api.contracts import registry
from example_api.main import contract


def test_example_app_exposes_contract() -> None:
    assert contract.name == "Example Users API"
    assert contract.endpoints[0].operation_id == "create_user"
    assert registry.to_contract() == contract
    assert registry.to_spec() == contract
