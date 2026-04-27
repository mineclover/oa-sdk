from enum import Enum
from typing import Optional
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, EmailStr, Field


class UserRole(str, Enum):
    user = "user"
    admin = "admin"


class User(BaseModel):
    id: UUID
    email: EmailStr
    name: str = Field(min_length=1, max_length=120)
    role: UserRole = UserRole.user
    createdAt: AwareDatetime


class CreateUserRequest(BaseModel):
    email: EmailStr
    name: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=8, max_length=64)


class UpdateUserRequest(BaseModel):
    email: Optional[EmailStr] = None
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)


class UsersListResponse(BaseModel):
    items: list[User]
    total: int


class HealthStatus(BaseModel):
    status: str = Field(pattern="^(ok|degraded|down)$")
    timestamp: AwareDatetime


class ApiError(BaseModel):
    code: str
    message: str
