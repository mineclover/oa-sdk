from typing import Annotated, Any

from fastapi import FastAPI, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .contracts import registry
from .models import CreateUser, ErrorResponse, User

app = FastAPI(title=registry.name, version=registry.version)
bearer_auth = HTTPBearer(scheme_name="BearerAuth")
BearerCredentials = Annotated[HTTPAuthorizationCredentials, Security(bearer_auth)]
ERROR_RESPONSES: dict[int | str, dict[str, Any]] = {
    401: {
        "model": ErrorResponse,
        "description": "Authentication required.",
    },
}


@registry.route(
    method="post",
    path="/users",
    operation_id="create_user",
    request_model="CreateUser",
    response_model="User",
    security=["BearerAuth"],
    request_examples=["create_user_request"],
    response_examples=["created_user_response"],
    error_responses=["Unauthorized"],
    targets=["public"],
)
@app.post(
    "/users",
    response_model=User,
    operation_id="create_user",
    responses=ERROR_RESPONSES,
)
def create_user(body: CreateUser, _credentials: BearerCredentials) -> User:
    return User(id="usr_1", email=body.email)


contract = registry.to_spec()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)
