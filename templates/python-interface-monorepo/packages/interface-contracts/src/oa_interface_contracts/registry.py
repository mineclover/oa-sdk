from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import ParamSpec, Self, TypeVar

from pydantic import BaseModel

from .openapi import schema_from_model
from .spec import (
    ApiKeyLocation,
    ContractEndpoint,
    ContractExample,
    ContractResponse,
    ContractSecurityScheme,
    ContractSpec,
    ContractTarget,
    HttpMethod,
    JsonSchema,
    SecuritySchemeType,
)
from .validation import (
    ContractValidationError,
    ValidationIssue,
    validate_contract_spec,
    validate_endpoint_path_params,
)

_HTTP_METHOD_ORDER = {
    "get": 0,
    "post": 1,
    "put": 2,
    "patch": 3,
    "delete": 4,
    "head": 5,
    "options": 6,
    "trace": 7,
}

_P = ParamSpec("_P")
_R = TypeVar("_R")
type ResponseDeclaration = ContractResponse | Mapping[str, object]
type ResponseDeclarations = Mapping[int | str, ResponseDeclaration]
type SecurityRequirementDeclaration = str | Mapping[str, Sequence[str]]


class ContractRegistryError(ValueError):
    pass


@dataclass(frozen=True)
class RegisteredEndpoint:
    endpoint: ContractEndpoint
    path_params: tuple[str, ...] | None = None


class ContractRegistry:
    def __init__(self, *, name: str, version: str) -> None:
        if not name:
            raise ContractRegistryError("Registry name must not be empty.")
        if not version:
            raise ContractRegistryError("Registry version must not be empty.")
        self.name = name
        self.version = version
        self._models: dict[str, type[BaseModel]] = {}
        self._security_schemes: dict[str, ContractSecurityScheme] = {}
        self._standard_error_responses: dict[str, ContractResponse] = {}
        self._examples: dict[str, ContractExample] = {}
        self._targets: dict[str, ContractTarget] = {}
        self._endpoints: list[RegisteredEndpoint] = []

    @property
    def models(self) -> Mapping[str, type[BaseModel]]:
        return self._models.copy()

    @property
    def security_schemes(self) -> Mapping[str, ContractSecurityScheme]:
        return self._security_schemes.copy()

    @property
    def standard_error_responses(self) -> Mapping[str, ContractResponse]:
        return self._standard_error_responses.copy()

    @property
    def examples(self) -> Mapping[str, ContractExample]:
        return self._examples.copy()

    @property
    def targets(self) -> tuple[ContractTarget, ...]:
        return tuple(self._targets[name] for name in sorted(self._targets))

    @property
    def registered_endpoints(self) -> tuple[RegisteredEndpoint, ...]:
        return tuple(self._endpoints)

    @property
    def endpoints(self) -> tuple[ContractEndpoint, ...]:
        return tuple(item.endpoint for item in self._endpoints)

    def model(self, name: str, model: type[BaseModel]) -> Self:
        if not name:
            raise ContractRegistryError("Model name must not be empty.")
        if name in self._models:
            raise ContractRegistryError(f"Model {name} is already registered.")
        self._models[name] = model
        return self

    def security_scheme(
        self,
        name: str,
        *,
        type: SecuritySchemeType,
        description: str | None = None,
        parameter_name: str | None = None,
        location: ApiKeyLocation | None = None,
        scheme: str | None = None,
        bearer_format: str | None = None,
        flows: Mapping[str, object] | None = None,
        open_id_connect_url: str | None = None,
    ) -> Self:
        if not name:
            raise ContractRegistryError("Security scheme name must not be empty.")
        if name in self._security_schemes:
            raise ContractRegistryError(f"Security scheme {name} is already registered.")
        self._security_schemes[name] = ContractSecurityScheme(
            type=type,
            description=description,
            name=parameter_name,
            location=location,
            scheme=scheme,
            bearer_format=bearer_format,
            flows=None if flows is None else dict(flows),
            open_id_connect_url=open_id_connect_url,
        )
        return self

    def bearer_security_scheme(
        self,
        name: str,
        *,
        description: str | None = None,
        bearer_format: str | None = None,
    ) -> Self:
        return self.security_scheme(
            name,
            type="http",
            description=description,
            scheme="bearer",
            bearer_format=bearer_format,
        )

    def bearer_auth(
        self,
        name: str,
        *,
        description: str | None = None,
        bearer_format: str | None = None,
    ) -> Self:
        return self.bearer_security_scheme(
            name,
            description=description,
            bearer_format=bearer_format,
        )

    def api_key_security_scheme(
        self,
        name: str,
        *,
        parameter_name: str,
        location: ApiKeyLocation,
        description: str | None = None,
    ) -> Self:
        return self.security_scheme(
            name,
            type="apiKey",
            description=description,
            parameter_name=parameter_name,
            location=location,
        )

    def api_key_auth(
        self,
        name: str,
        *,
        parameter_name: str,
        location: ApiKeyLocation,
        description: str | None = None,
    ) -> Self:
        return self.api_key_security_scheme(
            name,
            parameter_name=parameter_name,
            location=location,
            description=description,
        )

    def oauth2_security_scheme(
        self,
        name: str,
        *,
        flows: Mapping[str, object],
        description: str | None = None,
    ) -> Self:
        return self.security_scheme(
            name,
            type="oauth2",
            description=description,
            flows=flows,
        )

    def oauth2_auth(
        self,
        name: str,
        *,
        flows: Mapping[str, object],
        description: str | None = None,
    ) -> Self:
        return self.oauth2_security_scheme(
            name,
            flows=flows,
            description=description,
        )

    def open_id_connect_security_scheme(
        self,
        name: str,
        *,
        open_id_connect_url: str,
        description: str | None = None,
    ) -> Self:
        return self.security_scheme(
            name,
            type="openIdConnect",
            description=description,
            open_id_connect_url=open_id_connect_url,
        )

    def openid_connect_security_scheme(
        self,
        name: str,
        *,
        open_id_connect_url: str,
        description: str | None = None,
    ) -> Self:
        return self.open_id_connect_security_scheme(
            name,
            open_id_connect_url=open_id_connect_url,
            description=description,
        )

    def open_id_connect_auth(
        self,
        name: str,
        *,
        open_id_connect_url: str,
        description: str | None = None,
    ) -> Self:
        return self.open_id_connect_security_scheme(
            name,
            open_id_connect_url=open_id_connect_url,
            description=description,
        )

    def openid_connect_auth(
        self,
        name: str,
        *,
        open_id_connect_url: str,
        description: str | None = None,
    ) -> Self:
        return self.open_id_connect_security_scheme(
            name,
            open_id_connect_url=open_id_connect_url,
            description=description,
        )

    def mutual_tls_security_scheme(
        self,
        name: str,
        *,
        description: str | None = None,
    ) -> Self:
        return self.security_scheme(
            name,
            type="mutualTLS",
            description=description,
        )

    def mutual_tls_auth(
        self,
        name: str,
        *,
        description: str | None = None,
    ) -> Self:
        return self.mutual_tls_security_scheme(
            name,
            description=description,
        )

    def error_response(
        self,
        name: str,
        *,
        status_code: int | str,
        description: str,
        model: str | None = None,
        content_type: str = "application/json",
        examples: Sequence[str] = (),
    ) -> Self:
        if not name:
            raise ContractRegistryError("Error response name must not be empty.")
        if name in self._standard_error_responses:
            raise ContractRegistryError(f"Error response {name} is already registered.")
        self._standard_error_responses[name] = ContractResponse(
            status_code=str(status_code),
            description=description,
            model=model,
            content_type=content_type,
            examples=list(examples),
        )
        return self

    def example(
        self,
        name: str,
        *,
        value: object,
        summary: str | None = None,
        description: str | None = None,
    ) -> Self:
        if not name:
            raise ContractRegistryError("Example name must not be empty.")
        if name in self._examples:
            raise ContractRegistryError(f"Example {name} is already registered.")
        self._examples[name] = ContractExample(
            value=value,
            summary=summary,
            description=description,
        )
        return self

    def target(self, name: str, *, description: str | None = None) -> Self:
        if not name:
            raise ContractRegistryError("Target name must not be empty.")
        if name in self._targets:
            raise ContractRegistryError(f"Target {name} is already registered.")
        self._targets[name] = ContractTarget(name=name, description=description)
        return self

    def endpoint(
        self,
        *,
        method: HttpMethod,
        path: str,
        operation_id: str,
        summary: str | None = None,
        request_model: str | None = None,
        response_model: str | None = None,
        success_responses: Sequence[ContractResponse] = (),
        responses: ResponseDeclarations | None = None,
        tags: Sequence[str] = (),
        security: Sequence[SecurityRequirementDeclaration] = (),
        request_examples: Sequence[str] = (),
        response_examples: Sequence[str] = (),
        error_responses: Sequence[str] = (),
        targets: Sequence[str] = (),
        path_params: Sequence[str] | None = None,
    ) -> Self:
        endpoint = ContractEndpoint(
            method=method,
            path=path,
            operation_id=operation_id,
            summary=summary,
            request_model=request_model,
            response_model=response_model,
            success_responses=_normalize_success_responses(success_responses, responses),
            tags=list(tags),
            security=_normalize_security_requirements(security),
            request_examples=list(request_examples),
            response_examples=list(response_examples),
            error_responses=list(error_responses),
            targets=list(targets),
        )
        declared_path_params = None if path_params is None else tuple(path_params)
        self._endpoints.append(
            RegisteredEndpoint(endpoint=endpoint, path_params=declared_path_params)
        )
        return self

    def route(
        self,
        *,
        method: HttpMethod,
        path: str,
        operation_id: str,
        summary: str | None = None,
        request_model: str | None = None,
        response_model: str | None = None,
        success_responses: Sequence[ContractResponse] = (),
        responses: ResponseDeclarations | None = None,
        tags: Sequence[str] = (),
        security: Sequence[SecurityRequirementDeclaration] = (),
        request_examples: Sequence[str] = (),
        response_examples: Sequence[str] = (),
        error_responses: Sequence[str] = (),
        targets: Sequence[str] = (),
        path_params: Sequence[str] | None = None,
    ) -> Callable[[Callable[_P, _R]], Callable[_P, _R]]:
        def decorator(func: Callable[_P, _R]) -> Callable[_P, _R]:
            self.endpoint(
                method=method,
                path=path,
                operation_id=operation_id,
                summary=summary,
                request_model=request_model,
                response_model=response_model,
                success_responses=success_responses,
                responses=responses,
                tags=tags,
                security=security,
                request_examples=request_examples,
                response_examples=response_examples,
                error_responses=error_responses,
                targets=targets,
                path_params=path_params,
            )
            return func

        return decorator

    def validate(self) -> list[ValidationIssue]:
        spec = self.to_spec(validate=False)
        issues = validate_contract_spec(spec)
        for item in self._endpoints:
            issues.extend(validate_endpoint_path_params(item.endpoint, item.path_params))
        return sorted(issues, key=lambda issue: (issue.location, issue.code, issue.detail))

    def assert_valid(self) -> None:
        issues = self.validate()
        if issues:
            raise ContractValidationError(issues)

    def to_spec(self, *, validate: bool = True) -> ContractSpec:
        contract = ContractSpec(
            name=self.name,
            version=self.version,
            endpoints=[
                item.endpoint for item in sorted(self._endpoints, key=_registered_endpoint_key)
            ],
            schemas=self.schema_map(),
            security_schemes={
                name: self._security_schemes[name] for name in sorted(self._security_schemes)
            },
            standard_error_responses={
                name: self._standard_error_responses[name]
                for name in sorted(self._standard_error_responses)
            },
            examples={name: self._examples[name] for name in sorted(self._examples)},
            targets=[self._targets[name] for name in sorted(self._targets)],
        )
        if validate:
            issues = self.validate()
            if issues:
                raise ContractValidationError(issues)
        return contract

    def to_contract(self, *, validate: bool = True) -> ContractSpec:
        return self.to_spec(validate=validate)

    def schema_map(self) -> dict[str, JsonSchema]:
        return {
            name: schema_from_model(model)
            for name, model in sorted(self._models.items(), key=lambda item: item[0])
        }


def _registered_endpoint_key(item: RegisteredEndpoint) -> tuple[str, int, str, str]:
    endpoint = item.endpoint
    return (
        endpoint.path,
        _HTTP_METHOD_ORDER[endpoint.method],
        endpoint.method,
        endpoint.operation_id,
    )


def _normalize_success_responses(
    success_responses: Sequence[ContractResponse],
    responses: ResponseDeclarations | None,
) -> list[ContractResponse]:
    normalized = list(success_responses)
    normalized.extend(_response_map_from_declarations(responses))
    return sorted(normalized, key=_contract_response_key)


def _response_map_from_declarations(
    responses: ResponseDeclarations | None,
) -> list[ContractResponse]:
    if responses is None:
        return []
    return [
        _response_from_declaration(status_code, declaration)
        for status_code, declaration in sorted(
            responses.items(),
            key=lambda item: _status_code_key(str(item[0])),
        )
    ]


def _response_from_declaration(
    status_code: int | str,
    declaration: ResponseDeclaration,
) -> ContractResponse:
    normalized_status_code = str(status_code)
    if isinstance(declaration, ContractResponse):
        if declaration.status_code != normalized_status_code:
            raise ContractRegistryError(
                "Response declaration status does not match its mapping key: "
                f"{declaration.status_code} != {normalized_status_code}."
            )
        return declaration

    description = declaration.get("description")
    if not isinstance(description, str):
        raise ContractRegistryError(
            f"responses[{normalized_status_code!r}].description must be a string."
        )

    model = declaration.get("model")
    if model is not None and not isinstance(model, str):
        raise ContractRegistryError(
            f"responses[{normalized_status_code!r}].model must be a string."
        )

    content_type = declaration.get("content_type", "application/json")
    if not isinstance(content_type, str):
        raise ContractRegistryError(
            f"responses[{normalized_status_code!r}].content_type must be a string."
        )

    examples = _string_list(
        declaration.get("examples", ()),
        f"responses[{normalized_status_code!r}].examples",
    )
    return ContractResponse(
        status_code=normalized_status_code,
        description=description,
        model=model,
        content_type=content_type,
        examples=examples,
    )


def _string_list(value: object, field: str) -> list[str]:
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes)):
        raise ContractRegistryError(f"{field} must be a sequence of strings.")
    items: list[str] = []
    for item in value:
        if not isinstance(item, str):
            raise ContractRegistryError(f"{field} must be a sequence of strings.")
        items.append(item)
    return items


def _normalize_security_requirements(
    security: Sequence[SecurityRequirementDeclaration],
) -> list[dict[str, list[str]]]:
    return [
        _security_requirement_from_declaration(index, declaration)
        for index, declaration in enumerate(security)
    ]


def _security_requirement_from_declaration(
    index: int,
    declaration: SecurityRequirementDeclaration,
) -> dict[str, list[str]]:
    if isinstance(declaration, str):
        return {declaration: []}
    if not isinstance(declaration, Mapping):
        raise ContractRegistryError(
            f"security[{index}] must be a security scheme name or requirement mapping."
        )

    pairs: list[tuple[str, Sequence[str]]] = []
    for scheme_name, scopes in declaration.items():
        if not isinstance(scheme_name, str):
            raise ContractRegistryError(f"security[{index}] scheme names must be strings.")
        pairs.append((scheme_name, scopes))

    return {
        scheme_name: _string_list(scopes, f"security[{index}][{scheme_name!r}]")
        for scheme_name, scopes in sorted(pairs)
    }


def _contract_response_key(response: ContractResponse) -> tuple[int, str]:
    return _status_code_key(response.status_code)


def _status_code_key(status_code: str) -> tuple[int, str]:
    if status_code == "default":
        return (1000, status_code)
    return (int(status_code), status_code)
