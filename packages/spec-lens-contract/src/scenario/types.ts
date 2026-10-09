export type DashboardView = 'timeline' | 'diff' | 'paths' | 'graph'

export type ScenarioTopicId =
  | 'spec-drift-triage'
  | 'endpoint-exploration'
  | 'breaking-impact-analysis'
  | 'circular-ref-diagnostic'
  | (string & {})

export type ScenarioPersona =
  | 'ApiArchitect'
  | 'ApiConsumer'
  | 'ReleaseManager'
  | 'SpecAuthor'
  | 'GenericUser'

export interface ScenarioGuardEvaluationResult {
  ok: boolean
  reason?: string
}

export interface ScenarioGuard<TContext = ScenarioMachineContext> {
  id: string
  description: string
  evaluate: (context: TContext, action: LensBehaviorAction) => boolean | ScenarioGuardEvaluationResult
}

export interface ScenarioTerminalGoal {
  id: string
  description: string
  targetView: DashboardView
}

export interface ScenarioTransitionRule<TContext = ScenarioMachineContext> {
  fromView: DashboardView
  actionType: LensBehaviorAction['type']
  toView: DashboardView
  guardIds?: readonly string[] | undefined
  description?: string | undefined
  transformContext?: ((ctx: TContext, action: LensBehaviorAction) => Partial<TContext>) | undefined
}

export interface ScenarioTopicDefinition<TContext = ScenarioMachineContext> {
  readonly id: ScenarioTopicId
  readonly title: string
  readonly description: string
  readonly persona: ScenarioPersona
  readonly initialView: DashboardView
  readonly boundedViews: readonly DashboardView[]
  readonly preconditions?: readonly ScenarioGuard<TContext>[] | undefined
  readonly terminalGoals: readonly ScenarioTerminalGoal[]
  readonly transitions: readonly ScenarioTransitionRule<TContext>[]
  readonly guards?: Record<string, ScenarioGuard<TContext>> | undefined
}

export type LensBehaviorAction =
  | { type: 'START_SCENARIO'; scenarioId: ScenarioTopicId; initialContext?: Partial<ScenarioMachineContext> | undefined }
  | { type: 'SELECT_REVISION'; revisionId: string }
  | { type: 'REQUEST_DIFF'; baseId: string; headId: string }
  | { type: 'INSPECT_ENDPOINT_PROVENANCE'; pathPattern: string }
  | { type: 'SELECT_FRAGMENT_SYMBOL'; symbolId: string }
  | { type: 'HIGHLIGHT_DEPENDENCY_CYCLE'; rootSymbolId: string }
  | { type: 'FILTER_BREAKING_CHANGES'; onlyBreaking: boolean }
  | { type: 'COMPLETE_GOAL'; goalId: string }
  | { type: 'STEP_BACK' }
  | { type: 'SWITCH_SCENARIO'; targetScenarioId: ScenarioTopicId; handoffContext?: Partial<ScenarioMachineContext> | undefined }
  | { type: 'NAVIGATE_VIEW'; view: DashboardView }

export interface ScenarioStepProvenance {
  stepNumber: number
  scenarioId: string
  view: DashboardView
  actionType: LensBehaviorAction['type']
  timestamp: number
  summary?: string | undefined
}

export interface ScenarioMachineContext {
  activeScenarioId: ScenarioTopicId | null
  currentView: DashboardView
  baseId?: string | undefined
  headId?: string | undefined
  revisionId?: string | undefined
  pathPattern?: string | undefined
  selectedSymbol?: string | undefined
  onlyBreaking?: boolean | undefined
  breadcrumbs: ScenarioStepProvenance[]
  completedGoals: string[]
  customData?: Record<string, unknown> | undefined
}

export interface FlowStep {
  from: DashboardView
  action: LensBehaviorAction['type']
  to: DashboardView
  guardIds?: readonly string[] | undefined
  description?: string | undefined
}

export interface FlowPath {
  steps: FlowStep[]
  reachedGoal?: string | undefined
  isTerminal: boolean
}

export interface FlowMatrixRow {
  scenarioId: ScenarioTopicId
  fromView: DashboardView
  actionType: LensBehaviorAction['type']
  toView: DashboardView
  guardIds: readonly string[]
  isTerminal: boolean
  description?: string | undefined
}

export interface FlowEnumerationResult {
  scenarioId: ScenarioTopicId
  title: string
  initialView: DashboardView
  boundedViews: readonly DashboardView[]
  reachableViews: readonly DashboardView[]
  deadEnds: readonly DashboardView[]
  paths: readonly FlowPath[]
  terminalPaths: readonly FlowPath[]
  matrix: readonly FlowMatrixRow[]
}
