from collections.abc import Mapping, Sequence
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


def schema_from_model(model: type[BaseModel]) -> JsonSchema:
    return model.model_json_schema(mode="validation")


def emit_openapi(contract: ContractSpec) -> dict[str, Any]:
    paths: dict[str, dict[str, Any]] = {}

    for endpoint in contract.endpoints:
        path_item = paths.setdefault(endpoint.path, {})
        path_item[endpoint.method] = _operation(endpoint, contract)

    return {
        "openapi": "3.1.0",
        "info": {
            "title": contract.name,
            "version": contract.version,
        },
        "paths": paths,
        "components": _components(contract),
    }


def _components(contract: ContractSpec) -> dict[str, Any]:
    components: dict[str, Any] = {
        "schemas": contract.schemas,
    }
    if contract.security_schemes:
        components["securitySchemes"] = {
            name: _security_scheme(scheme)
            for name, scheme in sorted(contract.security_schemes.items())
        }
    if contract.standard_error_responses:
        components["responses"] = {
            name: _response_object(response)
            for name, response in sorted(contract.standard_error_responses.items())
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
        operation["tags"] = endpoint.tags
    if endpoint.security:
        operation["security"] = endpoint.security
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
    if endpoint.response_model is None:
        responses: dict[str, Any] = {"204": {"description": "No Content"}}
    else:
        response = ContractResponse(
            status_code="200",
            description="OK",
            model=endpoint.response_model,
            examples=endpoint.response_examples,
        )
        responses = {response.status_code: _response_object(response)}

    for response_name in endpoint.error_responses:
        response = contract.standard_error_responses[response_name]
        responses[response.status_code] = {"$ref": f"#/components/responses/{response_name}"}

    return responses


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


def _example_refs(example_names: Sequence[str]) -> dict[str, dict[str, str]]:
    return {
        name: {"$ref": f"#/components/examples/{name}"}
        for name in sorted(example_names)
    }


def _example_object(example: ContractExample) -> dict[str, object]:
    payload: dict[str, object] = {"value": example.value}
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
        payload["flows"] = scheme.flows
    if scheme.open_id_connect_url is not None:
        payload["openIdConnectUrl"] = scheme.open_id_connect_url
    return payload
