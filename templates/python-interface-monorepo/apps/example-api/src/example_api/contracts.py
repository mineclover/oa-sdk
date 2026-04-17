from oa_interface_contracts import ContractRegistry

from .models import CreateUser, ErrorResponse, User

registry = ContractRegistry(name="Example Users API", version="1.0.0")
registry.bearer_security_scheme(
    "BearerAuth",
    bearer_format="JWT",
    description="JWT bearer token.",
)
registry.public_target(
    description="Public user-management API.",
    required_error_responses=["Unauthorized"],
)
registry.model("CreateUser", CreateUser, audience="public")
registry.model("ErrorResponse", ErrorResponse, audience="public")
registry.model("User", User, audience="public")
registry.example(
    "create_user_request",
    value={"email": "user@example.com"},
    summary="Create user request",
)
registry.example(
    "created_user_response",
    value={"id": "usr_1", "email": "user@example.com"},
    summary="Created user response",
)
registry.example(
    "unauthorized_response",
    value={"code": "unauthorized", "message": "Authentication required."},
    summary="Unauthorized response",
)
registry.error_response(
    "Unauthorized",
    status_code=401,
    description="Authentication required.",
    model="ErrorResponse",
    examples=["unauthorized_response"],
)
