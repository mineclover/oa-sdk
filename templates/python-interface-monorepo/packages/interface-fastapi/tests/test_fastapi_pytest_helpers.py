import pytest
from fastapi import FastAPI
from oa_interface_contracts import ContractEndpoint, ContractSpec
from oa_interface_fastapi import assert_no_fastapi_drift
from pydantic import BaseModel


class Widget(BaseModel):
    id: str


def _contract(operation_id: str = "get_widget") -> ContractSpec:
    return ContractSpec(
        name="Widgets API",
        version="1.0.0",
        schemas={"Widget": Widget.model_json_schema(mode="validation")},
        endpoints=[
            ContractEndpoint(
                method="get",
                path="/widgets/{widget_id}",
                operation_id=operation_id,
                response_model="Widget",
            )
        ],
    )


def _app(operation_id: str = "get_widget") -> FastAPI:
    app = FastAPI(title="Widgets API", version="1.0.0")

    @app.get("/widgets/{widget_id}", response_model=Widget, operation_id=operation_id)
    def get_widget(widget_id: str) -> Widget:
        return Widget(id=widget_id)

    return app


def test_assert_no_fastapi_drift_accepts_direct_objects() -> None:
    assert_no_fastapi_drift(_app(), _contract())


def test_assert_no_fastapi_drift_accepts_module_references(tmp_path, monkeypatch) -> None:
    fixture = tmp_path / "fastapi_gate_fixture.py"
    fixture.write_text(
        """
from fastapi import FastAPI
from oa_interface_contracts import ContractEndpoint, ContractSpec
from pydantic import BaseModel


class Widget(BaseModel):
    id: str


contract = ContractSpec(
    name="Widgets API",
    version="1.0.0",
    schemas={"Widget": Widget.model_json_schema(mode="validation")},
    endpoints=[
        ContractEndpoint(
            method="get",
            path="/widgets/{widget_id}",
            operation_id="get_widget",
            response_model="Widget",
        )
    ],
)

app = FastAPI(title="Widgets API", version="1.0.0")


@app.get("/widgets/{widget_id}", response_model=Widget, operation_id="get_widget")
def get_widget(widget_id: str) -> Widget:
    return Widget(id=widget_id)
"""
    )
    monkeypatch.syspath_prepend(str(tmp_path))

    assert_no_fastapi_drift("fastapi_gate_fixture:app", "fastapi_gate_fixture:contract")


def test_assert_no_fastapi_drift_reports_useful_assertion_message() -> None:
    with pytest.raises(AssertionError) as exc_info:
        assert_no_fastapi_drift(_app(operation_id="runtime_widget"), _contract())

    message = str(exc_info.value)
    assert "FastAPI drift detected for FastAPI -> ContractSpec with 1 issue" in message
    assert "operation-id-drift" in message
    assert "GET /widgets/{widget_id}" in message
    assert "Runtime operationId 'runtime_widget'" in message
