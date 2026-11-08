# ruff: noqa: E501
from __future__ import annotations

from typing import Annotated, Literal, TypeAlias

from pydantic import BaseModel, ConfigDict, Field


class Cat(BaseModel):
    model_config = ConfigDict(extra="allow")
    meow: int = Field(..., ge=-2147483648, le=2147483647)
    name: str


class Dog(BaseModel):
    model_config = ConfigDict(extra="allow")
    bark: str
    name: str


class PetCat(BaseModel):
    model_config = ConfigDict(extra="allow")
    kind: Literal["cat"]
    value: Cat


class PetDog(BaseModel):
    model_config = ConfigDict(extra="allow")
    kind: Literal["dog"]
    value: Dog


Pet: TypeAlias = Annotated[PetCat | PetDog, Field(discriminator="kind")]


class Pet2Cat(BaseModel):
    model_config = ConfigDict(extra="allow")
    data: Cat
    type: Literal["cat"]


class Pet2Dog(BaseModel):
    model_config = ConfigDict(extra="allow")
    data: Dog
    type: Literal["dog"]


Pet2: TypeAlias = Annotated[Pet2Cat | Pet2Dog, Field(discriminator="type")]
