from pydantic import BaseModel, EmailStr


class User(BaseModel):
    id: str
    email: EmailStr


class CreateUser(BaseModel):
    email: EmailStr
