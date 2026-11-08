# ruff: noqa: E501
from __future__ import annotations

from dataclasses import dataclass
from typing import TypeAlias

from pydantic import BaseModel, ConfigDict, Field, field_validator


class Error(BaseModel):
    model_config = ConfigDict(extra="ignore")
    message: str

class Thing(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: int = Field(..., ge=-9223372036854775808, le=9223372036854775807)
    name: str

class GetThing2PathParams(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: int = Field(..., ge=-9223372036854775808, le=9223372036854775807)

class GetThing2QueryParams(BaseModel):
    model_config = ConfigDict(extra="forbid")
    filter: str | None = None

class GetThing2HeaderParams(BaseModel):
    model_config = ConfigDict(extra="forbid")
    trace: str | None = None

    @field_validator("trace", mode="before")
    @classmethod
    def _reject_explicit_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("explicit null is not allowed")
        return value

class GetThing2CookieParams(BaseModel):
    model_config = ConfigDict(extra="forbid")
    session: str | None = None

    @field_validator("session", mode="before")
    @classmethod
    def _reject_explicit_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("explicit null is not allowed")
        return value

class PostThingsIdBodyInner(BaseModel):
    model_config = ConfigDict(extra="ignore")
    y: str

class PostThingsIdBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    inner: PostThingsIdBodyInner
    name: str

class PostThingsIdPathParams(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: int = Field(..., ge=-9223372036854775808, le=9223372036854775807)

GetThingResponse: TypeAlias = Thing

GetThingError: TypeAlias = Error

GetThing2Body: TypeAlias = Thing

GetThing2Response: TypeAlias = Thing

GetThing2Error: TypeAlias = Error

PostThingsIdResponse: TypeAlias = Thing

PostThingsIdError: TypeAlias = Error

@dataclass(frozen=True)
class OperationSpec:
    method: str
    path: str
    responses: dict[str, object]
    request_media: dict[str, object]
    response_media: dict[str, object]
    streams: dict[str, bool]

OPERATIONS: dict[str, OperationSpec] = {
    "GetThing": OperationSpec(method="GET", path="/things", responses={"200": Thing, "400": Error, "default": Error}, request_media={}, response_media={"200:application/json": GetThingResponse, "400:application/json": GetThingError, "default:application/json": GetThingError}, streams={}),
    "GetThing2": OperationSpec(method="GET", path="/things/{id}", responses={"200": Thing, "400": Error, "default": Error}, request_media={"application/json": GetThing2Body}, response_media={"200:application/json": GetThing2Response, "400:application/json": GetThing2Error, "default:application/json": GetThing2Error}, streams={}),
    "PostThingsId": OperationSpec(method="POST", path="/things/{id}", responses={"200": Thing, "400": Error, "default": Error}, request_media={"application/json": PostThingsIdBody}, response_media={"200:application/json": PostThingsIdResponse, "400:application/json": PostThingsIdError, "default:application/json": PostThingsIdError}, streams={}),
}
