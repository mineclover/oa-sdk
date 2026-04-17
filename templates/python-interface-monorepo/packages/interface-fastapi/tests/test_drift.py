from fastapi import FastAPI
from oa_interface_contracts import ContractEndpoint, ContractSpec, emit_openapi
from oa_interface_fastapi import compare_openapi
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


def test_compare_openapi_accepts_matching_fastapi_app() -> None:
    app = FastAPI(title="Widgets API", version="1.0.0")

    @app.get("/widgets/{widget_id}", response_model=Widget, operation_id="get_widget")
    def get_widget(widget_id: str) -> Widget:
        return Widget(id=widget_id)

    issues = compare_openapi(app.openapi(), emit_openapi(_contract()))

    assert issues == []


def test_compare_openapi_reports_operation_id_drift() -> None:
    app = FastAPI(title="Widgets API", version="1.0.0")

    @app.get("/widgets/{widget_id}", response_model=Widget, operation_id="runtime_widget")
    def get_widget(widget_id: str) -> Widget:
        return Widget(id=widget_id)

    issues = compare_openapi(app.openapi(), emit_openapi(_contract()))

    assert [issue.code for issue in issues] == ["operation-id-drift"]
