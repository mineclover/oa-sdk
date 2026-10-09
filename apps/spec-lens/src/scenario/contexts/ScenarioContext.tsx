import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  DEFAULT_SCENARIOS,
  ScenarioFlowEnumerator,
  ScenarioRegistry,
  createInitialScenarioState,
  scenarioTransitionReducer,
  type DashboardView,
  type FlowEnumerationResult,
  type LensBehaviorAction,
  type ScenarioMachineContext,
  type ScenarioTerminalGoal,
  type ScenarioTopicDefinition,
  type ScenarioTopicId,
  type ScenarioTransitionResult,
} from '@oa-sdk/spec-lens-contract'
import { useUrlState } from '../../hooks/useUrlState.js'

export interface ScenarioContextValue {
  readonly registry: ScenarioRegistry
  readonly activeScenario: ScenarioTopicDefinition | null
  readonly machineState: ScenarioMachineContext
  readonly flowAnalysis: FlowEnumerationResult | null
  readonly canStepBack: boolean
  readonly permittedActions: readonly LensBehaviorAction['type'][]
  readonly availableGoals: readonly ScenarioTerminalGoal[]
  readonly isFlowModalOpen: boolean
  dispatch(action: LensBehaviorAction): ScenarioTransitionResult
  startScenario(id: ScenarioTopicId, initialContext?: Partial<ScenarioMachineContext>): void
  switchScenario(id: ScenarioTopicId, handoffContext?: Partial<ScenarioMachineContext>): void
  stepBack(): void
  completeGoal(goalId: string): void
  resetScenario(): void
  openFlowModal(): void
  closeFlowModal(): void
}

const ScenarioContext = createContext<ScenarioContextValue | null>(null)

export interface ScenarioProviderProps {
  children: ReactNode
  customScenarios?: readonly ScenarioTopicDefinition[]
}

export function ScenarioProvider({
  children,
  customScenarios = DEFAULT_SCENARIOS,
}: ScenarioProviderProps) {
  const { state: urlState, setView, setDiff, setScenario } = useUrlState()
  const registry = useMemo(() => new ScenarioRegistry(customScenarios), [customScenarios])

  const [machineState, setMachineState] = useState<ScenarioMachineContext>(() => {
    const initialScenarioId = urlState.scenario as ScenarioTopicId | undefined
    const scenario = initialScenarioId ? registry.get(initialScenarioId) : undefined
    return createInitialScenarioState(
      scenario,
      urlState.view,
      {
        baseId: urlState.baseId ?? urlState.base,
        headId: urlState.headId ?? urlState.head,
        revisionId: urlState.revisionId ?? urlState.revision,
        pathPattern: urlState.search,
      },
    )
  })

  const [isFlowModalOpen, setIsFlowModalOpen] = useState(false)

  const activeScenario = useMemo(() => {
    return machineState.activeScenarioId ? registry.get(machineState.activeScenarioId) ?? null : null
  }, [machineState.activeScenarioId, registry])

  const flowAnalysis = useMemo(() => {
    return activeScenario ? ScenarioFlowEnumerator.enumerate(activeScenario) : null
  }, [activeScenario])

  const permittedActions = useMemo(() => {
    if (!activeScenario) {
      return ['START_SCENARIO', 'NAVIGATE_VIEW', 'REQUEST_DIFF'] as const
    }
    const currentView = machineState.currentView
    const actions = activeScenario.transitions
      .filter((t) => t.fromView === currentView)
      .map((t) => t.actionType)
    return Array.from(new Set(actions))
  }, [activeScenario, machineState.currentView])

  const availableGoals = useMemo(() => {
    if (!activeScenario) return []
    return activeScenario.terminalGoals.filter((g) => g.targetView === machineState.currentView)
  }, [activeScenario, machineState.currentView])

  const canStepBack = machineState.breadcrumbs.length > 1

  // Dispatch transition with url synchronization
  const dispatch = useCallback(
    (action: LensBehaviorAction): ScenarioTransitionResult => {
      const result = scenarioTransitionReducer(machineState, action, registry)
      if (result.ok) {
        setMachineState(result.state)

        // Sync view with URL
        const nextView = result.state.currentView
        if (nextView === 'diff' && result.state.baseId && result.state.headId) {
          setDiff(result.state.baseId, result.state.headId, true)
        } else {
          setView(nextView, true)
        }

        // Sync scenario with URL
        if (result.state.activeScenarioId !== machineState.activeScenarioId) {
          setScenario(result.state.activeScenarioId ?? undefined, true)
        }
      }
      return result
    },
    [machineState, registry, setDiff, setScenario, setView],
  )

  const startScenario = useCallback(
    (id: ScenarioTopicId, initialContext?: Partial<ScenarioMachineContext>) => {
      dispatch({ type: 'START_SCENARIO', scenarioId: id, initialContext })
    },
    [dispatch],
  )

  const switchScenario = useCallback(
    (id: ScenarioTopicId, handoffContext?: Partial<ScenarioMachineContext>) => {
      dispatch({ type: 'SWITCH_SCENARIO', targetScenarioId: id, handoffContext })
    },
    [dispatch],
  )

  const stepBack = useCallback(() => {
    dispatch({ type: 'STEP_BACK' })
  }, [dispatch])

  const completeGoal = useCallback(
    (goalId: string) => {
      dispatch({ type: 'COMPLETE_GOAL', goalId })
    },
    [dispatch],
  )

  const resetScenario = useCallback(() => {
    setMachineState((prev) => ({
      ...prev,
      activeScenarioId: null,
      completedGoals: [],
      breadcrumbs: [],
    }))
    setScenario(undefined, true)
  }, [setScenario])

  // Sync when URL scenario changes externally (e.g. back/forward button)
  useEffect(() => {
    if (urlState.scenario && urlState.scenario !== machineState.activeScenarioId) {
      const target = registry.get(urlState.scenario as ScenarioTopicId)
      if (target) {
        startScenario(target.id)
      }
    } else if (!urlState.scenario && machineState.activeScenarioId !== null) {
      resetScenario()
    }
  }, [urlState.scenario, machineState.activeScenarioId, registry, startScenario, resetScenario])

  const contextValue: ScenarioContextValue = {
    registry,
    activeScenario,
    machineState,
    flowAnalysis,
    canStepBack,
    permittedActions,
    availableGoals,
    isFlowModalOpen,
    dispatch,
    startScenario,
    switchScenario,
    stepBack,
    completeGoal,
    resetScenario,
    openFlowModal: () => setIsFlowModalOpen(true),
    closeFlowModal: () => setIsFlowModalOpen(false),
  }

  return (
    <ScenarioContext.Provider value={contextValue}>
      {children}
    </ScenarioContext.Provider>
  )
}

export function useScenario(): ScenarioContextValue {
  const ctx = useContext(ScenarioContext)
  if (!ctx) {
    throw new Error('useScenario must be used within a <ScenarioProvider>')
  }
  return ctx
}
