export type PipelineState = 'running' | 'scheduled' | 'failed' | 'success' | 'blocked'

export interface PipelineRun {
  id: string
  project: string
  branch: string
  state: PipelineState
  owner: string
  elapsedMinutes: number
  estimatedRemainingMinutes: number | null
  commitSha: string
  jobCount: number
  failedJobs: number
  stage: string
}

export interface Runner {
  id: string
  group: string
  zone: string
  busy: number
  total: number
}

export interface Alert {
  id: string
  title: string
  severity: 'critical' | 'warning' | 'info'
  target: string
  createdMinutesAgo: number
}

export interface Issue {
  iid: string
  title: string
  project: string
  priority: 'critical' | 'high' | 'medium' | 'low'
  status: 'queued' | 'running' | 'blocked' | 'review' | 'done'
  owner: string
  estimateMinutes: number
  remainingMinutes: number | null
  queuePosition: number
}

export interface ContextSearchHit {
  id: string
  query: string
  project: string
  path: string
  snippet: string
  contextType: 'spec' | 'mr' | 'issue' | 'runbook'
  capability: 'available' | 'degraded' | 'missing'
  confidence: number
  updatedMinutesAgo: number
}

export interface Capability {
  id: string
  name: string
  status: 'enabled' | 'partial' | 'disabled'
  owner: string
  note: string
}

export interface RuntimeWarning {
  id: string
  level: 'critical' | 'warning' | 'info'
  message: string
  remediation: string
}

export interface DryRunStep {
  id: string
  title: string
  details: string
  effect: 'none' | 'preview' | 'isolated'
}

export const kpi = {
  activePipelines: 12,
  blockedPipelines: 3,
  successRate: 97.8,
  avgLeadTimeHours: 1.4,
  openMRs: 5,
}

export const pipelineRuns: PipelineRun[] = [
  {
    id: 'PIPE-2049',
    project: 'inventory/api',
    branch: 'release/v2.4',
    state: 'running',
    owner: 'alice',
    elapsedMinutes: 42,
    estimatedRemainingMinutes: 10,
    commitSha: '8c1d7ef',
    jobCount: 18,
    failedJobs: 0,
    stage: 'integration',
  },
  {
    id: 'PIPE-2048',
    project: 'auth/gateway',
    branch: 'main',
    state: 'scheduled',
    owner: 'ops-bot',
    elapsedMinutes: 0,
    estimatedRemainingMinutes: 24,
    commitSha: 'f93b2a1',
    jobCount: 21,
    failedJobs: 0,
    stage: 'queued',
  },
  {
    id: 'PIPE-2047',
    project: 'payments/checkout',
    branch: 'feat/retry-policy',
    state: 'failed',
    owner: 'sam',
    elapsedMinutes: 78,
    estimatedRemainingMinutes: null,
    commitSha: 'a7d11bc',
    jobCount: 24,
    failedJobs: 4,
    stage: 'validation',
  },
  {
    id: 'PIPE-2046',
    project: 'web/portal',
    branch: 'hotfix/header',
    state: 'blocked',
    owner: 'qa',
    elapsedMinutes: 18,
    estimatedRemainingMinutes: 45,
    commitSha: 'd19f3b9',
    jobCount: 11,
    failedJobs: 1,
    stage: 'review',
  },
]

export const runners: Runner[] = [
  { id: 'runner-01', group: 'default', zone: 'us-east-1', busy: 6, total: 8 },
  { id: 'runner-02', group: 'compute', zone: 'us-east-1', busy: 4, total: 6 },
  { id: 'runner-03', group: 'security', zone: 'eu-west-1', busy: 1, total: 4 },
]

export const alerts: Alert[] = [
  {
    id: 'AL-1001',
    title: 'Repeated failures in checkout integration',
    severity: 'critical',
    target: 'payments/checkout',
    createdMinutesAgo: 7,
  },
  {
    id: 'AL-1002',
    title: 'Runner queue wait time exceeded threshold',
    severity: 'warning',
    target: 'default group',
    createdMinutesAgo: 21,
  },
  {
    id: 'AL-1003',
    title: 'Manual approval window extended for staged release',
    severity: 'info',
    target: 'inventory/api',
    createdMinutesAgo: 56,
  },
]

export const issueQueue: Issue[] = [
  {
    iid: '1452',
    title: 'Refactor CI template variable resolution',
    project: 'inventory/api',
    priority: 'critical',
    status: 'running',
    owner: 'alice',
    estimateMinutes: 90,
    remainingMinutes: 30,
    queuePosition: 1,
  },
  {
    iid: '1453',
    title: 'Harden merge request conflict guardrails',
    project: 'auth/gateway',
    priority: 'high',
    status: 'queued',
    owner: 'ops-bot',
    estimateMinutes: 60,
    remainingMinutes: 60,
    queuePosition: 2,
  },
  {
    iid: '1454',
    title: 'Patch release pipeline for schema drift',
    project: 'payments/checkout',
    priority: 'medium',
    status: 'blocked',
    owner: 'sam',
    estimateMinutes: 45,
    remainingMinutes: 45,
    queuePosition: 3,
  },
  {
    iid: '1455',
    title: 'Review dry-run regression for release evidence endpoint',
    project: 'web/portal',
    priority: 'low',
    status: 'review',
    owner: 'qa',
    estimateMinutes: 30,
    remainingMinutes: null,
    queuePosition: 4,
  },
]

export const contextSearchResults: ContextSearchHit[] = [
  {
    id: 'CS-901',
    query: 'release evidence endpoint',
    project: 'payments/checkout',
    path: '.orch/project/context.yml',
    snippet:
      'releaseEvidence is optional in CE; only available when release API capability is enabled.',
    contextType: 'runbook',
    capability: 'degraded',
    confidence: 94,
    updatedMinutesAgo: 18,
  },
  {
    id: 'CS-902',
    query: 'policy check policy id',
    project: 'auth/gateway',
    path: 'docs/policy-matrix.md',
    snippet: 'Policy checks can be executed directly on branch metadata and issue links.',
    contextType: 'spec',
    capability: 'available',
    confidence: 98,
    updatedMinutesAgo: 41,
  },
  {
    id: 'CS-903',
    query: 'runner capacity alerts',
    project: 'web/portal',
    path: 'README.md',
    snippet: 'No stable runner telemetry for legacy shared runners.',
    contextType: 'issue',
    capability: 'missing',
    confidence: 71,
    updatedMinutesAgo: 128,
  },
]

export const capabilities: Capability[] = [
  {
    id: 'C-01',
    name: 'Context search (indexed)',
    status: 'partial',
    owner: 'platform team',
    note: 'Search index refresh is delayed for one region.',
  },
  {
    id: 'C-02',
    name: 'Auto-runbook suggestions',
    status: 'enabled',
    owner: 'ops automation',
    note: 'Hints available for 18 of 20 tracked repositories.',
  },
  {
    id: 'C-03',
    name: 'Secure dry-run executor',
    status: 'disabled',
    owner: 'security',
    note: 'Manual review required due token scope policy.',
  },
]

export const operationalWarnings: RuntimeWarning[] = [
  {
    id: 'W-01',
    level: 'critical',
    message: 'Stale pipeline metadata in two projects',
    remediation: 'Re-sync project metadata and requeue impacted runs.',
  },
  {
    id: 'W-02',
    level: 'warning',
    message: 'Dry-run preview window reduced to 24h for legacy namespaces',
    remediation: 'Switch to isolated executor profile for long-running jobs.',
  },
  {
    id: 'W-03',
    level: 'info',
    message: 'Runner quota increase applied overnight',
    remediation: 'No action required; monitor for sustained utilization.',
  },
]

export const dryRunSemantics: DryRunStep[] = [
  {
    id: 'DR-1',
    title: 'Manifest generation',
    details: 'Builds the patch manifest and validates all mutation targets before execution.',
    effect: 'preview',
  },
  {
    id: 'DR-2',
    title: 'Dependency resolution',
    details: 'Resolves upstream/downstream dependency graph without writing disk.',
    effect: 'isolated',
  },
  {
    id: 'DR-3',
    title: 'Commit simulation',
    details: 'Simulates merge commits and checks pipeline feasibility only.',
    effect: 'none',
  },
]

export function statusClass(state: PipelineRun['state']): string {
  if (state === 'running') return 'status status-running'
  if (state === 'scheduled') return 'status status-scheduled'
  if (state === 'failed') return 'status status-failed'
  if (state === 'blocked') return 'status status-blocked'
  return 'status status-success'
}

export function statusLabel(state: PipelineRun['state']): string {
  if (state === 'running') return 'Running'
  if (state === 'scheduled') return 'Scheduled'
  if (state === 'failed') return 'Failed'
  if (state === 'blocked') return 'Blocked'
  return 'Success'
}

export function severityClass(level: Alert['severity']): string {
  if (level === 'critical') return 'badge badge-critical'
  if (level === 'warning') return 'badge badge-warning'
  return 'badge badge-info'
}

export function issueStateClass(status: Issue['status']): string {
  if (status === 'running') return 'status status-running'
  if (status === 'blocked') return 'status status-blocked'
  if (status === 'queued') return 'status status-scheduled'
  if (status === 'review') return 'status status-warning'
  return 'status status-success'
}

export function issuePriorityClass(priority: Issue['priority']): string {
  if (priority === 'critical') return 'badge badge-critical'
  if (priority === 'high') return 'badge badge-warning'
  if (priority === 'medium') return 'badge status-success'
  return 'badge status'
}

export function searchCapabilityClass(capability: ContextSearchHit['capability']): string {
  if (capability === 'available') return 'badge badge-info'
  if (capability === 'degraded') return 'badge badge-warning'
  return 'badge status-warning'
}

export function capabilityClass(status: Capability['status']): string {
  if (status === 'enabled') return 'badge badge-capability-enabled'
  if (status === 'partial') return 'badge badge-warning'
  return 'badge badge-critical'
}

export function warningClass(level: RuntimeWarning['level']): string {
  if (level === 'critical') return 'badge badge-critical'
  if (level === 'warning') return 'badge badge-warning'
  return 'badge badge-info'
}
