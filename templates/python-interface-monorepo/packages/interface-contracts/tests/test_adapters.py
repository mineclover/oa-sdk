from pathlib import Path
from typing import Any

from oa_interface_contracts import RuntimeOpenApiAdapter


class FakeRuntimeAdapter:
    name = "fake"
    framework = "FakeFramework"

    def extract_openapi(self, runtime: object) -> dict[str, Any]:
        return {
            "openapi": "3.1.0",
            "info": {"title": str(runtime), "version": "1.0.0"},
            "paths": {},
        }


def test_runtime_openapi_adapter_protocol_is_framework_neutral() -> None:
    adapter = FakeRuntimeAdapter()

    assert isinstance(adapter, RuntimeOpenApiAdapter)
    assert adapter.extract_openapi("runtime")["info"]["title"] == "runtime"


def test_core_contracts_package_does_not_import_fastapi() -> None:
    source_root = Path(__file__).parents[1] / "src" / "oa_interface_contracts"

    for path in source_root.glob("*.py"):
        source = path.read_text()
        assert "from fastapi" not in source
        assert "import fastapi" not in source
