from fastapi import FastAPI

from .contracts import registry
from .models import CreateUser, User

app = FastAPI(title=registry.name, version=registry.version)


@registry.route(
    method="post",
    path="/users",
    operation_id="create_user",
    request_model="CreateUser",
    response_model="User",
)
@app.post("/users", response_model=User, operation_id="create_user")
def create_user(body: CreateUser) -> User:
    return User(id="usr_1", email=body.email)


contract = registry.to_spec()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)
