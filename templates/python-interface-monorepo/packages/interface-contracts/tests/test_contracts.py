import json

from oa_interface_contracts import (
    ContractEndpoint,
    ContractResponse,
    ContractSecurityScheme,
    ContractSpec,
    diff_contracts,
    emit_openapi,
)
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


def test_emit_openapi_is_deterministic_and_sorted() -> None:
    contract = ContractSpec(
        name="Stable API",
        version="1.0.0",
        schemas={
            "Widget": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "id": {"type": "string"},
                },
            },
            "ErrorBody": {"type": "object"},
        },
        security_schemes={
            "ZAuth": ContractSecurityScheme(type="http", scheme="bearer"),
            "ApiKeyAuth": ContractSecurityScheme(
                type="apiKey",
                name="X-API-Key",
                location="header",
            ),
        },
        standard_error_responses={
            "Unauthorized": ContractResponse(
                status_code="401",
                description="Authentication required.",
                model="ErrorBody",
            )
        },
        endpoints=[
            ContractEndpoint(
                method="post",
                path="/widgets",
                operation_id="create_widget",
                response_model="Widget",
                tags=["write", "widgets"],
                security=[{"ZAuth": ["widgets:write", "widgets:read"]}, {"ApiKeyAuth": []}],
            ),
            ContractEndpoint(
                method="get",
                path="/health",
                operation_id="get_health",
                tags=["system"],
            ),
            ContractEndpoint(
                method="get",
                path="/widgets",
                operation_id="list_widgets",
                success_responses=[
                    ContractResponse(
                        status_code="default",
                        description="Unexpected error.",
                        model="ErrorBody",
                    ),
                    ContractResponse(
                        status_code="200",
                        description="Widgets listed.",
                        model="Widget",
                    ),
                ],
                error_responses=["Unauthorized"],
                tags=["widgets", "read"],
            ),
        ],
    )

    first_document = emit_openapi(contract)
    second_document = emit_openapi(contract)
    first_json = json.dumps(first_document, indent=2, sort_keys=True)
    second_json = json.dumps(second_document, indent=2, sort_keys=True)

    assert first_json == second_json
    assert list(first_document["paths"]) == ["/health", "/widgets"]
    assert list(first_document["paths"]["/widgets"]) == ["get", "post"]
    assert list(first_document["components"]["schemas"]) == ["ErrorBody", "Widget"]
    assert list(first_document["components"]["securitySchemes"]) == ["ApiKeyAuth", "ZAuth"]
    assert list(first_document["paths"]["/widgets"]["get"]["responses"]) == [
        "200",
        "401",
        "default",
    ]
    assert first_document["paths"]["/widgets"]["post"]["tags"] == ["widgets", "write"]
    assert first_document["tags"] == [
        {"name": "read"},
        {"name": "system"},
        {"name": "widgets"},
        {"name": "write"},
    ]
    assert first_document["x-oa-contract-hash"].startswith("sha256:")


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
