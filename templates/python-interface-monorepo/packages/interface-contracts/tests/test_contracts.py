from oa_interface_contracts import ContractEndpoint, ContractSpec, diff_contracts, emit_openapi
from oa_interface_contracts.openapi import schema_from_model
from pydantic import BaseModel, EmailStr


class User(BaseModel):
    id: str
    email: EmailStr


class CreateUser(BaseModel):
    email: EmailStr


def test_emit_openapi_from_contract_spec() -> None:
    contract = ContractSpec(
        name="Users API",
        version="1.0.0",
        schemas={
            "User": schema_from_model(User),
            "CreateUser": schema_from_model(CreateUser),
        },
        endpoints=[
            ContractEndpoint(
                method="post",
                path="/users",
                operation_id="create_user",
                request_model="CreateUser",
                response_model="User",
            )
        ],
    )

    document = emit_openapi(contract)

    assert document["openapi"] == "3.1.0"
    assert document["paths"]["/users"]["post"]["operationId"] == "create_user"
    assert document["components"]["schemas"]["User"]["required"] == ["id", "email"]


def test_diff_contracts_flags_required_field_addition() -> None:
    base = ContractSpec(
        name="Users API",
        version="1.0.0",
        endpoints=[ContractEndpoint(method="get", path="/users", operation_id="list_users")],
        schemas={"User": {"type": "object", "required": ["id"]}},
    )
    head = ContractSpec(
        name="Users API",
        version="1.1.0",
        endpoints=[ContractEndpoint(method="get", path="/users", operation_id="search_users")],
        schemas={"User": {"type": "object", "required": ["id", "email"]}},
    )

    changes = diff_contracts(base, head)

    assert [change.code for change in changes] == [
        "operation-id-changed",
        "required-field-added",
    ]
