import json

from oa_interface_contracts import (
    ContractEndpoint,
    ContractResponse,
    ContractSecurityScheme,
    ContractSpec,
    ContractTarget,
    diff_contract_changes,
    diff_contracts,
    emit_openapi,
    validate_contract_spec,
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


def test_emit_openapi_target_filters_transitively_reachable_schemas() -> None:
    contract = ContractSpec(
        name="Users API",
        version="1.0.0",
        targets=[ContractTarget(name="public", public=True)],
        schemas={
            "Envelope": {
                "type": "object",
                "properties": {
                    "user": {"$ref": "#/components/schemas/User"},
                },
            },
            "Unused": {"type": "object"},
            "User": {
                "type": "object",
                "x-oa-audience": "public",
                "properties": {
                    "id": {"type": "string"},
                },
            },
        },
        endpoints=[
            ContractEndpoint(
                method="get",
                path="/users",
                operation_id="list_users",
                response_model="Envelope",
                targets=["public"],
            )
        ],
    )

    document = emit_openapi(contract, target="public")

    assert list(document["components"]["schemas"]) == ["Envelope", "User"]


def test_validation_reports_transitive_public_internal_schema_leakage() -> None:
    contract = ContractSpec(
        name="Users API",
        version="1.0.0",
        targets=[ContractTarget(name="public", public=True)],
        schemas={
            "InternalSecret": {
                "type": "object",
                "x-oa-audience": "internal",
                "x-internal-only": True,
            },
            "PublicEnvelope": {
                "type": "object",
                "properties": {
                    "secret": {"$ref": "#/components/schemas/InternalSecret"},
                },
            },
        },
        endpoints=[
            ContractEndpoint(
                method="get",
                path="/leak",
                operation_id="get_leak",
                response_model="PublicEnvelope",
                targets=["public"],
            )
        ],
    )

    issues = validate_contract_spec(contract)

    assert [issue.code for issue in issues] == ["public-internal-model"]
    assert "internal-only model InternalSecret" in issues[0].detail


def test_diff_contracts_classifies_breaking_and_non_breaking_changes() -> None:
    base = ContractSpec(
        name="Users API",
        version="1.0.0",
        standard_error_responses={
            "Unauthorized": ContractResponse(
                status_code="401",
                description="Authentication required.",
                model="ErrorBody",
            )
        },
        endpoints=[
            ContractEndpoint(
                method="get",
                path="/users",
                operation_id="list_users",
                response_model="User",
            ),
            ContractEndpoint(
                method="post",
                path="/users",
                operation_id="create_user",
                request_model="CreateUser",
                success_responses=[
                    ContractResponse(status_code="201", description="Created.", model="User"),
                    ContractResponse(status_code="202", description="Accepted.", model="Job"),
                ],
                error_responses=["Unauthorized"],
            ),
            ContractEndpoint(
                method="put",
                path="/users/{user_id}",
                operation_id="replace_user",
                request_model="ReplaceUser",
                response_model="User",
            ),
            ContractEndpoint(
                method="get",
                path="/profile",
                operation_id="get_profile",
                response_model="User",
            ),
            ContractEndpoint(method="get", path="/legacy", operation_id="get_legacy"),
        ],
        schemas={
            "CreateUser": {
                "type": "object",
                "required": ["email"],
                "properties": {
                    "email": {"type": "string"},
                },
            },
            "ErrorBody": {"type": "object"},
            "Job": {"type": "object"},
            "ReplaceUser": {"type": "object"},
            "ReplaceUserV2": {"type": "object"},
            "User": {
                "type": "object",
                "required": ["id", "email"],
                "properties": {
                    "id": {"type": "string"},
                    "email": {"type": "string"},
                    "role": {"type": "string", "enum": ["admin", "member", "guest"]},
                    "score": {"type": ["integer", "string"]},
                    "nickname": {"anyOf": [{"type": "string"}, {"type": "null"}]},
                },
            },
            "UserSummary": {"type": "object"},
        },
    )
    head = ContractSpec(
        name="Users API",
        version="1.1.0",
        standard_error_responses=base.standard_error_responses,
        endpoints=[
            ContractEndpoint(
                method="get",
                path="/users",
                operation_id="search_users",
                response_model="User",
                security=[{"BearerAuth": []}],
            ),
            ContractEndpoint(
                method="post",
                path="/users",
                operation_id="create_user",
                request_model="CreateUser",
                success_responses=[
                    ContractResponse(status_code="201", description="Created.", model="User"),
                    ContractResponse(status_code="206", description="Partial.", model="User"),
                ],
                error_responses=["Unauthorized"],
            ),
            ContractEndpoint(
                method="put",
                path="/users/{user_id}",
                operation_id="replace_user",
                request_model="ReplaceUserV2",
                response_model="User",
            ),
            ContractEndpoint(
                method="get",
                path="/profile",
                operation_id="get_profile",
                response_model="UserSummary",
            ),
            ContractEndpoint(method="get", path="/status", operation_id="get_status"),
        ],
        schemas={
            "CreateUser": {
                "type": "object",
                "required": ["email", "name"],
                "properties": {
                    "email": {"type": "string"},
                    "name": {"type": "string"},
                    "timezone": {"type": "string"},
                },
            },
            "ErrorBody": {"type": "object"},
            "Job": {"type": "object"},
            "ReplaceUser": {"type": "object"},
            "ReplaceUserV2": {"type": "object"},
            "User": {
                "type": "object",
                "required": ["id"],
                "properties": {
                    "id": {"type": "string"},
                    "role": {"type": "string", "enum": ["admin", "member"]},
                    "score": {"type": "integer"},
                    "nickname": {"type": "string"},
                    "display_name": {"type": "string"},
                },
            },
            "UserSummary": {"type": "object"},
        },
    )

    result = diff_contract_changes(base, head)

    assert {change.code for change in result.breaking} == {
        "endpoint-removed",
        "operation-id-changed",
        "security-requirement-strengthened",
        "status-code-removed",
        "request-model-changed",
        "response-model-changed",
        "required-request-field-added",
        "response-field-removed",
        "enum-value-removed",
        "response-field-type-narrowed",
        "nullable-removed",
    }
    assert {change.code for change in result.non_breaking} == {
        "endpoint-added",
        "status-code-added",
        "optional-request-field-added",
        "response-field-added",
    }
    assert [change.code for change in diff_contracts(base, head)] == [
        change.code for change in result.breaking
    ]
