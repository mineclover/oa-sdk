import json
from collections.abc import Mapping, Sequence
from hashlib import sha256
from typing import Any

from pydantic import BaseModel

from .spec import (
    ContractEndpoint,
    ContractExample,
    ContractResponse,
    ContractSecurityScheme,
    ContractSpec,
    JsonSchema,
)

_COMPONENT_SCHEMA_REF_PREFIX = "#/components/schemas/"
_INTERNAL_ONLY_SCHEMA_EXTENSIONS = ("x-internal-only", "x-internal")
_MODEL_AUDIENCE_ORDER = {
    "public": 0,
    "admin": 1,
    "internal": 2,
}
_SCHEMA_AUDIENCE_EXTENSION = "x-oa-audience"
_SCHEMA_TARGETS_EXTENSION = "x-oa-targets"
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


def schema_from_model(model: type[BaseModel]) -> JsonSchema:
    return model.model_json_schema(mode="validation")


def emit_openapi(contract: ContractSpec, *, target: str | None = None) -> dict[str, Any]:
    contract = _contract_for_target(contract, target)
    paths: dict[str, dict[str, Any]] = {}

    for endpoint in sorted(contract.endpoints, key=_endpoint_key):
        path_item = paths.setdefault(endpoint.path, {})
        path_item[endpoint.method] = _operation(endpoint, contract)

    document: dict[str, Any] = {
        "openapi": "3.1.0",
        "info": {
            "title": contract.name,
            "version": contract.version,
        },
        "paths": {
            path: _sorted_path_item(path_item)
            for path, path_item in sorted(paths.items())
        },
        "components": _components(contract),
        "x-oa-contract-hash": contract_version_hash(contract),
    }
    tags = _tags(contract)
    if tags:
        document["tags"] = tags
    return document


def _contract_for_target(contract: ContractSpec, target: str | None) -> ContractSpec:
    if target is None:
        return contract

    _validate_declared_target(contract, target)
    endpoints = [endpoint for endpoint in contract.endpoints if target in endpoint.targets]
    used_error_response_names = _used_error_response_names(endpoints, contract)
    schema_names = _reachable_schema_names(contract, endpoints, used_error_response_names)
    disallowed_schema_names = [
        name
        for name in schema_names
        if not _schema_allowed_for_target(contract.schemas[name], target)
    ]
    if disallowed_schema_names:
        joined_names = ", ".join(disallowed_schema_names)
        raise ValueError(
            f"target {target} references schema(s) not allowed for that target: {joined_names}"
        )

    used_security_scheme_names = _used_security_scheme_names(endpoints)
    used_example_names = _used_example_names(
        endpoints,
        contract.standard_error_responses,
        used_error_response_names,
    )
    return ContractSpec(
        name=contract.name,
        version=contract.version,
        endpoints=endpoints,
        schemas={
            name: contract.schemas[name]
            for name in sorted(schema_names)
        },
        security_schemes={
            name: scheme
            for name, scheme in sorted(contract.security_schemes.items())
            if name in used_security_scheme_names
        },
        standard_error_responses={
            name: response
            for name, response in sorted(contract.standard_error_responses.items())
            if name in used_error_response_names
        },
        examples={
            name: example
            for name, example in sorted(contract.examples.items())
            if name in used_example_names
        },
        targets=[item for item in contract.targets if item.name == target],
    )


def _validate_declared_target(contract: ContractSpec, target: str) -> None:
    target_names = {item.name for item in contract.targets}
    if target_names and target not in target_names:
        raise ValueError(f"target {target} is not declared.")


def _used_error_response_names(
    endpoints: Sequence[ContractEndpoint],
    contract: ContractSpec,
) -> set[str]:
    response_names = set(contract.standard_error_responses)
    return {
        response_name
        for endpoint in endpoints
        for response_name in endpoint.error_responses
        if response_name in response_names
    }


def _used_security_scheme_names(endpoints: Sequence[ContractEndpoint]) -> set[str]:
    return {
        scheme_name
        for endpoint in endpoints
        for requirement in endpoint.security
        for scheme_name in requirement
    }


def _used_example_names(
    endpoints: Sequence[ContractEndpoint],
    standard_error_responses: Mapping[str, ContractResponse],
    used_error_response_names: set[str],
) -> set[str]:
    names: set[str] = set()
    for endpoint in endpoints:
        names.update(endpoint.request_examples)
        names.update(endpoint.response_examples)
        for response in endpoint.success_responses:
            names.update(response.examples)
    for response_name in used_error_response_names:
        names.update(standard_error_responses[response_name].examples)
    return names


def _reachable_schema_names(
    contract: ContractSpec,
    endpoints: Sequence[ContractEndpoint],
    used_error_response_names: set[str],
) -> set[str]:
    reachable = {
        name
        for name in _endpoint_model_names(endpoints, contract, used_error_response_names)
        if name in contract.schemas
    }
    pending = list(reachable)
    while pending:
        schema_name = pending.pop()
        schema = contract.schemas.get(schema_name)
        if schema is None:
            continue
        for ref_name in sorted(_schema_ref_names(schema)):
            if ref_name not in contract.schemas or ref_name in reachable:
                continue
            reachable.add(ref_name)
            pending.append(ref_name)
    return reachable


def _endpoint_model_names(
    endpoints: Sequence[ContractEndpoint],
    contract: ContractSpec,
    used_error_response_names: set[str],
) -> set[str]:
    names: set[str] = set()
    for endpoint in endpoints:
        if endpoint.request_model is not None:
            names.add(endpoint.request_model)
        if endpoint.response_model is not None:
            names.add(endpoint.response_model)
        for response in endpoint.success_responses:
            if response.model is not None:
                names.add(response.model)
    for response_name in used_error_response_names:
        response = contract.standard_error_responses[response_name]
        if response.model is not None:
            names.add(response.model)
    return names


def _schema_ref_names(value: object) -> set[str]:
    names: set[str] = set()
    if isinstance(value, Mapping):
        ref = value.get("$ref")
        if isinstance(ref, str):
            name = _component_schema_name_from_ref(ref)
            if name is not None:
                names.add(name)
        for item in value.values():
            names.update(_schema_ref_names(item))
    elif isinstance(value, list):
        for item in value:
            names.update(_schema_ref_names(item))
    return names


def _component_schema_name_from_ref(ref: str) -> str | None:
    if not ref.startswith(_COMPONENT_SCHEMA_REF_PREFIX):
        return None
    pointer = ref[len(_COMPONENT_SCHEMA_REF_PREFIX):]
    encoded_name = pointer.split("/", 1)[0]
    return encoded_name.replace("~1", "/").replace("~0", "~")


def _schema_allowed_for_target(schema: JsonSchema, target: str) -> bool:
    if _schema_internal_only(schema):
        return target == "internal"

    schema_targets = _schema_target_names(schema)
    if schema_targets is not None:
        return target in schema_targets

    audience = schema.get(_SCHEMA_AUDIENCE_EXTENSION)
    if audience is None or audience == "shared":
        return True
    if not isinstance(audience, str):
        return True
    return _audience_allowed_for_target(audience, target)


def _schema_internal_only(schema: Mapping[str, object]) -> bool:
    return any(schema.get(extension) is True for extension in _INTERNAL_ONLY_SCHEMA_EXTENSIONS)


def _schema_target_names(schema: Mapping[str, object]) -> set[str] | None:
    raw_targets = schema.get(_SCHEMA_TARGETS_EXTENSION)
    if raw_targets is None:
        return None
    if isinstance(raw_targets, list) and all(isinstance(item, str) for item in raw_targets):
        return set(raw_targets)
    return None


def _audience_allowed_for_target(audience: str, target: str) -> bool:
    audience_order = _MODEL_AUDIENCE_ORDER.get(audience)
    target_order = _MODEL_AUDIENCE_ORDER.get(target)
    if audience_order is None or target_order is None:
        return audience == target
    return target_order >= audience_order


def contract_version_hash(contract: ContractSpec) -> str:
    payload = json.dumps(
        contract.model_dump(mode="json"),
        sort_keys=True,
        separators=(",", ":"),
    )
    return f"sha256:{sha256(payload.encode('utf-8')).hexdigest()}"


def _components(contract: ContractSpec) -> dict[str, Any]:
    components: dict[str, Any] = {
        "schemas": {
            name: _stable_json(schema)
            for name, schema in sorted(contract.schemas.items())
        },
    }
    if contract.standard_error_responses:
        components["responses"] = {
            name: _response_object(response)
            for name, response in sorted(contract.standard_error_responses.items())
        }
    if contract.security_schemes:
        components["securitySchemes"] = {
            name: _security_scheme(scheme)
            for name, scheme in sorted(contract.security_schemes.items())
        }
    if contract.examples:
        components["examples"] = {
            name: _example_object(example) for name, example in sorted(contract.examples.items())
        }
    return components


def _operation(endpoint: ContractEndpoint, contract: ContractSpec) -> dict[str, Any]:
    operation: dict[str, Any] = {
        "operationId": endpoint.operation_id,
        "responses": _responses(endpoint, contract),
    }
    if endpoint.summary is not None:
        operation["summary"] = endpoint.summary
    if endpoint.tags:
        operation["tags"] = sorted(set(endpoint.tags))
    if endpoint.security:
        operation["security"] = _security_requirements(endpoint.security)
    if endpoint.request_model is not None:
        operation["requestBody"] = {
            "required": True,
            "content": {
                "application/json": {
                    "schema": _schema_ref(endpoint.request_model),
                }
            },
        }
        if endpoint.request_examples:
            operation["requestBody"]["content"]["application/json"]["examples"] = _example_refs(
                endpoint.request_examples
            )
    return operation


def _responses(endpoint: ContractEndpoint, contract: ContractSpec) -> Mapping[str, Any]:
    responses: dict[str, Any] = {
        response.status_code: _response_object(response)
        for response in _success_responses(endpoint)
    }

    for response_name in sorted(endpoint.error_responses):
        response = contract.standard_error_responses[response_name]
        responses[response.status_code] = {"$ref": f"#/components/responses/{response_name}"}

    return {
        status_code: responses[status_code]
        for status_code in sorted(responses, key=_status_code_key)
    }


def _success_responses(endpoint: ContractEndpoint) -> list[ContractResponse]:
    responses: list[ContractResponse] = []
    if endpoint.response_model is not None:
        responses.append(
            ContractResponse(
                status_code="200",
                description="OK",
                model=endpoint.response_model,
                examples=endpoint.response_examples,
            )
        )
    elif not endpoint.success_responses:
        responses.append(ContractResponse(status_code="204", description="No Content"))
    responses.extend(endpoint.success_responses)
    return sorted(responses, key=_response_status_key)


def _response_object(response: ContractResponse) -> dict[str, Any]:
    response_object: dict[str, Any] = {"description": response.description}
    if response.model is None:
        return response_object

    media_type: dict[str, Any] = {"schema": _schema_ref(response.model)}
    if response.examples:
        media_type["examples"] = _example_refs(response.examples)
    response_object["content"] = {
        response.content_type: media_type,
    }
    return response_object


def _schema_ref(name: str) -> dict[str, str]:
    return {"$ref": f"#/components/schemas/{name}"}


def _response_status_key(response: ContractResponse) -> tuple[int, str]:
    return _status_code_key(response.status_code)


def _status_code_key(status_code: str) -> tuple[int, str]:
    if status_code == "default":
        return (1000, status_code)
    return (int(status_code), status_code)


def _example_refs(example_names: Sequence[str]) -> dict[str, dict[str, str]]:
    return {
        name: {"$ref": f"#/components/examples/{name}"}
        for name in sorted(example_names)
    }


def _example_object(example: ContractExample) -> dict[str, object]:
    payload: dict[str, object] = {"value": _stable_json(example.value)}
    if example.summary is not None:
        payload["summary"] = example.summary
    if example.description is not None:
        payload["description"] = example.description
    return payload


def _security_scheme(scheme: ContractSecurityScheme) -> dict[str, object]:
    payload: dict[str, object] = {"type": scheme.type}
    if scheme.description is not None:
        payload["description"] = scheme.description
    if scheme.name is not None:
        payload["name"] = scheme.name
    if scheme.location is not None:
        payload["in"] = scheme.location
    if scheme.scheme is not None:
        payload["scheme"] = scheme.scheme
    if scheme.bearer_format is not None:
        payload["bearerFormat"] = scheme.bearer_format
    if scheme.flows is not None:
        payload["flows"] = _stable_json(scheme.flows)
    if scheme.open_id_connect_url is not None:
        payload["openIdConnectUrl"] = scheme.open_id_connect_url
    return payload


def _endpoint_key(endpoint: ContractEndpoint) -> tuple[str, int, str, str]:
    return (
        endpoint.path,
        _HTTP_METHOD_ORDER[endpoint.method],
        endpoint.method,
        endpoint.operation_id,
    )


def _sorted_path_item(path_item: Mapping[str, Any]) -> dict[str, Any]:
    return {
        method: path_item[method]
        for method in sorted(
            path_item,
            key=lambda method: (_HTTP_METHOD_ORDER[method], method),
        )
    }


def _tags(contract: ContractSpec) -> list[dict[str, str]]:
    return [
        {"name": tag}
        for tag in sorted({tag for endpoint in contract.endpoints for tag in endpoint.tags})
    ]


def _security_requirements(
    requirements: Sequence[dict[str, list[str]]],
) -> list[dict[str, list[str]]]:
    return [
        {
            name: sorted(scopes)
            for name, scopes in sorted(requirement.items())
        }
        for requirement in requirements
    ]


def _stable_json(value: object) -> object:
    if isinstance(value, Mapping):
        return {
            str(key): _stable_json(item)
            for key, item in sorted(value.items(), key=lambda item: str(item[0]))
        }
    if isinstance(value, list):
        return [_stable_json(item) for item in value]
    return value
