import type {
  DashboardView,
  FlowEnumerationResult,
  FlowMatrixRow,
  FlowPath,
  FlowStep,
  ScenarioTopicDefinition,
} from './types.js'

export class ScenarioFlowEnumerator {
  /**
   * Analyzes a Scenario Topic and returns complete reachability, path enumerations,
   * dead-end analysis, and transition matrices.
   */
  public static enumerate(scenario: ScenarioTopicDefinition): FlowEnumerationResult {
    const reachableViewsSet = new Set<DashboardView>([scenario.initialView])
    const matrix: FlowMatrixRow[] = []

    // 1. Build transition matrix & direct reachable views
    for (const rule of scenario.transitions) {
      const isTerminal = scenario.terminalGoals.some((g) => g.targetView === rule.toView)
      matrix.push({
        scenarioId: scenario.id,
        fromView: rule.fromView,
        actionType: rule.actionType,
        toView: rule.toView,
        guardIds: rule.guardIds ?? [],
        isTerminal,
        description: rule.description,
      })
    }

    // 2. BFS to find all reachable views from initialView
    const queue: DashboardView[] = [scenario.initialView]
    while (queue.length > 0) {
      const current = queue.shift()!
      const nextTransitions = scenario.transitions.filter((t) => t.fromView === current)
      for (const t of nextTransitions) {
        if (!reachableViewsSet.has(t.toView)) {
          reachableViewsSet.add(t.toView)
          queue.push(t.toView)
        }
      }
    }

    // 3. Find Dead Ends (bounded views with no outgoing transitions that are not terminal)
    const deadEnds = scenario.boundedViews.filter((view) => {
      const outgoing = scenario.transitions.filter((t) => t.fromView === view)
      const isTerminalTarget = scenario.terminalGoals.some((g) => g.targetView === view)
      return outgoing.length === 0 && !isTerminalTarget
    })

    // 4. Enumerate acyclic paths from initialView to goals (DFS with cycle prevention)
    const paths: FlowPath[] = []
    const terminalPaths: FlowPath[] = []

    function dfs(currentView: DashboardView, currentSteps: FlowStep[], visitedEdges: Set<string>) {
      // Check if current view is a terminal goal
      const matchedGoal = scenario.terminalGoals.find((g) => g.targetView === currentView)
      if (matchedGoal && currentSteps.length > 0) {
        const terminalPath: FlowPath = {
          steps: [...currentSteps],
          reachedGoal: matchedGoal.id,
          isTerminal: true,
        }
        terminalPaths.push(terminalPath)
        paths.push(terminalPath)
      }

      // Outgoing transitions
      const outgoing = scenario.transitions.filter((t) => t.fromView === currentView)
      for (const rule of outgoing) {
        const edgeKey = `${rule.fromView}->${rule.actionType}->${rule.toView}`
        if (visitedEdges.has(edgeKey)) {
          // Avoid infinite loops in cyclic FSMs
          continue
        }

        const step: FlowStep = {
          from: rule.fromView,
          action: rule.actionType,
          to: rule.toView,
          guardIds: rule.guardIds,
          description: rule.description,
        }

        visitedEdges.add(edgeKey)
        currentSteps.push(step)

        dfs(rule.toView, currentSteps, visitedEdges)

        currentSteps.pop()
        visitedEdges.delete(edgeKey)
      }
    }

    dfs(scenario.initialView, [], new Set())

    return {
      scenarioId: scenario.id,
      title: scenario.title,
      initialView: scenario.initialView,
      boundedViews: scenario.boundedViews,
      reachableViews: Array.from(reachableViewsSet),
      deadEnds,
      paths,
      terminalPaths,
      matrix,
    }
  }

  /**
   * Compiles the scenario's BEHAVIOR flow into Mermaid stateDiagram-v2 format.
   */
  public static toMermaidStateDiagram(
    scenario: ScenarioTopicDefinition,
    options: { highlightCurrentView?: DashboardView } = {},
  ): string {
    const lines: string[] = ['stateDiagram-v2']

    lines.push(`    [*] --> ${scenario.initialView}: START_SCENARIO ("${scenario.id}")`)

    // Group transitions
    for (const rule of scenario.transitions) {
      const guardLabel =
        rule.guardIds && rule.guardIds.length > 0 ? ` [${rule.guardIds.join(', ')}]` : ''
      lines.push(`    ${rule.fromView} --> ${rule.toView}: ${rule.actionType}${guardLabel}`)
    }

    // Terminal goals
    for (const goal of scenario.terminalGoals) {
      lines.push(`    ${goal.targetView} --> [*]: COMPLETE_GOAL (${goal.id})`)
    }

    if (options.highlightCurrentView) {
      lines.push(`    classDef current fill:#2563eb,stroke:#3b82f6,color:#fff`)
      lines.push(`    class ${options.highlightCurrentView} current`)
    }

    return lines.join('\n')
  }

  /**
   * Compiles the scenario's BEHAVIOR flow into Graphviz DOT syntax.
   */
  public static toDotGraph(scenario: ScenarioTopicDefinition): string {
    const lines: string[] = [
      `digraph "${scenario.id}" {`,
      '  rankdir=LR;',
      '  node [shape=box, style="rounded,filled", fillcolor="#f8fafc", fontname="sans-serif"];',
      '  edge [fontname="sans-serif", fontsize=10];',
      '  __start [shape=circle, label="", style=filled, fillcolor=black, width=0.2];',
      `  __start -> "${scenario.initialView}" [label="START"];`,
    ]

    for (const rule of scenario.transitions) {
      const guardStr = rule.guardIds && rule.guardIds.length > 0 ? `\\n[${rule.guardIds.join(',')}]` : ''
      lines.push(
        `  "${rule.fromView}" -> "${rule.toView}" [label="${rule.actionType}${guardStr}"];`,
      )
    }

    for (const goal of scenario.terminalGoals) {
      const endNode = `__end_${goal.id}`
      lines.push(`  ${endNode} [shape=doublecircle, label="", style=filled, fillcolor=black, width=0.2];`)
      lines.push(`  "${goal.targetView}" -> ${endNode} [label="GOAL: ${goal.id}"];`)
    }

    lines.push('}')
    return lines.join('\n')
  }

  /**
   * Generates a comprehensive markdown summary report of the scenario flow.
   */
  public static toMarkdownReport(scenario: ScenarioTopicDefinition): string {
    const analysis = ScenarioFlowEnumerator.enumerate(scenario)
    const lines: string[] = [
      `### 유저 시나리오: ${scenario.title} (\`${scenario.id}\`)`,
      `* **담당 페르소나**: \`${scenario.persona}\``,
      `* **진입 뷰 (Initial View)**: \`${scenario.initialView}\``,
      `* **제한 뷰 집합 (Bounded Views)**: ${scenario.boundedViews.map((v) => `\`${v}\``).join(', ')}`,
      `* **도달 가능한 뷰**: ${analysis.reachableViews.map((v) => `\`${v}\``).join(', ')}`,
      `* **미완료 고아 뷰 (Dead Ends)**: ${analysis.deadEnds.length === 0 ? 'None (안전)' : analysis.deadEnds.map((v) => `\`${v}\``).join(', ')}`,
      `* **발견된 도달 경로 수**: ${analysis.paths.length}개 (완료 목표 도달 경로: ${analysis.terminalPaths.length}개)`,
      '',
      '#### 전이 행렬 (Transition Matrix)',
      '| 출발 뷰 | 액션 (BEHAVIOR) | 도착 뷰 | 필수 가드 (Guards) | 목표 도달 |',
      '| :--- | :--- | :--- | :--- | :--- |',
    ]

    for (const row of analysis.matrix) {
      const guardStr = row.guardIds.length > 0 ? `\`${row.guardIds.join('`, `')}\`` : '-'
      lines.push(
        `| \`${row.fromView}\` | \`${row.actionType}\` | \`${row.toView}\` | ${guardStr} | ${row.isTerminal ? '✅ 완료' : '전이'} |`,
      )
    }

    lines.push('', '#### Mermaid 흐름도', '```mermaid', ScenarioFlowEnumerator.toMermaidStateDiagram(scenario), '```')

    return lines.join('\n')
  }
}
