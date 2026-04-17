from fastapi import FastAPI
from oa_interface_contracts import ContractEndpoint, ContractResponse, ContractSpec, emit_openapi
from oa_interface_fastapi import compare_openapi
from pydantic import BaseModel


class CreateWidget(BaseModel):
    name: str


class OtherCreateWidget(BaseModel):
    count: int


class Widget(BaseModel):
    id: str


class WidgetCopy(BaseModel):
    id: str


class OtherWidget(BaseModel):
    slug: str


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


def test_compare_openapi_matches_schema_refs_by_resolved_shape() -> None:
    app = FastAPI(title="Widgets API", version="1.0.0")

    @app.get("/widgets/{widget_id}", response_model=Widget, operation_id="get_widget")
    def get_widget(widget_id: str) -> Widget:
        return Widget(id=widget_id)

    contract = ContractSpec(
        name="Widgets API",
        version="1.0.0",
        schemas={"ManagedWidget": Widget.model_json_schema(mode="validation")},
        endpoints=[
            ContractEndpoint(
                method="get",
                path="/widgets/{widget_id}",
                operation_id="get_widget",
                response_model="ManagedWidget",
            )
        ],
    )

    issues = compare_openapi(app.openapi(), emit_openapi(contract))

    assert issues == []


def test_compare_openapi_reports_missing_routes_in_both_directions() -> None:
    app = FastAPI(title="Widgets API", version="1.0.0")

    @app.get("/runtime-widgets", operation_id="list_runtime_widgets")
    def list_runtime_widgets() -> list[Widget]:
        return []

    contract = ContractSpec(
        name="Widgets API",
        version="1.0.0",
        endpoints=[
            ContractEndpoint(
                method="get",
                path="/managed-widgets",
                operation_id="list_managed_widgets",
            )
        ],
    )

    issues = compare_openapi(app.openapi(), emit_openapi(contract))

    assert [issue.code for issue in issues] == [
        "route-missing-in-runtime",
        "route-missing-in-contract",
    ]


def test_compare_openapi_reports_operation_id_drift() -> None:
    app = FastAPI(title="Widgets API", version="1.0.0")

    @app.get("/widgets/{widget_id}", response_model=Widget, operation_id="runtime_widget")
    def get_widget(widget_id: str) -> Widget:
        return Widget(id=widget_id)

    issues = compare_openapi(app.openapi(), emit_openapi(_contract()))

    assert [issue.code for issue in issues] == ["operation-id-drift"]


def test_compare_openapi_reports_request_schema_drift() -> None:
    app = FastAPI(title="Widgets API", version="1.0.0")

    @app.post("/widgets", response_model=Widget, operation_id="create_widget")
    def create_widget(body: OtherCreateWidget) -> Widget:
        return Widget(id=str(body.count))

    contract = ContractSpec(
        name="Widgets API",
        version="1.0.0",
        schemas={
            "CreateWidget": CreateWidget.model_json_schema(mode="validation"),
            "Widget": Widget.model_json_schema(mode="validation"),
        },
        endpoints=[
            ContractEndpoint(
                method="post",
                path="/widgets",
                operation_id="create_widget",
                request_model="CreateWidget",
                response_model="Widget",
            )
        ],
    )

    issues = compare_openapi(app.openapi(), emit_openapi(contract))

    assert [issue.code for issue in issues] == ["request-schema-drift"]


def test_compare_openapi_reports_response_schema_drift() -> None:
    app = FastAPI(title="Widgets API", version="1.0.0")

    @app.get("/widgets/{widget_id}", response_model=OtherWidget, operation_id="get_widget")
    def get_widget(widget_id: str) -> OtherWidget:
        return OtherWidget(slug=widget_id)

    issues = compare_openapi(app.openapi(), emit_openapi(_contract()))

    assert [issue.code for issue in issues] == ["response-schema-drift"]


def test_compare_openapi_ignores_managed_schema_governance_extensions() -> None:
    app = FastAPI(title="Widgets API", version="1.0.0")

    @app.get("/widgets/{widget_id}", response_model=Widget, operation_id="get_widget")
    def get_widget(widget_id: str) -> Widget:
        return Widget(id=widget_id)

    widget_schema = Widget.model_json_schema(mode="validation")
    widget_schema["x-oa-audience"] = "public"
    widget_schema["x-oa-targets"] = ["public"]

    contract = ContractSpec(
        name="Widgets API",
        version="1.0.0",
        schemas={"Widget": widget_schema},
        endpoints=[
            ContractEndpoint(
                method="get",
                path="/widgets/{widget_id}",
                operation_id="get_widget",
                response_model="Widget",
            )
        ],
    )

    issues = compare_openapi(app.openapi(), emit_openapi(contract))

    assert issues == []


def test_compare_openapi_reports_status_code_mismatches_except_fastapi_validation() -> None:
    app = FastAPI(title="Widgets API", version="1.0.0")

    @app.post("/widgets", response_model=Widget, operation_id="create_widget")
    def create_widget() -> Widget:
        return Widget(id="wid_1")

    contract = ContractSpec(
        name="Widgets API",
        version="1.0.0",
        schemas={"Widget": Widget.model_json_schema(mode="validation")},
        endpoints=[
            ContractEndpoint(
                method="post",
                path="/widgets",
                operation_id="create_widget",
                success_responses=[
                    ContractResponse(status_code="201", description="Created", model="Widget")
                ],
            )
        ],
    )

    issues = compare_openapi(app.openapi(), emit_openapi(contract))

    assert [issue.code for issue in issues] == [
        "response-missing-in-runtime",
        "response-missing-in-contract",
    ]


def test_compare_openapi_reports_security_drift() -> None:
    app = FastAPI(title="Widgets API", version="1.0.0")

    @app.get(
        "/widgets/{widget_id}",
        response_model=WidgetCopy,
        operation_id="get_widget",
        dependencies=[],
    )
    def get_widget(widget_id: str) -> WidgetCopy:
        return WidgetCopy(id=widget_id)

    base_contract = _contract()
    contract = base_contract.model_copy(
        update={
            "endpoints": [
                base_contract.endpoints[0].model_copy(update={"security": [{"BearerAuth": []}]})
            ],
        }
    )

    issues = compare_openapi(app.openapi(), emit_openapi(contract))

    assert [issue.code for issue in issues] == ["security-drift"]
