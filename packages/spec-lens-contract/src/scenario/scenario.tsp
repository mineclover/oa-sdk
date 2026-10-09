import "@oa-sdk/typespec-decorators/behavior";

using OaSdkTypeSpec;

namespace SpecLens.ScenarioEngine;

@doc("대시보드 화면 뷰")
enum DashboardView {
  timeline: "timeline",
  diff: "diff",
  paths: "paths",
  graph: "graph",
}

@doc("시나리오 담당 페르소나")
enum ScenarioPersona {
  ApiArchitect: "ApiArchitect",
  ApiConsumer: "ApiConsumer",
  ReleaseManager: "ReleaseManager",
  SpecAuthor: "SpecAuthor",
  GenericUser: "GenericUser",
}

@doc("시나리오 머신 런타임 컨텍스트")
@machineContext
@behaviorRef("spec-lens.scenario-machine.v1")
model ScenarioMachineContext {
  activeScenarioId: string | null;
  currentView: DashboardView;
  baseId?: string;
  headId?: string;
  revisionId?: string;
  pathPattern?: string;
  selectedSymbol?: string;
  onlyBreaking?: boolean;
  breadcrumbs: ScenarioStepProvenance[];
  completedGoals: string[];
}

@doc("시나리오 단계 감사 이력")
model ScenarioStepProvenance {
  stepNumber: int32;
  scenarioId: string;
  view: DashboardView;
  actionType: string;
  timestamp: int64;
  summary?: string;
}

@doc("시나리오 시작 액션 입력")
@actorInput
model StartScenarioInput {
  scenarioId: string;
  initialContext?: Record<unknown>;
}

@doc("Diff 요청 이벤트 페이로드")
@eventPayload("REQUEST_DIFF")
model RequestDiffEvent {
  baseId: string;
  headId: string;
}

@doc("엔드포인트 경로 출처 역추적 이벤트 페이로드")
@eventPayload("INSPECT_ENDPOINT_PROVENANCE")
model InspectEndpointProvenanceEvent {
  pathPattern: string;
}

@doc("스키마 심볼 선택 이벤트 페이로드")
@eventPayload("SELECT_FRAGMENT_SYMBOL")
model SelectFragmentSymbolEvent {
  symbolId: string;
}

@doc("순환 참조 하이라이트 이벤트 페이로드")
@eventPayload("HIGHLIGHT_DEPENDENCY_CYCLE")
model HighlightDependencyCycleEvent {
  rootSymbolId: string;
}
