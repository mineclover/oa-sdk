from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

HttpMethod = Literal["get", "post", "put", "patch", "delete", "head", "options", "trace"]
SecuritySchemeType = Literal["apiKey", "http", "mutualTLS", "oauth2", "openIdConnect"]
ApiKeyLocation = Literal["query", "header", "cookie"]
JsonSchema = dict[str, object]


class ContractExample(BaseModel):
    model_config = ConfigDict(extra="forbid")

    value: object
    summary: str | None = None
    description: str | None = None


class ContractResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status_code: Annotated[str, Field(pattern=r"^([1-5][0-9][0-9]|default)$")]
    description: Annotated[str, Field(min_length=1)]
    model: str | None = None
    content_type: Annotated[str, Field(min_length=1)] = "application/json"
    examples: list[str] = Field(default_factory=list)


class ContractSecurityScheme(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: SecuritySchemeType
    description: str | None = None
    name: str | None = None
    location: ApiKeyLocation | None = None
    scheme: str | None = None
    bearer_format: str | None = None
    flows: dict[str, object] | None = None
    open_id_connect_url: str | None = None


class ContractTarget(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Annotated[str, Field(min_length=1)]
    description: str | None = None


class ContractEndpoint(BaseModel):
    model_config = ConfigDict(extra="forbid")

    method: HttpMethod
    path: Annotated[str, Field(pattern=r"^/")]
    operation_id: Annotated[str, Field(min_length=1)]
    summary: str | None = None
    request_model: str | None = None
    response_model: str | None = None
    success_responses: list[ContractResponse] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    security: list[dict[str, list[str]]] = Field(default_factory=list)
    request_examples: list[str] = Field(default_factory=list)
    response_examples: list[str] = Field(default_factory=list)
    error_responses: list[str] = Field(default_factory=list)
    targets: list[str] = Field(default_factory=list)


class ContractSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Annotated[str, Field(min_length=1)]
    version: Annotated[str, Field(min_length=1)]
    endpoints: list[ContractEndpoint]
    schemas: dict[str, JsonSchema] = Field(default_factory=dict)
    security_schemes: dict[str, ContractSecurityScheme] = Field(default_factory=dict)
    standard_error_responses: dict[str, ContractResponse] = Field(default_factory=dict)
    examples: dict[str, ContractExample] = Field(default_factory=dict)
    targets: list[ContractTarget] = Field(default_factory=list)

    def endpoint_key_set(self) -> set[tuple[str, str]]:
        return {(endpoint.method, endpoint.path) for endpoint in self.endpoints}

    def endpoint_by_key(self) -> dict[tuple[str, str], ContractEndpoint]:
        return {(endpoint.method, endpoint.path): endpoint for endpoint in self.endpoints}
