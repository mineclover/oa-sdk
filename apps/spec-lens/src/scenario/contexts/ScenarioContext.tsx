import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  DEFAULT_SCENARIOS,
  ScenarioFlowEnumerator,
  ScenarioRegistry,
  scenarioTransitionReducer,
  type FlowEnumerationResult,
  type LensBehaviorAction,
  type ScenarioMachineContext,
  type ScenarioTerminalGoal,
  type ScenarioTopicDefinition,
  type ScenarioTopicId,
  type ScenarioTransitionResult,
} from '@oa-sdk/spec-lens-contract'
import { useUrlState, type UrlHistoryMode } from '../../hooks/useUrlState.js'
import {
  availableGoalsFor,
  initialMachineStateFromUrl,
  machineUrlPatch,
  reconcileMachineWithUrl,
  resolveScenarioIntents,
  type ScenarioIntent,
  type ScenarioSelection,
} from '../navigation.js'

export interface ScenarioDispatchOptions {
  /** How the URL change is recorded in history (default `push`). */
  history?: UrlHistoryMode
}

export interface ScenarioContextValue {
  readonly registry: ScenarioRegistry
  readonly activeScenario: ScenarioTopicDefinition | null
  readonly machineState: ScenarioMachineContext
  readonly flowAnalysis: FlowEnumerationResult | null
  readonly canStepBack: boolean
  readonly permittedActions: readonly LensBehaviorAction['type'][]
  readonly availableGoals: readonly ScenarioTerminalGoal[]
  /** Steps the current view can take inside the active scenario, with resolved payloads. */
  readonly intents: readonly ScenarioIntent[]
  /** What the current view has selected (cleared whenever the view changes). */
  readonly selection: ScenarioSelection
  /** The reason the last rejected transition gave, until the next successful one. */
  readonly lastError: string | null
  readonly isFlowModalOpen: boolean
  dispatch(action: LensBehaviorAction, options?: ScenarioDispatchOptions): ScenarioTransitionResult
  startScenario(id: ScenarioTopicId, initialContext?: Partial<ScenarioMachineContext>): void
  switchScenario(id: ScenarioTopicId, handoffContext?: Partial<ScenarioMachineContext>): void
  stepBack(): void
  completeGoal(goalId: string): void
  resetScenario(): void
  /** Views report their selection here so scenario steps can use it as payload. */
  publishSelection(selection: ScenarioSelection | null): void
  openFlowModal(): void
  closeFlowModal(): void
}

const ScenarioContext = createContext<ScenarioContextValue | null>(null)

export interface ScenarioProviderProps {
  children: ReactNode
  customScenarios?: readonly ScenarioTopicDefinition[]
}

const EMPTY_SELECTION: ScenarioSelection = {}

export function ScenarioProvider({
  children,
  customScenarios = DEFAULT_SCENARIOS,
}: ScenarioProviderProps) {
  // The URL store is shared with every other useUrlState() caller (AppShell included).
  const { state: urlState, update: updateUrl } = useUrlState()
  const registry = useMemo(() => new ScenarioRegistry(customScenarios), [customScenarios])

  const [machineState, setMachineState] = useState<ScenarioMachineContext>(() =>
    initialMachineStateFromUrl(urlState, registry),
  )
  // Latest machine state for handlers, so back-to-back dispatches never read a stale render.
  const machineRef = useRef(machineState)
  const [selection, setSelection] = useState<ScenarioSelection>(EMPTY_SELECTION)
  const [lastError, setLastError] = useState<string | null>(null)
  const [isFlowModalOpen, setIsFlowModalOpen] = useState(false)

  /** Moves the machine and, when asked, writes the URL it implies in one history step. */
  const commit = useCallback(
    (next: ScenarioMachineContext, history: UrlHistoryMode | null) => {
      const prev = machineRef.current
      machineRef.current = next
      setMachineState(next)
      if (prev.currentView !== next.currentView || prev.activeScenarioId !== next.activeScenarioId) {
        setSelection(EMPTY_SELECTION)
      }
      if (history) {
        updateUrl(machineUrlPatch(next), history)
      }
    },
    [updateUrl],
  )

  const dispatch = useCallback(
    (action: LensBehaviorAction, options?: ScenarioDispatchOptions): ScenarioTransitionResult => {
      const result = scenarioTransitionReducer(machineRef.current, action, registry)
      if (result.ok) {
        setLastError(null)
        commit(result.state, options?.history ?? 'push')
      } else {
        setLastError(result.error ?? `Action "${action.type}" was rejected`)
      }
      return result
    },
    [commit, registry],
  )

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

  const availableGoals = useMemo(
    () => availableGoalsFor(activeScenario, machineState),
    [activeScenario, machineState],
  )

  const intents = useMemo(
    () => resolveScenarioIntents(activeScenario, machineState, selection),
    [activeScenario, machineState, selection],
  )

  const canStepBack = machineState.breadcrumbs.length > 1

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
    setLastError(null)
    commit(
      {
        ...machineRef.current,
        activeScenarioId: null,
        completedGoals: [],
        breadcrumbs: [],
      },
      'push',
    )
  }, [commit])

  const publishSelection = useCallback((next: ScenarioSelection | null) => {
    setSelection(next ?? EMPTY_SELECTION)
  }, [])

  // Fold URL changes the machine did not make (back/forward, edited or pasted
  // deep links) into the machine, or restore the URL when the FSM cannot follow.
  useEffect(() => {
    const decision = reconcileMachineWithUrl(urlState, machineRef.current, registry)
    if (decision.kind === 'adopt') {
      commit(decision.state, null)
    } else if (decision.kind === 'restore-url') {
      commit(decision.state, 'replace')
    }
  }, [urlState, registry, commit])

  const contextValue: ScenarioContextValue = {
    registry,
    activeScenario,
    machineState,
    flowAnalysis,
    canStepBack,
    permittedActions,
    availableGoals,
    intents,
    selection,
    lastError,
    isFlowModalOpen,
    dispatch,
    startScenario,
    switchScenario,
    stepBack,
    completeGoal,
    resetScenario,
    publishSelection,
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
