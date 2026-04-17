from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from fastapi import FastAPI
from oa_interface_contracts import RuntimeOpenApiAdapter


@dataclass(frozen=True)
class FastApiRuntimeAdapter:
    name: str = "fastapi"
    framework: str = "FastAPI"

    def extract_openapi(self, runtime: object) -> Mapping[str, Any]:
        if not isinstance(runtime, FastAPI):
            raise TypeError("FastAPI adapter expected a FastAPI application instance")
        return runtime.openapi()


FASTAPI_ADAPTER: RuntimeOpenApiAdapter = FastApiRuntimeAdapter()
