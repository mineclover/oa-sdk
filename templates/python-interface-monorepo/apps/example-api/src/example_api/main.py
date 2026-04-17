from typing import Annotated

from fastapi import FastAPI, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .contracts import registry
from .models import CreateUser, User

app = FastAPI(title=registry.name, version=registry.version)
bearer_auth = HTTPBearer(scheme_name="BearerAuth")
BearerCredentials = Annotated[HTTPAuthorizationCredentials, Security(bearer_auth)]


@registry.route(
    method="post",
    path="/users",
    operation_id="create_user",
    request_model="CreateUser",
    response_model="User",
    security=["BearerAuth"],
)
@app.post("/users", response_model=User, operation_id="create_user")
def create_user(body: CreateUser, _credentials: BearerCredentials) -> User:
    return User(id="usr_1", email=body.email)


contract = registry.to_spec()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)
