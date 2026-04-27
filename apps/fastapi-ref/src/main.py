from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi import FastAPI, HTTPException, status
from fastapi.responses import JSONResponse

from .models import (
    ApiError,
    CreateUserRequest,
    HealthStatus,
    UpdateUserRequest,
    User,
    UserRole,
    UsersListResponse,
)


def create_app() -> FastAPI:
    app = FastAPI(
        title="FastAPI Reference API",
        version="1.0.0",
        description="oa-sdk governance reference implementation for FastAPI services.",
    )

    users: dict[UUID, User] = {
        UUID("00000000-0000-0000-0000-000000000001"): User(
            id=UUID("00000000-0000-0000-0000-000000000001"),
            email="alice@example.com",
            name="Alice",
            role=UserRole.user,
            createdAt=datetime(2024, 1, 1, tzinfo=timezone.utc),
        )
    }

    @app.get("/health", response_model=HealthStatus, tags=["health"])
    def health() -> HealthStatus:
        return HealthStatus(status="ok", timestamp=datetime.now(timezone.utc))

    @app.get("/users", response_model=UsersListResponse, tags=["users"])
    def list_users() -> UsersListResponse:
        items = list(users.values())
        return UsersListResponse(items=items, total=len(items))

    @app.post(
        "/users",
        response_model=User,
        status_code=status.HTTP_201_CREATED,
        tags=["users"],
    )
    def create_user(payload: CreateUserRequest) -> User:
        new_user = User(
            id=uuid4(),
            email=payload.email,
            name=payload.name,
            role=UserRole.user,
            createdAt=datetime.now(timezone.utc),
        )
        users[new_user.id] = new_user
        return new_user

    @app.get("/users/{user_id}", response_model=User, tags=["users"])
    def get_user(user_id: UUID) -> User:
        user = users.get(user_id)
        if user is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=ApiError(code="USER_NOT_FOUND", message="user does not exist").model_dump(),
            )
        return user

    @app.patch("/users/{user_id}", response_model=User, tags=["users"])
    def update_user(user_id: UUID, payload: UpdateUserRequest) -> User:
        user = users.get(user_id)
        if user is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=ApiError(code="USER_NOT_FOUND", message="user does not exist").model_dump(),
            )
        update = payload.model_dump(exclude_unset=True)
        users[user_id] = user.model_copy(update=update)
        return users[user_id]

    return app


app = create_app()
