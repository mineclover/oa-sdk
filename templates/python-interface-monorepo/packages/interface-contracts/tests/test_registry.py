import pytest
from oa_interface_contracts import (
    ContractExample,
    ContractRegistry,
    ContractResponse,
    ContractSecurityScheme,
    ContractTarget,
    ContractValidationError,
    emit_openapi,
)
from pydantic import BaseModel, EmailStr


class User(BaseModel):
    id: str
    email: EmailStr


class CreateUser(BaseModel):
    email: EmailStr


class ErrorBody(BaseModel):
    code: str
    message: str


def test_registry_emits_deterministic_contract_spec() -> None:
    registry = ContractRegistry(name="Users API", version="1.0.0")
    registry.model("User", User)
    registry.model("CreateUser", CreateUser)
    registry.endpoint(
        method="get",
        path="/users/{user_id}",
        operation_id="get_user",
        response_model="User",
        path_params=["user_id"],
    )
    registry.endpoint(
        method="post",
        path="/users",
        operation_id="create_user",
        request_model="CreateUser",
        response_model="User",
    )

    contract = registry.to_spec()

    assert list(contract.schemas) == ["CreateUser", "User"]
    assert [endpoint.operation_id for endpoint in contract.endpoints] == [
        "create_user",
        "get_user",
    ]


def test_registry_route_decorator_registers_contract_and_preserves_function() -> None:
    registry = ContractRegistry(name="Users API", version="1.0.0")
    registry.model("CreateUser", CreateUser)
    registry.model("User", User)

    @registry.route(
        method="post",
        path="/users",
        operation_id="create_user",
        request_model="CreateUser",
        response_model="User",
    )
    def create_user(body: CreateUser) -> User:
        return User(id="usr_1", email=body.email)

    result = create_user(CreateUser(email="user@example.com"))
    contract = registry.to_spec()

    assert result.id == "usr_1"
    assert contract.endpoints[0].operation_id == "create_user"


def test_registry_defines_security_responses_examples_and_targets() -> None:
    registry = ContractRegistry(name="Users API", version="1.0.0")
    registry.model("CreateUser", CreateUser)
    registry.model("ErrorBody", ErrorBody)
    registry.model("User", User)
    registry.security_scheme(
        "BearerAuth",
        type="http",
        scheme="bearer",
        bearer_format="JWT",
        description="JWT bearer token.",
    )
    registry.example(
        "create_user_request",
        value={"email": "user@example.com"},
        summary="Create user",
    )
    registry.example(
        "created_user_response",
        value={"id": "usr_1", "email": "user@example.com"},
    )
    registry.example(
        "unauthorized_response",
        value={"code": "unauthorized", "message": "Authentication required."},
    )
    registry.error_response(
        "Unauthorized",
        status_code=401,
        description="Authentication required.",
        model="ErrorBody",
        examples=["unauthorized_response"],
    )
    registry.target("public", description="Public API")
    registry.endpoint(
        method="post",
        path="/users",
        operation_id="create_user",
        request_model="CreateUser",
        response_model="User",
        security=[{"BearerAuth": []}],
        request_examples=["create_user_request"],
        response_examples=["created_user_response"],
        error_responses=["Unauthorized"],
        targets=["public"],
    )

    contract = registry.to_spec()
    endpoint = contract.endpoints[0]
    document = emit_openapi(contract)
    operation = document["paths"]["/users"]["post"]

    assert isinstance(contract.examples["create_user_request"], ContractExample)
    assert isinstance(contract.security_schemes["BearerAuth"], ContractSecurityScheme)
    assert isinstance(contract.standard_error_responses["Unauthorized"], ContractResponse)
    assert contract.targets == [ContractTarget(name="public", description="Public API")]
    assert endpoint.targets == ["public"]
    assert document["components"]["securitySchemes"]["BearerAuth"] == {
        "type": "http",
        "description": "JWT bearer token.",
        "scheme": "bearer",
        "bearerFormat": "JWT",
    }
    assert document["components"]["responses"]["Unauthorized"]["content"]["application/json"][
        "examples"
    ] == {"unauthorized_response": {"$ref": "#/components/examples/unauthorized_response"}}
    assert operation["security"] == [{"BearerAuth": []}]
    assert operation["requestBody"]["content"]["application/json"]["examples"] == {
        "create_user_request": {"$ref": "#/components/examples/create_user_request"}
    }
    assert operation["responses"]["200"]["content"]["application/json"]["examples"] == {
        "created_user_response": {"$ref": "#/components/examples/created_user_response"}
    }
    assert operation["responses"]["401"] == {"$ref": "#/components/responses/Unauthorized"}


def test_registry_validation_reports_duplicate_operation_id_and_method_path() -> None:
    registry = ContractRegistry(name="Users API", version="1.0.0")
    registry.model("User", User)
    registry.endpoint(
        method="get",
        path="/users",
        operation_id="list_users",
        response_model="User",
    )
    registry.endpoint(
        method="get",
        path="/users",
        operation_id="list_users",
        response_model="User",
    )

    issues = registry.validate()

    assert [issue.code for issue in issues] == [
        "duplicate-method-path",
        "duplicate-operation-id",
    ]


def test_registry_validation_reports_missing_model_references() -> None:
    registry = ContractRegistry(name="Users API", version="1.0.0")
    registry.endpoint(
        method="post",
        path="/users",
        operation_id="create_user",
        request_model="CreateUser",
        response_model="User",
    )

    issues = registry.validate()

    assert [issue.code for issue in issues] == [
        "missing-request-model",
        "missing-response-model",
    ]


def test_registry_validation_reports_missing_authoring_references() -> None:
    registry = ContractRegistry(name="Users API", version="1.0.0")
    registry.target("public")
    registry.endpoint(
        method="post",
        path="/users",
        operation_id="create_user",
        security=[{"BearerAuth": []}],
        request_examples=["create_user_request"],
        response_examples=["created_user_response"],
        error_responses=["Unauthorized"],
        targets=["admin"],
    )

    issues = registry.validate()

    assert [issue.code for issue in issues] == [
        "missing-error-response",
        "missing-request-example",
        "missing-response-example",
        "missing-security-scheme",
        "unknown-target",
    ]


def test_registry_validation_reports_path_parameter_mismatches_when_declared() -> None:
    registry = ContractRegistry(name="Users API", version="1.0.0")
    registry.model("User", User)
    registry.endpoint(
        method="get",
        path="/users/{user_id}/orders/{order_id}",
        operation_id="get_user_order",
        response_model="User",
        path_params=["user_id", "extra_id", "extra_id"],
    )
    registry.endpoint(
        method="get",
        path="/users/{user_id}/profile",
        operation_id="get_user_profile",
        response_model="User",
    )

    issues = registry.validate()

    assert [issue.code for issue in issues] == [
        "duplicate-path-parameter",
        "missing-path-parameter",
        "unknown-path-parameter",
    ]
    assert issues[1].detail == "Path parameter order_id appears in the path but is not declared."


def test_registry_to_spec_raises_when_invalid() -> None:
    registry = ContractRegistry(name="Users API", version="1.0.0")
    registry.endpoint(
        method="get",
        path="/users",
        operation_id="list_users",
        response_model="User",
    )

    with pytest.raises(ContractValidationError) as exc_info:
        registry.to_spec()

    assert [issue.code for issue in exc_info.value.issues] == ["missing-response-model"]
