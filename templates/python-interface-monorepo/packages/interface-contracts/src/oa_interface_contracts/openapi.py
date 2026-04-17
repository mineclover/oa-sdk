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


def emit_openapi(contract: ContractSpec) -> dict[str, Any]:
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
